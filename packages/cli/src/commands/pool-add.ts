import { Command } from 'commander';
import { input, confirm, password } from '@inquirer/prompts';
import * as fs from 'fs/promises';
import * as path from 'path';

// ANSI color codes
const RESET = '\x1B[0m';
const GREEN = '\x1B[32m';
const YELLOW = '\x1B[33m';
const BOLDCYAN = '\x1B[1m\x1B[36m';
const BOLDYELLOW = '\x1B[1m\x1B[33m';
const DIM = '\x1B[2m';

// Pool config file path
const POOL_CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude-code-router'
);
const POOL_CONFIG_FILE = path.join(POOL_CONFIG_DIR, 'pool-config.json');

/**
 * Generate unique account ID
 */
function generateAccountId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Coding Plan Account interface
 */
interface CodingPlanAccount {
  id: string;
  name: string;
  platform: 'zai' | 'zhipu';
  apiKey: string;
  apiBaseUrl: string;
  status: 'active' | 'limited' | 'error' | 'disabled';
  concurrency: {
    current: number;
    max: number;
    lastUpdated: Date;
  };
  usage: {
    last5Hours: number;
    weekly: number;
    last5HoursLimit: number;
    weeklyLimit: number;
    lastSyncedAt?: Date;
  };
  config: {
    maxConcurrency: number;
    last5HoursLimit: number;
    weeklyLimit: number;
    bufferRatio: number;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastUsedAt?: Date;
  };
}

/**
 * Pool Manager - Simple in-memory account pool management
 */
class PoolManager {
  private accounts: Map<string, CodingPlanAccount>;
  private defaultMaxConcurrency: number;
  private defaultBufferRatio: number;

  constructor() {
    this.accounts = new Map();
    this.defaultMaxConcurrency = 3;
    this.defaultBufferRatio = 0.1;
  }

  addAccount(accountData: {
    name: string;
    platform: 'zai' | 'zhipu';
    apiKey: string;
    apiBaseUrl: string;
    maxConcurrency?: number;
    last5HoursLimit?: number;
    weeklyLimit?: number;
    bufferRatio?: number;
  }): CodingPlanAccount {
    const now = new Date();
    const id = generateAccountId();

    const maxConcurrency = accountData.maxConcurrency ?? this.defaultMaxConcurrency;
    const bufferRatio = accountData.bufferRatio ?? this.defaultBufferRatio;
    const last5HoursLimit = accountData.last5HoursLimit ?? 100000;
    const weeklyLimit = accountData.weeklyLimit ?? 500000;

    const account: CodingPlanAccount = {
      id,
      name: accountData.name,
      platform: accountData.platform,
      apiKey: accountData.apiKey,
      apiBaseUrl: accountData.apiBaseUrl,
      status: 'active',
      concurrency: {
        current: 0,
        max: maxConcurrency,
        lastUpdated: now,
      },
      usage: {
        last5Hours: 0,
        weekly: 0,
        last5HoursLimit,
        weeklyLimit,
        lastSyncedAt: now,
      },
      config: {
        maxConcurrency,
        last5HoursLimit,
        weeklyLimit,
        bufferRatio,
      },
      metadata: {
        createdAt: now,
        updatedAt: now,
        lastUsedAt: undefined,
      },
    };

    this.accounts.set(id, account);
    return account;
  }

  importConfig(config: any): void {
    if (config.accounts && Array.isArray(config.accounts)) {
      for (const acc of config.accounts) {
        this.accounts.set(acc.id, {
          ...acc,
          metadata: {
            ...acc.metadata,
            createdAt: new Date(acc.metadata?.createdAt),
            updatedAt: new Date(acc.metadata?.updatedAt),
          },
          concurrency: {
            ...acc.concurrency,
            lastUpdated: new Date(acc.concurrency?.lastUpdated),
          },
          usage: {
            ...acc.usage,
            lastSyncedAt: acc.usage?.lastSyncedAt ? new Date(acc.usage.lastSyncedAt) : undefined,
          },
        });
      }
    }
    if (config.defaultMaxConcurrency) {
      this.defaultMaxConcurrency = config.defaultMaxConcurrency;
    }
    if (config.defaultBufferRatio) {
      this.defaultBufferRatio = config.defaultBufferRatio;
    }
  }

  exportConfig(): any {
    return {
      defaultMaxConcurrency: this.defaultMaxConcurrency,
      defaultBufferRatio: this.defaultBufferRatio,
      accounts: Array.from(this.accounts.values()),
    };
  }

  getAllAccounts(): CodingPlanAccount[] {
    return Array.from(this.accounts.values());
  }
}

/**
 * Load or create PoolManager instance with persistence
 */
async function loadPoolManager(): Promise<PoolManager> {
  const poolManager = new PoolManager();

  try {
    await fs.access(POOL_CONFIG_FILE);
    const content = await fs.readFile(POOL_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    poolManager.importConfig(config);
  } catch (error: any) {
    // Config file doesn't exist yet, that's OK
    if (error.code !== 'ENOENT') {
      console.warn(`${YELLOW}Warning: Failed to load pool config: ${error.message}${RESET}`);
    }
  }

  return poolManager;
}

/**
 * Save pool configuration
 */
async function savePoolConfig(poolManager: PoolManager): Promise<void> {
  await fs.mkdir(POOL_CONFIG_DIR, { recursive: true });
  const config = poolManager.exportConfig();
  await fs.writeFile(POOL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`${GREEN}✓${RESET} Pool configuration saved.\n`);
}
function getDefaultApiUrl(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'zai':
      return 'https://api.z.ai/api/anthropic';
    case 'zhipu':
    case 'bigmodel':
      return 'https://open.bigmodel.cn/api/anthropic';
    default:
      return 'https://api.z.ai/api/anthropic';
  }
}

/**
 * Validate platform input
 */
function validatePlatform(platform: string): boolean {
  return ['zai', 'zhipu', 'bigmodel'].includes(platform.toLowerCase());
}

/**
 * Interactive mode for adding account
 */
async function interactiveMode(options: any): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}       Add Z.ai Coding Plan Account${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  // Get account name
  let name = options.name;
  if (!name) {
    name = await input({
      message: 'Account name/label:',
      default: `Account ${Date.now().toString().slice(-4)}`,
      validate: (value: string) => {
        if (!value.trim()) {
          return 'Account name cannot be empty';
        }
        return true;
      },
    });
  }

  // Get API key
  let apiKey = options.apiKey;
  if (!apiKey) {
    apiKey = await password({
      message: 'API Key:',
      validate: (value: string) => {
        if (!value.trim()) {
          return 'API key cannot be empty';
        }
        return true;
      },
    });
  }

  // Get platform
  let platform = options.platform || 'zai';
  if (!options.platform) {
    platform = await input({
      message: 'Platform type:',
      default: 'zai',
      validate: (value: string) => {
        if (!validatePlatform(value)) {
          return 'Platform must be "zai" or "zhipu"';
        }
        return true;
      },
    });
  }

  // Get API base URL
  const defaultApiUrl = getDefaultApiUrl(platform);
  let apiBaseUrl = options.apiBaseUrl;
  if (!apiBaseUrl) {
    apiBaseUrl = await input({
      message: 'API Base URL:',
      default: defaultApiUrl,
      validate: (value: string) => {
        if (!value.trim()) {
          return 'API base URL cannot be empty';
        }
        try {
          new URL(value);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });
  }

  // Get max concurrency
  let maxConcurrency = parseInt(options.maxConcurrency) || 3;
  if (!options.maxConcurrency) {
    const concurrencyInput = await input({
      message: 'Max concurrent requests:',
      default: '3',
      validate: (value: string) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a positive number';
        }
        return true;
      },
    });
    maxConcurrency = parseInt(concurrencyInput);
  }

  // Get 5-hour limit
  let last5HoursLimit = parseInt(options['5hLimit']) || 100000;
  if (!options['5hLimit']) {
    const limitInput = await input({
      message: '5-hour usage limit (tokens/requests):',
      default: '100000',
      validate: (value: string) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a positive number';
        }
        return true;
      },
    });
    last5HoursLimit = parseInt(limitInput);
  }

  // Get weekly limit
  let weeklyLimit = parseInt(options.weeklyLimit) || 500000;
  if (!options.weeklyLimit) {
    const limitInput = await input({
      message: 'Weekly usage limit (tokens/requests):',
      default: '500000',
      validate: (value: string) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a positive number';
        }
        return true;
      },
    });
    weeklyLimit = parseInt(limitInput);
  }

  // Get buffer ratio
  let bufferRatio = parseFloat(options.bufferRatio) || 0.1;
  if (!options.bufferRatio) {
    const bufferInput = await input({
      message: 'Buffer ratio (0-1, recommended 0.1):',
      default: '0.1',
      validate: (value: string) => {
        const num = parseFloat(value);
        if (isNaN(num) || num < 0 || num > 1) {
          return 'Please enter a number between 0 and 1';
        }
        return true;
      },
    });
    bufferRatio = parseFloat(bufferInput);
  }

  // Confirm
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}       Configuration Summary${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);
  console.log(`  ${GREEN}Name:${RESET}           ${name}`);
  console.log(`  ${GREEN}Platform:${RESET}       ${platform}`);
  console.log(`  ${GREEN}API URL:${RESET}        ${apiBaseUrl}`);
  console.log(`  ${GREEN}Max Concurrency:${RESET} ${maxConcurrency}`);
  console.log(`  ${GREEN}5h Limit:${RESET}       ${last5HoursLimit}`);
  console.log(`  ${GREEN}Weekly Limit:${RESET}   ${weeklyLimit}`);
  console.log(`  ${GREEN}Buffer Ratio:${RESET}   ${bufferRatio}`);
  console.log('');

  const shouldAdd = await confirm({
    message: 'Add this account to the pool?',
    default: true,
  });

  if (!shouldAdd) {
    console.log(`\n${YELLOW}Cancelled.${RESET}\n`);
    return;
  }

  // Add the account
  await addAccount({
    name,
    apiKey,
    platform: platform.toLowerCase() as 'zai' | 'zhipu',
    apiBaseUrl,
    maxConcurrency,
    last5HoursLimit,
    weeklyLimit,
    bufferRatio,
  });
}

/**
 * Command mode for adding account
 */
async function commandMode(options: any): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}       Add Z.ai Coding Plan Account${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  // Validate platform
  if (options.platform && !validatePlatform(options.platform)) {
    console.error(`${YELLOW}Error:${RESET} Invalid platform "${options.platform}". Must be "zai" or "zhipu".\n`);
    process.exit(1);
  }

  // Set default API URL if not provided
  const platform = (options.platform || 'zai').toLowerCase();
  if (!options.apiBaseUrl) {
    options.apiBaseUrl = getDefaultApiUrl(platform);
  }

  // Validate limits
  const maxConcurrency = parseInt(options.maxConcurrency) || 3;
  const last5HoursLimit = parseInt(options['5hLimit']) || 100000;
  const weeklyLimit = parseInt(options.weeklyLimit) || 500000;
  const bufferRatio = parseFloat(options.bufferRatio) || 0.1;

  if (maxConcurrency <= 0) {
    console.error(`${YELLOW}Error:${RESET} Max concurrency must be a positive number.\n`);
    process.exit(1);
  }

  if (last5HoursLimit <= 0 || weeklyLimit <= 0) {
    console.error(`${YELLOW}Error:${RESET} Usage limits must be positive numbers.\n`);
    process.exit(1);
  }

  if (bufferRatio < 0 || bufferRatio > 1) {
    console.error(`${YELLOW}Error:${RESET} Buffer ratio must be between 0 and 1.\n`);
    process.exit(1);
  }

  // Add the account
  await addAccount({
    name: options.name,
    apiKey: options.apiKey,
    platform: platform as 'zai' | 'zhipu',
    apiBaseUrl: options.apiBaseUrl,
    maxConcurrency,
    last5HoursLimit,
    weeklyLimit,
    bufferRatio,
  });
}

/**
 * Add account to pool
 */
async function addAccount(accountData: {
  name: string;
  apiKey: string;
  platform: 'zai' | 'zhipu';
  apiBaseUrl: string;
  maxConcurrency: number;
  last5HoursLimit: number;
  weeklyLimit: number;
  bufferRatio: number;
}): Promise<void> {
  try {
    const poolManager = await loadPoolManager();

    const account = poolManager.addAccount({
      name: accountData.name,
      apiKey: accountData.apiKey,
      platform: accountData.platform,
      apiBaseUrl: accountData.apiBaseUrl,
      maxConcurrency: accountData.maxConcurrency,
      last5HoursLimit: accountData.last5HoursLimit,
      weeklyLimit: accountData.weeklyLimit,
      bufferRatio: accountData.bufferRatio,
    });

    console.log(`\n${GREEN}✓${RESET} Account added successfully!\n`);
    console.log(`${BOLDCYAN}Account Details:${RESET}`);
    console.log(`  ${GREEN}ID:${RESET}         ${account.id}`);
    console.log(`  ${GREEN}Name:${RESET}       ${account.name}`);
    console.log(`  ${GREEN}Platform:${RESET}   ${account.platform}`);
    console.log(`  ${GREEN}API URL:${RESET}    ${account.apiBaseUrl}`);
    console.log(`  ${GREEN}Concurrency:${RESET} ${account.config.maxConcurrency}`);
    console.log(`  ${GREEN}5h Limit:${RESET}   ${account.config.last5HoursLimit}`);
    console.log(`  ${GREEN}Weekly Limit:${RESET} ${account.config.weeklyLimit}`);
    console.log(`  ${GREEN}Buffer Ratio:${RESET} ${account.config.bufferRatio}`);
    console.log('');

    // Save configuration
    await savePoolConfig(poolManager);

  } catch (error: any) {
    console.error(`${YELLOW}Error:${RESET} ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Create pool add command
 */
export function createPoolAddCommand(): Command {
  const poolAddCommand = new Command('add')
    .description('Add a Z.ai Coding Plan account to the pool')
    .option('-n, --name <string>', 'Account name/label')
    .option('-k, --api-key <string>', 'API Key')
    .option('-p, --platform <string>', 'Platform type (zai/zhipu)')
    .option('-u, --api-base-url <string>', 'API base URL')
    .option('-c, --max-concurrency <number>', 'Max concurrent requests')
    .option('--5h-limit <number>', '5-hour usage limit')
    .option('--weekly-limit <number>', 'Weekly usage limit')
    .option('-b, --buffer-ratio <number>', 'Buffer ratio (0-1)')
    .action(async (options) => {
      try {
        // If required parameters are missing, enter interactive mode
        if (!options.name || !options.apiKey) {
          await interactiveMode(options);
        } else {
          await commandMode(options);
        }
      } catch (error: any) {
        console.error(`${YELLOW}Error:${RESET} ${error.message}\n`);
        process.exit(1);
      }
    });

  return poolAddCommand;
}

export default createPoolAddCommand;
