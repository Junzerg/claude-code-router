import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';

// ANSI color codes
const RESET = '\x1B[0m';
const GREEN = '\x1B[32m';
const YELLOW = '\x1B[33m';
const RED = '\x1B[31m';
const BOLDCYAN = '\x1B[1m\x1B[36m';
const BOLDYELLOW = '\x1B[1m\x1B[33m';
const BOLDRED = '\x1B[1m\x1B[31m';
const BOLDGREEN = '\x1B[1m\x1B[32m';
const DIM = '\x1B[2m';

// Pool config file path
const POOL_CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude-code-router'
);
const POOL_CONFIG_FILE = path.join(POOL_CONFIG_DIR, 'pool-config.json');

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

  constructor() {
    this.accounts = new Map();
  }

  getAccount(accountId: string): CodingPlanAccount | undefined {
    return this.accounts.get(accountId);
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
  }

  exportConfig(): any {
    return {
      accounts: Array.from(this.accounts.values()),
    };
  }

  setAccountStatus(accountId: string, status: 'active' | 'limited' | 'error' | 'disabled'): CodingPlanAccount | undefined {
    const account = this.accounts.get(accountId);
    if (account) {
      account.status = status;
      account.metadata.updatedAt = new Date();
      return account;
    }
    return undefined;
  }
}

/**
 * Load pool configuration from file
 */
async function loadPoolManager(): Promise<PoolManager> {
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
async function savePoolConfig(poolManager: PoolManager): Promise<void> {
  await fs.mkdir(POOL_CONFIG_DIR, { recursive: true });
  const config = poolManager.exportConfig();
  await fs.writeFile(POOL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`${GREEN}✓${RESET} Pool configuration saved.\n`);
}

/**
 * Pool set-status command action
 */
async function setAccountStatus(accountId: string, status: string): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}        Set Account Status${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  // Validate status
  const validStatuses: Array<'active' | 'limited' | 'error' | 'disabled'> = ['active', 'limited', 'error', 'disabled'];
  if (!validStatuses.includes(status as any)) {
    console.error(`${BOLDRED}Error:${RESET} Invalid status "${status}". Must be one of: active, limited, error, disabled`);
    console.error(`${DIM}Usage: ccr pool set-status <accountId> <status>${RESET}\n`);
    process.exit(1);
  }

  const poolManager = await loadPoolManager();
  const account = poolManager.getAccount(accountId);

  if (!account) {
    console.error(`${BOLDRED}Error:${RESET} Account "${accountId}" not found.`);
    console.error(`${DIM}Use "ccr pool list" to see all available accounts.${RESET}\n`);
    process.exit(1);
  }

  const oldStatus = account.status;
  poolManager.setAccountStatus(accountId, status as any);
  await savePoolConfig(poolManager);

  console.log(`${GREEN}✓${RESET} Account status updated successfully!\n`);
  console.log(`${BOLDCYAN}Status Change:${RESET}`);
  console.log(`  ${GREEN}Account:${RESET} ${account.name} (${account.id})`);
  console.log(`  ${GREEN}Old Status:${RESET} ${oldStatus}`);
  console.log(`  ${GREEN}New Status:${RESET} ${status}`);
  console.log('');
}

/**
 * Create pool set-status command
 */
export function createPoolSetStatusCommand(): Command {
  const poolSetStatusCommand = new Command('set-status')
    .description('Set account status (active/limited/error/disabled)')
    .usage('<accountId> <status>')
    .action(async () => {
      try {
        // Get arguments from command line
        const args = process.argv.slice(process.argv.indexOf('set-status') + 1);
        const accountId = args.find(arg => !arg.startsWith('-'));
        const status = args[args.indexOf(accountId!) + 1];

        if (!accountId || !status) {
          console.error(`${BOLDRED}Error:${RESET} Account ID and status are required.\n`);
          console.log(`Usage: ccr pool set-status <accountId> <status>\n`);
          process.exit(1);
        }

        await setAccountStatus(accountId, status);
      } catch (error: any) {
        console.error(`${BOLDRED}Error:${RESET} ${error.message}\n`);
        process.exit(1);
      }
    });

  return poolSetStatusCommand;
}

export default createPoolSetStatusCommand;
