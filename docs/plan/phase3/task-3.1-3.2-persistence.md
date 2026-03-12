# Task 3.1-3.2: 状态持久化

**优先级**: P1
**预计时间**: 4 小时 (合计)
**依赖**: Phase 2 完成

---

## Task 3.1: 账号配置持久化

### 文件位置
`packages/core/src/services/pool-storage.ts`

### 功能说明

将账号池配置持久化到文件，服务重启后自动恢复。

### 核心功能

```typescript
/**
 * 账号池存储服务
 *
 * 功能:
 * - 将账号配置保存到 config.json
 * - 服务启动时加载配置
 * - 配置变更时自动备份
 */
export class PoolStorage {
  private configPath: string;
  private backupDir: string;

  constructor(options?: {
    configPath?: string;
    backupDir?: string;
  });

  /**
   * 加载配置
   */
  loadConfig(): Promise<PoolConfigData>;

  /**
   * 保存配置
   */
  saveConfig(config: PoolConfigData): Promise<void>;

  /**
   * 添加账号
   */
  addAccount(account: PoolAccountData): Promise<void>;

  /**
   * 删除账号
   */
  removeAccount(accountId: string): Promise<void>;

  /**
   * 更新账号
   */
  updateAccount(accountId: string, updates: Partial<PoolAccountData>): Promise<void>;

  /**
   * 创建备份
   */
  createBackup(): Promise<string>;
}

/**
 * 账号配置数据
 */
export interface PoolAccountData {
  id: string;
  name: string;
  apiKey: string;
  platform: 'zai' | 'zhipu';
  apiBaseUrl: string;
  config: {
    maxConcurrency: number;
    last5HoursLimit: number;
    weeklyLimit: number;
    bufferRatio: number;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * 账号池配置
 */
export interface PoolConfigData {
  enabled: boolean;
  accounts: PoolAccountData[];
  settings: {
    defaultMaxConcurrency: number;
    bufferRatio: number;
    sessionBinding: {
      enabled: boolean;
      ttlMinutes: number;
      breakOnLimited: boolean;
    };
    errorRecovery: {
      maxRetries: number;
      retryDelayMs: number;
    };
    usageSync: {
      enabled: boolean;
      intervalMinutes: number;
    };
  };
}
```

### 实现

```typescript
import fs from 'fs/promises';
import path from 'path';
import { PoolConfigData, PoolAccountData } from '../types/pool';

export class PoolStorage {
  private configPath: string;
  private backupDir: string;

  constructor(options: {
    configPath?: string;
    backupDir?: string;
  } = {}) {
    this.configPath = options.configPath ||
      path.join(require('os').homedir(), '.claude-code-router', 'pool-config.json');
    this.backupDir = options.backupDir ||
      path.join(require('os').homedir(), '.claude-code-router', 'backups');
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<PoolConfigData> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // 文件不存在，返回默认配置
      return this.getDefaultConfig();
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config: PoolConfigData): Promise<void> {
    // 创建备份
    await this.createBackup();

    // 确保目录存在
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });

    // 保存配置
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');

    logger.info('Pool config saved');
  }

  /**
   * 添加账号
   */
  async addAccount(account: PoolAccountData): Promise<void> {
    const config = await this.loadConfig();
    config.accounts.push(account);
    await this.saveConfig(config);
  }

  /**
   * 删除账号
   */
  async removeAccount(accountId: string): Promise<void> {
    const config = await this.loadConfig();
    config.accounts = config.accounts.filter(a => a.id !== accountId);
    await this.saveConfig(config);
  }

  /**
   * 更新账号
   */
  async updateAccount(
    accountId: string,
    updates: Partial<PoolAccountData>
  ): Promise<void> {
    const config = await this.loadConfig();
    const account = config.accounts.find(a => a.id === accountId);

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    Object.assign(account, updates, {
      metadata: {
        ...account.metadata,
        updatedAt: new Date().toISOString(),
      },
    });

    await this.saveConfig(config);
  }

  /**
   * 创建备份
   */
  async createBackup(): Promise<string> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupDir,
        `pool-config-${timestamp}.json`
      );

      // 复制当前配置到备份
      await fs.copyFile(this.configPath, backupPath);

      // 清理旧备份 (保留最近 10 个)
      await this.cleanupOldBackups();

      logger.debug(`Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      logger.warn('Backup failed:', error);
      return '';
    }
  }

  /**
   * 清理旧备份
   */
  private async cleanupOldBackups(): Promise<void> {
    const files = await fs.readdir(this.backupDir);
    const backupFiles = files
      .filter(f => f.startsWith('pool-config-'))
      .sort()
      .reverse();

    // 保留最近 10 个备份
    const oldFiles = backupFiles.slice(10);
    for (const file of oldFiles) {
      await fs.unlink(path.join(this.backupDir, file));
    }
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): PoolConfigData {
    return {
      enabled: true,
      accounts: [],
      settings: {
        defaultMaxConcurrency: 3,
        bufferRatio: 0.1,
        sessionBinding: {
          enabled: true,
          ttlMinutes: 60,
          breakOnLimited: true,
        },
        errorRecovery: {
          maxRetries: 3,
          retryDelayMs: 1000,
        },
        usageSync: {
          enabled: true,
          intervalMinutes: 5,
        },
      },
    };
  }
}
```

---

## Task 3.2: 会话绑定持久化 (可选)

### 文件位置
`packages/core/src/services/binding-storage.ts`

### 功能说明

可选功能：将会话绑定状态持久化，服务重启后恢复绑定关系。

### 核心功能

```typescript
export class BindingStorage {
  private storagePath: string;

  /**
   * 加载绑定
   */
  loadBindings(): Promise<Map<string, string>>;

  /**
   * 保存绑定
   */
  saveBindings(bindings: Map<string, string>): Promise<void>;

  /**
   * 添加绑定
   */
  addBinding(sessionId: string, accountId: string): Promise<void>;

  /**
   * 移除绑定
   */
  removeBinding(sessionId: string): Promise<void>;
}
```

### 实现

```typescript
export class BindingStorage {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ||
      path.join(require('os').homedir(), '.claude-code-router', 'bindings.json');
  }

  async loadBindings(): Promise<Map<string, string>> {
    try {
      const content = await fs.readFile(this.storagePath, 'utf-8');
      const data = JSON.parse(content);
      return new Map(Object.entries(data));
    } catch (error) {
      return new Map();
    }
  }

  async saveBindings(bindings: Map<string, string>): Promise<void> {
    const data = Object.fromEntries(bindings);
    await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
  }

  async addBinding(sessionId: string, accountId: string): Promise<void> {
    const bindings = await this.loadBindings();
    bindings.set(sessionId, accountId);
    await this.saveBindings(bindings);
  }

  async removeBinding(sessionId: string): Promise<void> {
    const bindings = await this.loadBindings();
    bindings.delete(sessionId);
    await this.saveBindings(bindings);
  }
}
```

---

## 验收标准

### PoolStorage
- [ ] 配置正确保存到文件
- [ ] 重启后正确加载配置
- [ ] 自动创建备份
- [ ] 旧备份自动清理

### BindingStorage
- [ ] 绑定关系正确保存
- [ ] 重启后恢复绑定
- [ ] 过期绑定自动清理

---

## 相关文件

- [Phase 3 计划](./README.md)
- [Phase 2 完成](../phase2/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
