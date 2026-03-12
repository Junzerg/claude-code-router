import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';

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

// Server config for API access
const SERVER_CONFIG_FILE = path.join(POOL_CONFIG_DIR, 'config.json');

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
 * Fetch real-time pool status from running server API
 */
async function fetchRealTimeStatus(): Promise<{ summary: any; accounts: CodingPlanAccount[] } | null> {
  try {
    // Load server config to get PORT and APIKEY
    let port = 3456;
    let apiKey = '';
    try {
      const configContent = await fs.readFile(SERVER_CONFIG_FILE, 'utf-8');
      const config = JSON.parse(configContent);
      port = config.PORT || 3456;
      apiKey = config.APIKEY || '';
    } catch {
      // Use defaults
    }

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: '/pool/status',
          method: 'GET',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(data);
                // Transform API response to CodingPlanAccount format
                const accounts: CodingPlanAccount[] = (json.accounts || []).map((acc: any) => ({
                  id: acc.id,
                  name: acc.name,
                  platform: 'zai' as const,
                  apiKey: '',
                  apiBaseUrl: '',
                  status: acc.status,
                  concurrency: {
                    current: acc.concurrency?.current || 0,
                    max: acc.concurrency?.max || 3,
                    lastUpdated: new Date(),
                  },
                  usage: {
                    last5Hours: acc.usage?.last5Hours || 0,
                    weekly: acc.usage?.weekly || 0,
                    last5HoursLimit: acc.usage?.last5HoursLimit || 100000,
                    weeklyLimit: acc.usage?.weeklyLimit || 500000,
                    lastSyncedAt: new Date(),
                  },
                  config: {
                    maxConcurrency: acc.concurrency?.max || 3,
                    last5HoursLimit: acc.usage?.last5HoursLimit || 100000,
                    weeklyLimit: acc.usage?.weeklyLimit || 500000,
                    bufferRatio: 0.1,
                  },
                  metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastUsedAt: acc.lastUsedAt ? new Date(acc.lastUsedAt) : undefined,
                  },
                }));
                resolve({ summary: json.summary, accounts });
              } catch {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  } catch {
    return null;
  }
}

/**
 * Pool status summary
 */
interface PoolStatusSummary {
  total: number;
  active: number;
  limited: number;
  error: number;
  disabled: number;
  totalConcurrency: number;
  usedConcurrency: number;
  availableConcurrency: number;
}

/**
 * Calculate pool status summary
 */
function getPoolStatusSummary(accounts: CodingPlanAccount[]): PoolStatusSummary {
  const summary: PoolStatusSummary = {
    total: accounts.length,
    active: 0,
    limited: 0,
    error: 0,
    disabled: 0,
    totalConcurrency: 0,
    usedConcurrency: 0,
    availableConcurrency: 0,
  };

  for (const account of accounts) {
    // Count by status
    switch (account.status) {
      case 'active':
        summary.active++;
        break;
      case 'limited':
        summary.limited++;
        break;
      case 'error':
        summary.error++;
        break;
      case 'disabled':
        summary.disabled++;
        break;
    }

    // Sum concurrency
    summary.totalConcurrency += account.concurrency.max;
    summary.usedConcurrency += account.concurrency.current;
    summary.availableConcurrency += account.concurrency.max - account.concurrency.current;
  }

  return summary;
}

/**
 * Display pool status summary
 */
function displayPoolStatusSummary(accounts: CodingPlanAccount[], isRealTime: boolean = false): void {
  const status = getPoolStatusSummary(accounts);

  console.log('');
  console.log(`${BOLDCYAN}账号池状态${RESET}${isRealTime ? ` ${GREEN}(实时)${RESET}` : ''}`);
  console.log(`${DIM}${'\u2500'.repeat(40)}${RESET}`);
  console.log(`${GREEN}总账号数：${RESET}${status.total}`);
  console.log(`${BOLDGREEN}活跃账号：${RESET}${status.active}`);
  console.log(`${BOLDYELLOW}受限账号：${RESET}${status.limited}`);
  console.log(`${BOLDRED}错误账号：${RESET}${status.error}`);
  if (status.disabled > 0) {
    console.log(`${DIM}禁用账号：${RESET}${status.disabled}`);
  }
  console.log('');
  console.log(`${BOLDCYAN}并发统计:${RESET}`);
  console.log(`  ${GREEN}总槽位数：${RESET}${status.totalConcurrency}`);
  console.log(`  ${YELLOW}已用槽位：${RESET}${status.usedConcurrency}`);
  console.log(`  ${BOLDGREEN}可用槽位：${RESET}${status.availableConcurrency}`);
  console.log('');
}

/**
 * Display single account detail
 */
function displayAccountDetail(account: CodingPlanAccount): void {
  const usage5hPercent = Math.round((account.usage.last5Hours / account.config.last5HoursLimit) * 100);
  const weeklyPercent = Math.round((account.usage.weekly / account.config.weeklyLimit) * 100);
  const createdAt = new Date(account.metadata.createdAt).toLocaleString('zh-CN');
  const updatedAt = new Date(account.metadata.updatedAt).toLocaleString('zh-CN');

  console.log('');
  console.log(`${BOLDCYAN}账号详情 (${account.id})${RESET}`);
  console.log(`${DIM}${'\u2500'.repeat(40)}${RESET}`);
  console.log(`  ${GREEN}名称：${RESET}${account.name}`);
  console.log(`  ${GREEN}平台：${RESET}${account.platform}`);
  console.log(`  ${GREEN}状态：${RESET}${account.status}`);
  console.log(`  ${GREEN}并发：${RESET}${account.concurrency.current}/${account.concurrency.max}`);
  console.log(`  ${GREEN}5h 用量：${RESET}${usage5hPercent}% (${account.usage.last5Hours}/${account.config.last5HoursLimit})`);
  console.log(`  ${GREEN}周用量：${RESET}${weeklyPercent}% (${account.usage.weekly}/${account.config.weeklyLimit})`);
  console.log(`  ${GREEN}创建时间：${RESET}${createdAt}`);
  console.log(`  ${GREEN}更新时间：${RESET}${updatedAt}`);
  if (account.usage.lastSyncedAt) {
    console.log(`  ${GREEN}最后同步：${RESET}${account.usage.lastSyncedAt.toLocaleString('zh-CN')}`);
  }
  console.log('');
}

/**
 * Display account detail in JSON format
 */
function displayAccountDetailJson(account: CodingPlanAccount): void {
  console.log(JSON.stringify(account, null, 2));
}

/**
 * Pool status command action
 */
async function showStatus(accountId?: string, options?: { json?: boolean }): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}        Z.ai Coding Plan Pool Status${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  // Try to fetch real-time status from running server first
  let accounts: CodingPlanAccount[];
  let isRealTime = false;

  const realTimeData = await fetchRealTimeStatus();
  if (realTimeData && realTimeData.accounts.length > 0) {
    accounts = realTimeData.accounts;
    isRealTime = true;
  } else {
    // Fallback to file-based status
    const poolManager = await loadPoolManager();
    accounts = poolManager.getAllAccounts();
  }

  if (accountId) {
    // Show specific account detail
    const account = accounts.find(a => a.id === accountId);
    if (!account) {
      console.error(`${BOLDRED}Error:${RESET} Account "${accountId}" not found.`);
      console.error(`${DIM}Use "ccr pool list" to see all available accounts.${RESET}\n`);
      process.exit(1);
    }

    if (options?.json) {
      displayAccountDetailJson(account);
    } else {
      displayAccountDetail(account);
    }
  } else {
    // Show pool summary
    if (options?.json) {
      const summary = getPoolStatusSummary(accounts);
      console.log(JSON.stringify({ summary, accounts, realTime: isRealTime }, null, 2));
    } else {
      displayPoolStatusSummary(accounts, isRealTime);

      // Show brief account list if there are accounts
      if (accounts.length > 0) {
        console.log(`${DIM}账号列表:${RESET}`);
        console.log(`${DIM}${'\u2500'.repeat(40)}${RESET}`);
        for (const account of accounts) {
          const usagePercent = Math.round((account.usage.last5Hours / account.config.last5HoursLimit) * 100);
          const statusColor = account.status === 'active' ? BOLDGREEN : account.status === 'limited' ? BOLDYELLOW : BOLDRED;
          console.log(`  ${statusColor}${account.status.padEnd(8)}${RESET} ${account.id.padEnd(15)} ${(account.name || '').padEnd(10)} ${account.concurrency.current}/${account.concurrency.max}并发 ${usagePercent}%`);
        }
        console.log('');
      }
    }
  }
}

/**
 * Create pool status command
 */
export function createPoolStatusCommand(): Command {
  const poolStatusCommand = new Command('status')
    .description('Show Z.ai Coding Plan account pool status')
    .usage('[options] [accountId]')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      try {
        // Get accountId from command line args (last non-option argument)
        const args = process.argv.slice(process.argv.indexOf('status') + 1);
        const accountId = args.find(arg => !arg.startsWith('-') && arg !== '--json');

        await showStatus(accountId, options);
      } catch (error: any) {
        console.error(`${BOLDRED}Error:${RESET} ${error.message}\n`);
        process.exit(1);
      }
    });

  return poolStatusCommand;
}

export default createPoolStatusCommand;
