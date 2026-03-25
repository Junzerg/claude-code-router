import { get_encoding } from "tiktoken";
import { sessionUsageCache, Usage } from "./cache";
import { readFile } from "fs/promises";
import { readFileSync } from "fs";
import { opendir, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from "@CCR/shared";
import { LRUCache } from "lru-cache";
import { ConfigService } from "../services/config";
import { TokenizerService } from "../services/tokenizer";
import { PoolManager } from "../services/pool-manager";
import { ConcurrencyManager } from "../services/concurrency-manager";
import { PoolRouter } from "../services/pool-router";
import { PoolStorage, createPoolStorage } from "../services/pool-storage";
import { BindingStorage, createBindingStorage } from "../services/binding-storage";
import { AlertService, createAlertService } from "../services/alerts";
import { UsageHistoryService, createUsageHistoryService } from "../services/usage-history";
import { SmartRouter, createSmartRouter } from "../services/smart-router";
import { UsageSyncService } from "../services/usage-sync";
import { RateLimitRecoveryService } from "../services/rate-limit-recovery";

// Types from @anthropic-ai/sdk
interface Tool {
  name: string;
  description?: string;
  input_schema: object;
}

interface ContentBlockParam {
  type: string;
  [key: string]: any;
}

interface MessageParam {
  role: string;
  content: string | ContentBlockParam[];
}

interface MessageCreateParamsBase {
  messages?: MessageParam[];
  system?: string | any[];
  tools?: Tool[];
  [key: string]: any;
}

const enc = get_encoding("cl100k_base");

export const calculateTokenCount = (
  messages: MessageParam[],
  system: any,
  tools: Tool[]
) => {
  let tokenCount = 0;
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }
  if (tools) {
    tools.forEach((tool: Tool) => {
      if (tool.description) {
        tokenCount += enc.encode(tool.name + tool.description).length;
      }
      if (tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }
  return tokenCount;
};

const getProjectSpecificRouter = async (
  req: any,
  configService: ConfigService
) => {
  // Check if there is project-specific configuration
  if (req.sessionId) {
    const project = await searchProjectBySession(req.sessionId);
    if (project) {
      const projectConfigPath = join(HOME_DIR, project, "config.json");
      const sessionConfigPath = join(
        HOME_DIR,
        project,
        `${req.sessionId}.json`
      );

      // First try to read sessionConfig file
      try {
        const sessionConfig = JSON.parse(await readFile(sessionConfigPath, "utf8"));
        if (sessionConfig && sessionConfig.Router) {
          return sessionConfig.Router;
        }
      } catch {}
      try {
        const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
        if (projectConfig && projectConfig.Router) {
          return projectConfig.Router;
        }
      } catch {}
    }
  }
  return undefined; // Return undefined to use original configuration
};

const getUseModel = async (
  req: any,
  tokenCount: number,
  configService: ConfigService,
  lastUsage?: Usage | undefined
): Promise<{ model: string; scenarioType: RouterScenarioType }> => {
  // Check if pool router is available and should be used
  const poolRouter = getPoolRouter();
  if (poolRouter) {
    try {
      // Generate a default sessionId if not present and store it in req
      req.sessionId = req.sessionId || `default-${Date.now()}`;
      const selection = await poolRouter.selectAccount({
        sessionId: req.sessionId,
        headers: req.headers,
        body: req.body,
      });

      // Update req.sessionId with the extracted sessionId (from headers if present)
      req.sessionId = selection.sessionId;

      // Get the account details
      const account = poolRouter.getPoolManager().getAccount(selection.accountId);
      if (account) {
        // Store account info in request for later use
        req.poolAccount = account;
        // Get the default model from Router config
        const Router = configService.get("Router");
        const defaultModel = Router?.default || "claude-sonnet-4-20250514";
        // Return the default model - the pool account credentials will be used
        return {
          model: defaultModel,
          scenarioType: 'default',
        };
      }
    } catch (error: any) {
      req.log.warn(`[PoolRouter] Failed to select account: ${error.message}, falling back to default router`);
    }
  }

  const projectSpecificRouter = await getProjectSpecificRouter(req, configService);
  const providers = configService.get<any[]>("providers") || [];
  const Router = projectSpecificRouter || configService.get("Router");

  if (req.body.model.includes(",")) {
    const [provider, model] = req.body.model.split(",");
    const finalProvider = providers.find(
      (p: any) => p.name.toLowerCase() === provider
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m.toLowerCase() === model
    );
    if (finalProvider && finalModel) {
      return { model: `${finalProvider.name},${finalModel}`, scenarioType: 'default' };
    }
    return { model: req.body.model, scenarioType: 'default' };
  }

  // if tokenCount is greater than the configured threshold, use the long context model
  const longContextThreshold = Router?.longContextThreshold || 60000;
  const lastUsageThreshold =
    lastUsage &&
    lastUsage.input_tokens > longContextThreshold &&
    tokenCount > 20000;
  const tokenCountThreshold = tokenCount > longContextThreshold;
  if ((lastUsageThreshold || tokenCountThreshold) && Router?.longContext) {
    req.log.info(
      `Using long context model due to token count: ${tokenCount}, threshold: ${longContextThreshold}`
    );
    return { model: Router.longContext, scenarioType: 'longContext' };
  }
  if (
    req.body?.system?.length > 1 &&
    req.body?.system[1]?.text?.startsWith("<CCR-SUBAGENT-MODEL>")
  ) {
    const model = req.body?.system[1].text.match(
      /<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s
    );
    if (model) {
      req.body.system[1].text = req.body.system[1].text.replace(
        `<CCR-SUBAGENT-MODEL>${model[1]}</CCR-SUBAGENT-MODEL>`,
        ""
      );
      return { model: model[1], scenarioType: 'default' };
    }
  }
  // Use the background model for any Claude Haiku variant
  const globalRouter = configService.get("Router");
  if (
    req.body.model?.includes("claude") &&
    req.body.model?.includes("haiku") &&
    globalRouter?.background
  ) {
    req.log.info(`Using background model for ${req.body.model}`);
    return { model: globalRouter.background, scenarioType: 'background' };
  }
  // The priority of websearch must be higher than thinking.
  if (
    Array.isArray(req.body.tools) &&
    req.body.tools.some((tool: any) => tool.type?.startsWith("web_search")) &&
    Router?.webSearch
  ) {
    return { model: Router.webSearch, scenarioType: 'webSearch' };
  }
  // if exits thinking, use the think model
  if (req.body.thinking && Router?.think) {
    req.log.info(`Using think model for ${req.body.thinking}`);
    return { model: Router.think, scenarioType: 'think' };
  }
  return { model: Router?.default, scenarioType: 'default' };
};

export interface RouterContext {
  configService: ConfigService;
  tokenizerService?: TokenizerService;
  event?: any;
}

export type RouterScenarioType = 'default' | 'background' | 'think' | 'longContext' | 'webSearch';

export interface RouterFallbackConfig {
  default?: string[];
  background?: string[];
  think?: string[];
  longContext?: string[];
  webSearch?: string[];
}

// Global pool router instance (lazy initialization)
let poolRouterInstance: PoolRouter | null = null;
let poolRouterInitialized = false;
let poolStorageInstance: PoolStorage | null = null;
let bindingStorageInstance: BindingStorage | null = null;
let alertServiceInstance: AlertService | null = null;
let usageHistoryServiceInstance: UsageHistoryService | null = null;
let smartRouterInstance: SmartRouter | null = null;
let usageSyncServiceInstance: UsageSyncService | null = null;
let rateLimitRecoveryServiceInstance: RateLimitRecoveryService | null = null;

/**
 * Initialize the pool router
 * @param configService - ConfigService instance
 */
export function initPoolRouter(configService: ConfigService): PoolRouter | null {
  if (poolRouterInstance) {
    return poolRouterInstance;
  }

  try {
    const codingPlanPoolConfig = configService.get("CodingPlanPool");

    if (!codingPlanPoolConfig || !codingPlanPoolConfig.enabled) {
      console.log('[PoolRouter] Pool not enabled in config');
      return null;
    }

    // Create PoolStorage first for persistence
    const poolManager = new PoolManager(codingPlanPoolConfig, () => {
      // Save callback - mark storage as dirty
      if (poolStorageInstance) {
        poolStorageInstance.markDirty();
      }
    });
    const concurrencyManager = new ConcurrencyManager(poolManager);

    // Initialize storage for persistence (load existing config if available)
    poolStorageInstance = createPoolStorage(poolManager);

    // If no accounts loaded from pool-config.json, import from config.json accounts list
    if (poolManager.getAllAccounts().length === 0 && codingPlanPoolConfig.accounts && Array.isArray(codingPlanPoolConfig.accounts) && codingPlanPoolConfig.accounts.length > 0) {
      console.log(`[PoolRouter] No persisted accounts found. Importing ${codingPlanPoolConfig.accounts.length} accounts from config.json...`);
      poolManager.importConfig({ accounts: codingPlanPoolConfig.accounts });
      // Save immediately so pool-config.json is created
      poolStorageInstance.markDirty();
    }

    poolRouterInstance = new PoolRouter(poolManager, concurrencyManager, codingPlanPoolConfig, undefined);
    poolRouterInitialized = true;

    // Initialize binding storage for session binding persistence
    const sessionBinder = poolRouterInstance.getSessionBinder();
    bindingStorageInstance = createBindingStorage(sessionBinder);

    // Initialize alert service for monitoring
    alertServiceInstance = createAlertService(poolManager, {
      fiveHourWarningThreshold: 0.8,
      fiveHourCriticalThreshold: 0.95,
      weeklyWarningThreshold: 0.8,
      weeklyCriticalThreshold: 0.95,
      concurrencyWarningThreshold: 0.8,
      maxAlertsInMemory: 100,
    });

    // Add webhook notification callback (placeholder for future implementation)
    alertServiceInstance.onAlert(async (alert) => {
      console.log(`[AlertService] ${alert.level.toUpperCase()}: ${alert.message}`);
      // TODO: Implement webhook/email notification here
    });

    // Initialize usage history service for historical statistics
    usageHistoryServiceInstance = createUsageHistoryService(
      (accountId: string) => poolManager.getAccount(accountId),
      {
        maxRecordsPerAccount: 288, // 24 hours at 5-minute intervals
        cleanupIntervalHours: 24,
        verbose: false,
      }
    );

    // Start automatic snapshot recording
    usageHistoryServiceInstance.start(5);

    // Initialize smart router for intelligent account selection
    smartRouterInstance = createSmartRouter(usageHistoryServiceInstance, {
      weights: { usage: 40, concurrency: 30, health: 30 },
      enablePrediction: true,
      minScoreThreshold: 0.3,
      verbose: false,
    });

    // Set SmartRouter on PoolRouter
    poolRouterInstance.setSmartRouter(smartRouterInstance);

    // Initialize and start UsageSyncService if enabled
    // Check both config.json and pool-config.json for usageSync settings
    let usageSyncConfig = codingPlanPoolConfig.usageSync;
    if (!usageSyncConfig && poolStorageInstance) {
      try {
        const poolConfigPath = poolStorageInstance.getFilePath();
        const poolConfigData = JSON.parse(readFileSync(poolConfigPath, 'utf-8'));
        usageSyncConfig = poolConfigData?.pool?.usageSync;
      } catch {}
    }
    if (usageSyncConfig?.enabled) {
      usageSyncServiceInstance = new UsageSyncService(
        poolManager,
        { intervalMinutes: usageSyncConfig.intervalMinutes ?? 5 },
        undefined,
        alertServiceInstance,
        usageHistoryServiceInstance
      );
      usageSyncServiceInstance.start();
      console.log(`[PoolRouter] UsageSyncService started (interval: ${usageSyncConfig.intervalMinutes ?? 5}m)`);
    } else {
      console.log('[PoolRouter] UsageSyncService disabled (usageSync.enabled not set in config)');
    }

    // Initialize and start RateLimitRecoveryService if enabled
    const rateLimitRecoveryConfig = codingPlanPoolConfig.rateLimitRecovery;
    if (rateLimitRecoveryConfig?.enabled !== false) {
      rateLimitRecoveryServiceInstance = new RateLimitRecoveryService(
        poolManager,
        {
          checkIntervalMinutes: rateLimitRecoveryConfig?.checkIntervalMinutes,
          defaultRecoveryMinutes: rateLimitRecoveryConfig?.defaultRecoveryMinutes,
        }
      );
      rateLimitRecoveryServiceInstance.start();
      console.log(`[PoolRouter] RateLimitRecoveryService started`);
    } else {
      console.log('[PoolRouter] RateLimitRecoveryService disabled');
    }

    // Start heartbeat check to automatically clean up zombie/orphaned concurrency slots
    concurrencyManager.startHeartbeatCheck(60000);

    console.log(`[PoolRouter] Initialized with ${poolManager.getAllAccounts().length} accounts`);
    return poolRouterInstance;
  } catch (error: any) {
    console.error(`[PoolRouter] Failed to initialize: ${error.message}`);
    poolRouterInitialized = false;
    return null;
  }
}

/**
 * Get the pool router instance
 */
export function getPoolRouter(): PoolRouter | null {
  return poolRouterInstance;
}

/**
 * Get the pool storage instance
 */
export function getPoolStorage(): PoolStorage | null {
  return poolStorageInstance;
}

/**
 * Get the binding storage instance
 */
export function getBindingStorage(): BindingStorage | null {
  return bindingStorageInstance;
}

/**
 * Get the alert service instance
 */
export function getAlertService(): AlertService | null {
  return alertServiceInstance;
}

/**
 * Get the usage history service instance
 */
export function getUsageHistoryService(): UsageHistoryService | null {
  return usageHistoryServiceInstance;
}

/**
 * Get the smart router instance
 */
export function getSmartRouter(): SmartRouter | null {
  return smartRouterInstance;
}

/**
 * Get the usage sync service instance
 */
export function getUsageSyncService(): UsageSyncService | null {
  return usageSyncServiceInstance;
}

/**
 * Get the rate limit recovery service instance
 */
export function getRateLimitRecoveryService(): RateLimitRecoveryService | null {
  return rateLimitRecoveryServiceInstance;
}

export const router = async (req: any, _res: any, context: RouterContext) => {
  const { configService, event } = context;
  // Parse sessionId from metadata.user_id
  if (req.body.metadata?.user_id) {
    const parts = req.body.metadata.user_id.split("_session_");
    if (parts.length > 1) {
      req.sessionId = parts[1];
    }
  }
  const lastMessageUsage = sessionUsageCache.get(req.sessionId);
  const { messages, system = [], tools }: MessageCreateParamsBase = req.body;
  const rewritePrompt = configService.get("REWRITE_SYSTEM_PROMPT");
  if (
    rewritePrompt &&
    system.length > 1 &&
    system[1]?.text?.includes("<env>")
  ) {
    const prompt = await readFile(rewritePrompt, "utf-8");
    system[1].text = `${prompt}<env>${system[1].text.split("<env>").pop()}`;
  }

  try {
    // Try to get tokenizer config for the current model
    const [providerName, modelName] = req.body.model.split(",");
    const tokenizerConfig = context.tokenizerService?.getTokenizerConfigForModel(
      providerName,
      modelName
    );

    // Use TokenizerService if available, otherwise fall back to legacy method
    let tokenCount: number;

    if (context.tokenizerService) {
      const result = await context.tokenizerService.countTokens(
        {
          messages: messages as MessageParam[],
          system,
          tools: tools as Tool[],
        },
        tokenizerConfig
      );
      tokenCount = result.tokenCount;
    } else {
      // Legacy fallback
      tokenCount = calculateTokenCount(
        messages as MessageParam[],
        system,
        tools as Tool[]
      );
    }

    let model;
    const customRouterPath = configService.get("CUSTOM_ROUTER_PATH");
    if (customRouterPath) {
      try {
        const customRouter = require(customRouterPath);
        req.tokenCount = tokenCount; // Pass token count to custom router
        model = await customRouter(req, configService.getAll(), {
          event,
        });
      } catch (e: any) {
        req.log.error(`failed to load custom router: ${e.message}`);
      }
    }
    if (!model) {
      const result = await getUseModel(req, tokenCount, configService, lastMessageUsage);
      model = result.model;
      req.scenarioType = result.scenarioType;
    } else {
      // Custom router doesn't provide scenario type, default to 'default'
      req.scenarioType = 'default';
    }
    req.body.model = model;
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    const Router = configService.get("Router");
    req.body.model = Router?.default;
    req.scenarioType = 'default';
  }
  return;
};

// Memory cache for sessionId to project name mapping
// null value indicates previously searched but not found
// Uses LRU cache with max 1000 entries
const sessionProjectCache = new LRUCache<string, string>({
  max: 1000,
});

export const searchProjectBySession = async (
  sessionId: string
): Promise<string | null> => {
  // Check cache first
  if (sessionProjectCache.has(sessionId)) {
    const result = sessionProjectCache.get(sessionId);
    if (!result || result === '') {
      return null;
    }
    return result;
  }

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR);
    const folderNames: string[] = [];

    // Collect all folder names
    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        folderNames.push(dirent.name);
      }
    }

    // Concurrently check each project folder for sessionId.jsonl file
    const checkPromises = folderNames.map(async (folderName) => {
      const sessionFilePath = join(
        CLAUDE_PROJECTS_DIR,
        folderName,
        `${sessionId}.jsonl`
      );
      try {
        const fileStat = await stat(sessionFilePath);
        return fileStat.isFile() ? folderName : null;
      } catch {
        // File does not exist, continue checking next
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // Return the first existing project directory name
    for (const result of results) {
      if (result) {
        // Cache the found result
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }

    // Cache not found result (null value means previously searched but not found)
    sessionProjectCache.set(sessionId, '');
    return null; // No matching project found
  } catch (error) {
    console.error("Error searching for project by session:", error);
    // Cache null result on error to avoid repeated errors
    sessionProjectCache.set(sessionId, '');
    return null;
  }
};
