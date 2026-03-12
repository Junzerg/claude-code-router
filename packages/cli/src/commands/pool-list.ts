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
const DIM = '\x1B[2m';
const BOLDGREEN = '\x1B[1m\x1B[32m';

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
 * Get status display color
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return BOLDGREEN;
    case 'limited':
      return BOLDYELLOW;
    case 'error':
    case 'disabled':
      return BOLDRED;
    default:
      return RESET;
  }
}

/**
 * Display accounts in table format
 */
function displayAccountsTable(accounts: CodingPlanAccount[], verbose: boolean): void {
  if (accounts.length === 0) {
    console.log(`${DIM}  No accounts in pool.${RESET}\n`);
    return;
  }

  console.log('');
  console.log(`${BOLDCYAN}┌─────────────────┬────────────┬─────────┬──────────┬───────────────┬─────────────┐${RESET}`);
  console.log(`${BOLDCYAN}│ ID              │ 名称       │ 平台    │ 状态     │ 并发 (使用/最大)│ 5h 用量     │${RESET}`);
  console.log(`${BOLDCYAN}├─────────────────┼────────────┼─────────┼──────────┼───────────────┼─────────────┤${RESET}`);

  for (const account of accounts) {
    const statusColor = getStatusColor(account.status);
    const usagePercent = Math.round((account.usage.last5Hours / account.config.last5HoursLimit) * 100);
    const usageColor = usagePercent > 90 ? RED : usagePercent > 70 ? YELLOW : GREEN;

    const id = account.id.padEnd(15);
    const name = (account.name || account.id).substring(0, 10).padEnd(10);
    const platform = (account.platform || 'unknown').padEnd(7);
    const status = `${statusColor}${account.status.padEnd(8)}${RESET}`;
    const concurrency = `${account.concurrency.current}/${account.concurrency.max}`.padEnd(13);
    const usage = `${usageColor}${usagePercent}%${RESET}`.padEnd(11);

    console.log(`${BOLDCYAN}│${RESET} ${id} │${RESET} ${name} ${RESET}│${RESET} ${platform} │${RESET} ${status} │${RESET} ${concurrency} │${RESET} ${usage} ${BOLDCYAN}│${RESET}`);

    if (verbose) {
      const weeklyPercent = Math.round((account.usage.weekly / account.config.weeklyLimit) * 100);
      const createdAt = new Date(account.metadata.createdAt).toLocaleString('zh-CN');
      console.log(`${DIM}  └─ 周用量：${weeklyPercent}% (${account.usage.weekly}/${account.config.weeklyLimit}) | 创建时间：${createdAt}${RESET}`);
    }
  }

  console.log(`${BOLDCYAN}└─────────────────┴────────────┴─────────┴──────────┴───────────────┴─────────────┘${RESET}`);
  console.log('');
}

/**
 * Display accounts in JSON format
 */
function displayAccountsJson(accounts: CodingPlanAccount[]): void {
  console.log(JSON.stringify(accounts, null, 2));
}

/**
 * Pool list command action
 */
async function listAccounts(options: { status?: string; verbose?: boolean; json?: boolean }): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}        Z.ai Coding Plan Account List${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  const poolManager = await loadPoolManager();
  let accounts = poolManager.getAllAccounts();

  // Filter by status if specified
  if (options.status) {
    const validStatuses = ['active', 'limited', 'error', 'disabled'];
    if (!validStatuses.includes(options.status.toLowerCase())) {
      console.error(`${BOLDRED}Error:${RESET} Invalid status "${options.status}".`);
      console.error(`${DIM}Valid statuses: ${validStatuses.join(', ')}${RESET}\n`);
      process.exit(1);
    }
    accounts = accounts.filter(a => a.status === options.status.toLowerCase());
  }

  // Sort accounts by status priority (active first, then limited, error, disabled)
  const statusPriority: Record<string, number> = { active: 0, limited: 1, error: 2, disabled: 3 };
  accounts.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);

  // Display results
  if (options.json) {
    displayAccountsJson(accounts);
  } else {
    console.log(`${DIM}Total: ${accounts.length} account(s)${RESET}\n`);
    displayAccountsTable(accounts, options.verbose || false);
  }

  // Show status legend
  if (!options.json && accounts.length > 0) {
    console.log(`${DIM}Status legend:${RESET}`);
    console.log(`${DIM}  ${BOLDGREEN}active${RESET}  ${DIM}- Normal operation${RESET}`);
    console.log(`${DIM}  ${BOLDYELLOW}limited${RESET} ${DIM}- Usage limit reached${RESET}`);
    console.log(`${DIM}  ${BOLDRED}error${RESET}   ${DIM}- API error${RESET}`);
    console.log(`${DIM}  ${BOLDRED}disabled${RESET} ${DIM}- Manually disabled${RESET}`);
    console.log('');
  }
}

/**
 * Create pool list command
 */
export function createPoolListCommand(): Command {
  const poolListCommand = new Command('list')
    .description('List all Z.ai Coding Plan accounts in the pool')
    .option('-s, --status <string>', 'Filter by status (active/limited/error/disabled)')
    .option('-v, --verbose', 'Show detailed information')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      try {
        await listAccounts(options);
      } catch (error: any) {
        console.error(`${BOLDRED}Error:${RESET} ${error.message}\\n`);
        process.exit(1);
      }
    });

  return poolListCommand;
}

export default createPoolListCommand;
