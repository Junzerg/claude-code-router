import { Command } from 'commander';
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

/**
 * Session binding information
 */
interface SessionBinding {
  sessionId: string;
  accountId: string;
  createdAt: string;
  lastActiveAt: string;
  ttlMinutes: number;
}

/**
 * Pool binding API response
 */
interface PoolBindingResponse {
  bindings: SessionBinding[];
  stats: {
    totalBindings: number;
    ttlMinutes: number;
    breakOnLimited: boolean;
    isCleanupRunning: boolean;
  };
}

/**
 * Get port from environment or default
 */
function getServerPort(): number {
  return parseInt(process.env.CCR_PORT || '3000', 10);
}

/**
 * Fetch bindings from server API
 */
async function fetchBindings(): Promise<PoolBindingResponse> {
  return new Promise((resolve, reject) => {
    const port = getServerPort();
    const options = {
      hostname: 'localhost',
      port,
      path: '/api/pool/bindings',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }

        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`JSON parse error: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to fetch bindings: ${err.message}. Is the server running?`));
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Format time ago from timestamp
 */
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return '刚刚';
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`;
  } else if (diffMins < 1440) {
    const hours = Math.floor(diffMins / 60);
    return `${hours}小时前`;
  } else {
    const days = Math.floor(diffMins / 1440);
    return `${days}天前`;
  }
}

/**
 * Format date to readable string
 */
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Display bindings in table format
 */
function displayBindingsTable(bindings: SessionBinding[]): void {
  if (bindings.length === 0) {
    console.log(`${DIM}  没有活跃的绑定${RESET}\n`);
    return;
  }

  console.log('');
  console.log(`${BOLDCYAN}┌──────────────────────────────┬─────────────────┬──────────────┬─────────────┐${RESET}`);
  console.log(`${BOLDCYAN}│ 会话 ID                      │ 账号 ID         │ 创建时间     │ 最后活跃    │${RESET}`);
  console.log(`${BOLDCYAN}├──────────────────────────────┼─────────────────┼──────────────┼─────────────┤${RESET}`);

  for (const binding of bindings) {
    const sessionId = binding.sessionId.substring(0, 26).padEnd(28);
    const accountId = binding.accountId.substring(0, 15).padEnd(15);
    const createdAt = formatDateTime(binding.createdAt).padEnd(12);
    const lastActive = formatTimeAgo(binding.lastActiveAt).padEnd(11);

    console.log(`${BOLDCYAN}│${RESET} ${sessionId} │${RESET} ${accountId} │${RESET} ${createdAt} │${RESET} ${lastActive} ${BOLDCYAN}│${RESET}`);
  }

  console.log(`${BOLDCYAN}└──────────────────────────────┴─────────────────┴──────────────┴─────────────┘${RESET}`);
  console.log('');
}

/**
 * Display bindings in JSON format
 */
function displayBindingsJson(response: PoolBindingResponse): void {
  console.log(JSON.stringify(response, null, 2));
}

/**
 * Display binding stats
 */
function displayBindingStats(stats: PoolBindingResponse['stats']): void {
  console.log('');
  console.log(`${BOLDCYAN}绑定统计${RESET}`);
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
  console.log(`${GREEN}总绑定数：${RESET}${stats.totalBindings}`);
  console.log(`${GREEN}TTL: ${RESET}${stats.ttlMinutes} 分钟`);
  console.log(`${GREEN}受限解除：${RESET}${stats.breakOnLimited ? '启用' : '禁用'}`);
  console.log(`${GREEN}自动清理：${RESET}${stats.isCleanupRunning ? '运行中' : '已停止'}`);
  console.log('');
}

/**
 * Clear all bindings via API
 */
async function clearAllBindings(): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = getServerPort();
    const options = {
      hostname: 'localhost',
      port,
      path: '/api/pool/bindings/clear',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }

        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve({ message: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to clear bindings: ${err.message}. Is the server running?`));
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Remove specific binding via API
 */
async function removeBinding(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = getServerPort();
    const options = {
      hostname: 'localhost',
      port,
      path: `/api/pool/bindings/remove?sessionId=${encodeURIComponent(sessionId)}`,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }

        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve({ message: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to remove binding: ${err.message}. Is the server running?`));
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Pool binding command action
 */
async function handleBindingCommand(options: {
  list?: boolean;
  clear?: boolean;
  remove?: boolean;
  session?: string;
  json?: boolean;
}): Promise<void> {
  console.log(`\n${BOLDCYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLDCYAN}        Z.ai Coding Plan Session Bindings${RESET}`);
  console.log(`${BOLDCYAN}═══════════════════════════════════════════════${RESET}\n`);

  try {
    // Handle clear command
    if (options.clear) {
      if (!options.json) {
        console.log(`${YELLOW}正在清除所有绑定...${RESET}`);
      }
      await clearAllBindings();
      console.log(`${GREEN}✓ 已清除所有绑定${RESET}`);
      return;
    }

    // Handle remove command
    if (options.remove) {
      if (!options.session) {
        console.error(`${BOLDRED}Error:${RESET} --session is required with --remove`);
        console.error(`${DIM}Usage: ccr pool binding --remove --session <sessionId>${RESET}\n`);
        process.exit(1);
      }
      if (!options.json) {
        console.log(`${YELLOW}正在移除绑定：${options.session}...${RESET}`);
      }
      await removeBinding(options.session);
      console.log(`${GREEN}✓ 已移除绑定：${options.session}${RESET}`);
      return;
    }

    // Fetch and display bindings (default: list)
    const response = await fetchBindings();

    if (options.json) {
      displayBindingsJson(response);
    } else {
      displayBindingsTable(response.bindings);
      displayBindingStats(response.stats);
    }
  } catch (error: any) {
    console.error(`${BOLDRED}Error:${RESET} ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Create pool binding command
 */
export function createPoolBindingCommand(): Command {
  const poolBindingCommand = new Command('binding')
    .description('Manage session bindings')
    .option('-l, --list', 'List all bindings (default)')
    .option('-c, --clear', 'Clear all bindings')
    .option('-r, --remove', 'Remove a specific binding')
    .option('-s, --session <string>', 'Session ID (used with --remove)')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      await handleBindingCommand(options);
    });

  return poolBindingCommand;
}

export default createPoolBindingCommand;
