import * as fs from 'fs';
import * as path from 'path';
import { PoolManager } from './pool-manager';
import { CodingPlanAccount } from '../types/pool';

/**
 * Pool storage configuration
 */
export interface PoolStorageConfig {
  /** Storage file path (default: ~/.claude-code-router/pool-config.json) */
  filePath?: string;
  /** Auto-save interval in milliseconds (default: 30000 = 30s) */
  autoSaveInterval?: number;
  /** Number of backups to keep (default: 3) */
  maxBackups?: number;
}

/**
 * Serialized pool configuration for storage
 */
export interface SerializedPoolConfig {
  version: string;
  lastSavedAt: string;
  pool: {
    enabled: boolean;
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
    accounts: SerializedAccount[];
  };
}

/**
 * Serialized account (without runtime state)
 */
export interface SerializedAccount {
  id: string;
  name: string;
  platform: 'zai' | 'zhipu';
  apiKey: string;
  apiBaseUrl: string;
  status: string;
  config: {
    maxConcurrency: number;
    last5HoursLimit: number;
    weeklyLimit: number;
    bufferRatio: number;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
  };
}

/**
 * Pool Storage
 *
 * Handles persistence of pool configuration to JSON file.
 *
 * Features:
 * - Auto-load configuration on startup
 * - Auto-save on modifications
 * - Backup management (keeps last N backups)
 * - Atomic writes (write to temp, then rename)
 *
 * Usage:
 * ```typescript
 * const storage = new PoolStorage(poolManager, { filePath: './pool-config.json' });
 * await storage.load(); // Load on startup
 * await storage.save(); // Manual save
 * storage.destroy(); // Stop auto-save
 * ```
 */
export class PoolStorage {
  private poolManager: PoolManager;
  private config: PoolStorageConfig;
  private autoSaveTimer?: NodeJS.Timeout;
  private pendingSave = false;
  private filePath: string;

  /**
   * Create PoolStorage instance
   * @param poolManager - PoolManager instance to persist
   * @param config - Storage configuration
   */
  constructor(poolManager: PoolManager, config?: PoolStorageConfig) {
    this.poolManager = poolManager;
    this.config = {
      filePath: config?.filePath || this.getDefaultFilePath(),
      autoSaveInterval: config?.autoSaveInterval || 30000,
      maxBackups: config?.maxBackups || 3,
    };
    this.filePath = this.config.filePath;
  }

  /**
   * Get default storage file path
   * @returns Default file path
   */
  private getDefaultFilePath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    return path.join(homeDir, '.claude-code-router', 'pool-config.json');
  }

  /**
   * Ensure directory exists
   * @param filePath - File path
   */
  private ensureDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load configuration from file (synchronous version)
   * @returns true if loaded successfully, false if file doesn't exist
   * @throws Error if file is corrupted
   */
  loadSync(): boolean {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log(`[PoolStorage] Config file not found: ${this.filePath}`);
        return false;
      }

      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Support both formats:
      // 1. New format: { version: "1.0.0", pool: { enabled: true, accounts: [...] } }
      // 2. Old format (CLI): { defaultMaxConcurrency: 3, accounts: [...] }
      let poolConfig: any;
      if (parsed.pool && typeof parsed.pool === 'object') {
        // New format
        const serialized = parsed as SerializedPoolConfig;
        console.log(
          `[PoolStorage] Loaded config from ${this.filePath} (version: ${serialized.version})`
        );
        poolConfig = serialized.pool;
      } else if (parsed.accounts && Array.isArray(parsed.accounts)) {
        // Old format (CLI saved) - wrap it
        console.log(
          `[PoolStorage] Loaded config from ${this.filePath} (legacy format, migrating...)`
        );
        poolConfig = {
          enabled: true,
          defaultMaxConcurrency: parsed.defaultMaxConcurrency,
          bufferRatio: parsed.defaultBufferRatio,
          accounts: parsed.accounts,
        };
      } else {
        throw new Error('Invalid config format: missing pool or accounts');
      }

      // Import configuration to PoolManager
      this.poolManager.importConfig(poolConfig);

      return true;
    } catch (error: any) {
      console.error(
        `[PoolStorage] Failed to load config: ${error.message}`
      );
      throw new Error(
        `Failed to load pool configuration: ${error.message}`
      );
    }
  }

  /**
   * Load configuration from file
   * @returns true if loaded successfully, false if file doesn't exist
   * @throws Error if file is corrupted
   */
  async load(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log(`[PoolStorage] Config file not found: ${this.filePath}`);
        return false;
      }

      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Support both formats:
      // 1. New format: { version: "1.0.0", pool: { enabled: true, accounts: [...] } }
      // 2. Old format (CLI): { defaultMaxConcurrency: 3, accounts: [...] }
      let poolConfig: any;
      if (parsed.pool && typeof parsed.pool === 'object') {
        // New format
        const serialized = parsed as SerializedPoolConfig;
        console.log(
          `[PoolStorage] Loaded config from ${this.filePath} (version: ${serialized.version})`
        );
        poolConfig = serialized.pool;
      } else if (parsed.accounts && Array.isArray(parsed.accounts)) {
        // Old format (CLI saved) - wrap it
        console.log(
          `[PoolStorage] Loaded config from ${this.filePath} (legacy format, migrating...)`
        );
        poolConfig = {
          enabled: true,
          defaultMaxConcurrency: parsed.defaultMaxConcurrency,
          bufferRatio: parsed.defaultBufferRatio,
          accounts: parsed.accounts,
        };
      } else {
        throw new Error('Invalid config format: missing pool or accounts');
      }

      // Import configuration to PoolManager
      this.poolManager.importConfig(poolConfig);

      return true;
    } catch (error: any) {
      console.error(
        `[PoolStorage] Failed to load config: ${error.message}`
      );
      throw new Error(
        `Failed to load pool configuration: ${error.message}`
      );
    }
  }

  /**
   * Save configuration to file
   * @returns true if saved successfully
   * @throws Error if save fails
   */
  async save(): Promise<boolean> {
    try {
      this.ensureDirectory(this.filePath);

      // Create backup if file exists
      if (fs.existsSync(this.filePath)) {
        await this.createBackup();
      }

      // Serialize configuration
      const serialized = this.serializeConfig();

      // Write to temp file first (atomic write)
      const tempFile = `${this.filePath}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(serialized, null, 2), 'utf-8');

      // Rename temp file to target (atomic on most filesystems)
      fs.renameSync(tempFile, this.filePath);

      console.log(`[PoolStorage] Config saved to ${this.filePath}`);
      this.pendingSave = false;

      return true;
    } catch (error: any) {
      console.error(
        `[PoolStorage] Failed to save config: ${error.message}`
      );
      this.pendingSave = false;
      throw new Error(`Failed to save pool configuration: ${error.message}`);
    }
  }

  /**
   * Create backup of current config file
   */
  private async createBackup(): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${this.filePath}.backup.${timestamp}`;

    try {
      fs.copyFileSync(this.filePath, backupPath);
      console.log(`[PoolStorage] Created backup: ${backupPath}`);

      // Clean up old backups
      await this.cleanupBackups();
    } catch (error: any) {
      console.warn(
        `[PoolStorage] Failed to create backup: ${error.message}`
      );
      // Don't throw - backup failure shouldn't block save
    }
  }

  /**
   * Clean up old backups, keeping only maxBackups most recent
   */
  private async cleanupBackups(): Promise<void> {
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath);

    try {
      const files = fs.readdirSync(dir);
      const backups = files
        .filter((f) => f.startsWith(`${baseName}.backup.`))
        .sort()
        .reverse();

      // Remove old backups
      if (backups.length > this.config.maxBackups!) {
        for (let i = this.config.maxBackups!; i < backups.length; i++) {
          const backupPath = path.join(dir, backups[i]);
          fs.unlinkSync(backupPath);
          console.log(`[PoolStorage] Removed old backup: ${backupPath}`);
        }
      }
    } catch (error: any) {
      console.warn(
        `[PoolStorage] Failed to cleanup backups: ${error.message}`
      );
    }
  }

  /**
   * Serialize PoolManager configuration
   * @returns Serialized configuration
   */
  private serializeConfig(): SerializedPoolConfig {
    const poolConfig = this.poolManager.exportConfig() as any;

    // Convert accounts to serialized format (convert Dates to ISO strings)
    const serializedAccounts: SerializedAccount[] = poolConfig.accounts.map(
      (acc: CodingPlanAccount) => ({
        id: acc.id,
        name: acc.name,
        platform: acc.platform,
        apiKey: acc.apiKey,
        apiBaseUrl: acc.apiBaseUrl,
        status: acc.status,
        config: {
          maxConcurrency: acc.config.maxConcurrency,
          last5HoursLimit: acc.config.last5HoursLimit,
          weeklyLimit: acc.config.weeklyLimit,
          bufferRatio: acc.config.bufferRatio,
        },
        metadata: {
          createdAt: acc.metadata.createdAt.toISOString(),
          updatedAt: acc.metadata.updatedAt.toISOString(),
          lastUsedAt: acc.metadata.lastUsedAt?.toISOString(),
        },
      })
    );

    return {
      version: '1.0.0',
      lastSavedAt: new Date().toISOString(),
      pool: {
        enabled: poolConfig.enabled,
        defaultMaxConcurrency: poolConfig.defaultMaxConcurrency,
        bufferRatio: poolConfig.bufferRatio,
        sessionBinding: poolConfig.sessionBinding,
        errorRecovery: poolConfig.errorRecovery,
        usageSync: poolConfig.usageSync,
        accounts: serializedAccounts,
      },
    };
  }

  /**
   * Start auto-save timer
   */
  startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      if (this.pendingSave) {
        this.save().catch((err) => {
          console.error(`[PoolStorage] Auto-save failed: ${err.message}`);
        });
      }
    }, this.config.autoSaveInterval);

    console.log(
      `[PoolStorage] Auto-save started (interval: ${this.config.autoSaveInterval}ms)`
    );
  }

  /**
   * Mark configuration as dirty (needs save)
   * This is called when pool configuration changes
   */
  markDirty(): void {
    this.pendingSave = true;
  }

  /**
   * Stop auto-save timer and perform final save
   */
  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }

    // Final save if there are pending changes
    if (this.pendingSave) {
      this.save().catch((err) => {
        console.error(`[PoolStorage] Final save failed: ${err.message}`);
      });
    }

    console.log(`[PoolStorage] Storage destroyed`);
  }

  /**
   * Get storage file path
   * @returns Current file path
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if configuration file exists
   * @returns true if file exists
   */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /**
   * Get last save time
   * @returns Last save timestamp or null if never saved
   */
  getLastSaveTime(): Date | null {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    const stats = fs.statSync(this.filePath);
    return stats.mtime;
  }
}

/**
 * Create and initialize PoolStorage with auto-save
 * @param poolManager - PoolManager instance
 * @param config - Storage configuration
 * @returns PoolStorage instance (auto-save started)
 */
export function createPoolStorage(
  poolManager: PoolManager,
  config?: PoolStorageConfig
): PoolStorage {
  const storage = new PoolStorage(poolManager, config);

  // Load existing config synchronously to ensure accounts are available immediately
  try {
    storage.loadSync();
  } catch (err: any) {
    console.warn(`[PoolStorage] Initial load failed: ${err.message}`);
  }

  // Start auto-save
  storage.startAutoSave();

  return storage;
}
