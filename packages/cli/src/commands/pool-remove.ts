import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
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
  }

  exportConfig(): any {
    return {
      accounts: Array.from(this.accounts.values()),
    };
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
 * Save pool configuration to file
 */
async function savePoolConfig(poolManager: PoolManager): Promise<void> {
  await fs.mkdir(POOL_CONFIG_DIR, { recursive: true });
  const config = poolManager.exportConfig();
  await fs.writeFile(POOL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Display account information
 */
function displayAccount(account: CodingPlanAccount): void {
  console.log(`  ${GREEN}ID:${RESET}         ${account.id}`);
  console.log(`  ${GREEN}Name:${RESET}       ${account.name}`);
  console.log(`  ${GREEN}Platform:${RESET}   ${account.platform}`);
  console.log(`  ${GREEN}Status:${RESET}     ${account.status}`);
  console.log(`  ${GREEN}Concurrency:${RESET} ${account.concurrency.current}/${account.concurrency.max}`);
  console.log(`  ${GREEN}5h Usage:${RESET}   ${Math.round(account.usage.last5Hours / account.config.last5HoursLimit * 100)}% (${account.usage.last5Hours}/${account.config.last5HoursLimit})`);
  console.log(`  ${GREEN}Weekly Usage:${RESET} ${Math.round(account.usage.weekly / account.config.weeklyLimit * 100)}% (${account.usage.weekly}/${account.config.weeklyLimit})`);
}

/**
 * Pool remove command action
 */
async function removeAccount(accountId: string, options: { force?: boolean; yes?: boolean }): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}       Remove Z.ai Coding Plan Account${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  const poolManager = await loadPoolManager();
  const account = poolManager.getAccount(accountId);

  // Check if account exists
  if (!account) {
    console.error(`${BOLDRED}Error:${RESET} Account "${accountId}" not found.\n`);
    console.log(`${DIM}Available accounts:${RESET}`);
    const accounts = poolManager.getAllAccounts();
    if (accounts.length === 0) {
      console.log(`${DIM}  No accounts in pool.${RESET}\n`);
    } else {
      for (const acc of accounts) {
        console.log(`${DIM}  - ${acc.id}: ${acc.name}${RESET}`);
      }
      console.log('');
    }
    process.exit(1);
  }

  // Check for active sessions
  if (account.concurrency.current > 0) {
    if (!options.force) {
      console.error(`${BOLDYELLOW}Warning:${RESET} Account "${account.name}" has ${account.concurrency.current} active session(s).`);
      console.error(`${DIM}Use --force to delete anyway.${RESET}\n`);
      process.exit(1);
    } else {
      console.log(`${BOLDYELLOW}Warning:${RESET} Forcing deletion with ${account.concurrency.current} active session(s).\n`);
    }
  }

  // Confirm deletion
  if (!options.yes) {
    console.log(`${BOLDCYAN}Account to delete:${RESET}`);
    displayAccount(account);
    console.log('');

    const confirmed = await confirm({
      message: `Are you sure you want to delete account "${account.name}"?`,
      default: false,
    });

    if (!confirmed) {
      console.log(`\n${YELLOW}Cancelled.${RESET}\n`);
      return;
    }
  }

  // Remove the account
  poolManager.removeAccount(accountId);
  await savePoolConfig(poolManager);

  console.log(`\n${GREEN}✓${RESET} Account deleted successfully.\n`);
  console.log(`${BOLDCYAN}Deleted account:${RESET}`);
  console.log(`  ${GREEN}ID:${RESET}   ${account.id}`);
  console.log(`  ${GREEN}Name:${RESET} ${account.name}`);
  console.log('');
}

/**
 * Create pool remove command
 */
export function createPoolRemoveCommand(): Command {
  const poolRemoveCommand = new Command('remove')
    .description('Remove a Z.ai Coding Plan account from the pool')
    .usage('[options] <accountId>')
    .option('-f, --force', 'Force delete (even with active sessions)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options) => {
      try {
        // Get accountId from command line args
        const accountId = process.argv[process.argv.length - 1];
        if (!accountId || accountId.startsWith('-')) {
          console.error(`${BOLDRED}Error:${RESET} Account ID is required.\n`);
          console.log(`Usage: ccr pool remove [options] <accountId>\n`);
          process.exit(1);
        }
        await removeAccount(accountId, options);
      } catch (error: any) {
        console.error(`${BOLDRED}Error:${RESET} ${error.message}\n`);
        process.exit(1);
      }
    });

  return poolRemoveCommand;
}

export default createPoolRemoveCommand;
