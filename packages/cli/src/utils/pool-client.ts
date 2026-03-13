import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  POOL_DEFAULT_MAX_CONCURRENCY,
  POOL_DEFAULT_BUFFER_RATIO,
  POOL_DEFAULT_LAST_5_HOURS_LIMIT,
  POOL_DEFAULT_WEEKLY_LIMIT
} from '@CCR/shared';

// ANSI color codes
const RESET = '\x1B[0m';
const GREEN = '\x1B[32m';
const YELLOW = '\x1B[33m';

// Pool config file path
export const POOL_CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude-code-router'
);
export const POOL_CONFIG_FILE = path.join(POOL_CONFIG_DIR, 'pool-config.json');

/**
 * Generate unique account ID
 */
export function generateAccountId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Coding Plan Account interface
 */
export interface CodingPlanAccount {
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
export class PoolManager {
  private accounts: Map<string, CodingPlanAccount>;
  private defaultMaxConcurrency: number;
  private defaultBufferRatio: number;

  constructor() {
    this.accounts = new Map();
    this.defaultMaxConcurrency = POOL_DEFAULT_MAX_CONCURRENCY;
    this.defaultBufferRatio = POOL_DEFAULT_BUFFER_RATIO;
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
    const last5HoursLimit = accountData.last5HoursLimit ?? POOL_DEFAULT_LAST_5_HOURS_LIMIT;
    const weeklyLimit = accountData.weeklyLimit ?? POOL_DEFAULT_WEEKLY_LIMIT;

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

  getAccount(accountId: string): CodingPlanAccount | undefined {
    return this.accounts.get(accountId);
  }

  removeAccount(accountId: string): boolean {
    return this.accounts.delete(accountId);
  }

  getAllAccounts(): CodingPlanAccount[] {
    return Array.from(this.accounts.values());
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
}

/**
 * Load or create PoolManager instance with persistence
 */
export async function loadPoolManager(): Promise<PoolManager> {
  const poolManager = new PoolManager();

  try {
    await fs.access(POOL_CONFIG_FILE);
    const content = await fs.readFile(POOL_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    poolManager.importConfig(config);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`${YELLOW}Warning: Failed to load pool config: ${error.message}${RESET}`);
    }
  }

  return poolManager;
}

/**
 * Save pool configuration
 */
export async function savePoolConfig(poolManager: PoolManager): Promise<void> {
  await fs.mkdir(POOL_CONFIG_DIR, { recursive: true });
  const config = poolManager.exportConfig();
  await fs.writeFile(POOL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`${GREEN}✓${RESET} Pool configuration saved.\\n`);
}
