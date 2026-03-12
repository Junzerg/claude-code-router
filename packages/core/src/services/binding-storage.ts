import * as fs from 'fs';
import * as path from 'path';
import { SessionBinder } from './session-binder';
import { SessionBinding } from '../types/pool';

/**
 * Binding storage configuration
 */
export interface BindingStorageConfig {
  /** Storage file path (default: ~/.claude-code-router/binding-storage.json) */
  filePath?: string;
  /** Auto-save interval in milliseconds (default: 30000 = 30s) */
  autoSaveInterval?: number;
  /** Number of backups to keep (default: 3) */
  maxBackups?: number;
}

/**
 * Serialized session binding for storage
 */
export interface SerializedSessionBinding {
  sessionId: string;
  accountId: string;
  createdAt: string;
  lastActiveAt: string;
  updatedAt: string;
  ttlMinutes: number;
}

/**
 * Serialized binding storage data
 */
export interface SerializedBindingStorage {
  version: string;
  lastSavedAt: string;
  bindings: SerializedSessionBinding[];
}

/**
 * Binding Storage
 *
 * Handles persistence of session bindings to JSON file.
 *
 * Features:
 * - Auto-load bindings on startup
 * - Auto-save on modifications
 * - Backup management (keeps last N backups)
 * - Atomic writes (write to temp, then rename)
 * - TTL expiration check on load
 *
 * Usage:
 * ```typescript
 * const storage = new BindingStorage(sessionBinder, { filePath: './binding-storage.json' });
 * await storage.load(); // Load on startup
 * await storage.save(); // Manual save
 * storage.destroy(); // Stop auto-save
 * ```
 */
export class BindingStorage {
  private sessionBinder: SessionBinder;
  private config: BindingStorageConfig;
  private autoSaveTimer?: NodeJS.Timeout;
  private pendingSave = false;
  private filePath: string;
  private onBindHandler: (sessionId: string, accountId: string) => void;
  onUnbindHandler: (sessionId: string, accountId: string) => void;

  /**
   * Create BindingStorage instance
   * @param sessionBinder - SessionBinder instance to persist
   * @param config - Storage configuration
   */
  constructor(sessionBinder: SessionBinder, config?: BindingStorageConfig) {
    this.sessionBinder = sessionBinder;
    this.config = {
      filePath: config?.filePath || this.getDefaultFilePath(),
      autoSaveInterval: config?.autoSaveInterval || 30000,
      maxBackups: config?.maxBackups || 3,
    };
    this.filePath = this.config.filePath;

    // Create stub handlers - will be replaced when wrapping
    this.onBindHandler = () => {};
    this.onUnbindHandler = () => {};
  }

  /**
   * Get default storage file path
   * @returns Default file path
   */
  private getDefaultFilePath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    return path.join(homeDir, '.claude-code-router', 'binding-storage.json');
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
   * Load bindings from file
   * @returns true if loaded successfully, false if file doesn't exist
   * @throws Error if file is corrupted
   */
  async load(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log(`[BindingStorage] Storage file not found: ${this.filePath}`);
        return false;
      }

      const data = fs.readFileSync(this.filePath, 'utf-8');
      const serialized = JSON.parse(data) as SerializedBindingStorage;

      console.log(
        `[BindingStorage] Loaded ${serialized.bindings.length} bindings from ${this.filePath} (version: ${serialized.version})`
      );

      // Restore bindings to SessionBinder
      const now = Date.now();
      const ttlMs = this.sessionBinder.getStats().ttlMinutes * 60 * 1000;
      let restoredCount = 0;

      for (const binding of serialized.bindings) {
        const lastActiveTime = new Date(binding.lastActiveAt).getTime();
        const elapsed = now - lastActiveTime;

        // Skip expired bindings
        if (elapsed >= ttlMs) {
          console.log(
            `[BindingStorage] Skipping expired binding: ${binding.sessionId} (inactive for ${Math.floor(elapsed / 60000)} min)`
          );
          continue;
        }

        // Restore binding
        this.sessionBinder.bind(binding.sessionId, binding.accountId);
        restoredCount++;
      }

      console.log(`[BindingStorage] Restored ${restoredCount} valid bindings`);
      return true;
    } catch (error: any) {
      console.error(
        `[BindingStorage] Failed to load bindings: ${error.message}`
      );
      throw new Error(
        `Failed to load binding storage: ${error.message}`
      );
    }
  }

  /**
   * Save bindings to file
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

      // Serialize bindings
      const serialized = this.serializeBindings();

      // Write to temp file first (atomic write)
      const tempFile = `${this.filePath}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(serialized, null, 2), 'utf-8');

      // Rename temp file to target (atomic on most filesystems)
      fs.renameSync(tempFile, this.filePath);

      console.log(`[BindingStorage] Saved ${serialized.bindings.length} bindings to ${this.filePath}`);
      this.pendingSave = false;

      return true;
    } catch (error: any) {
      console.error(
        `[BindingStorage] Failed to save bindings: ${error.message}`
      );
      this.pendingSave = false;
      throw new Error(`Failed to save binding storage: ${error.message}`);
    }
  }

  /**
   * Create backup of current storage file
   */
  private async createBackup(): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${this.filePath}.backup.${timestamp}`;

    try {
      fs.copyFileSync(this.filePath, backupPath);
      console.log(`[BindingStorage] Created backup: ${backupPath}`);

      // Clean up old backups
      await this.cleanupBackups();
    } catch (error: any) {
      console.warn(
        `[BindingStorage] Failed to create backup: ${error.message}`
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
          console.log(`[BindingStorage] Removed old backup: ${backupPath}`);
        }
      }
    } catch (error: any) {
      console.warn(
        `[BindingStorage] Failed to cleanup backups: ${error.message}`
      );
    }
  }

  /**
   * Serialize SessionBinder bindings
   * @returns Serialized bindings
   */
  private serializeBindings(): SerializedBindingStorage {
    const bindings = this.sessionBinder.getAllBindings();

    const serializedBindings: SerializedSessionBinding[] = bindings.map(
      (binding: SessionBinding) => ({
        sessionId: binding.sessionId,
        accountId: binding.accountId,
        createdAt: binding.createdAt.toISOString(),
        lastActiveAt: binding.lastActiveAt.toISOString(),
        updatedAt: binding.updatedAt?.toISOString() || binding.createdAt.toISOString(),
        ttlMinutes: binding.ttlMinutes,
      })
    );

    return {
      version: '1.0.0',
      lastSavedAt: new Date().toISOString(),
      bindings: serializedBindings,
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
          console.error(`[BindingStorage] Auto-save failed: ${err.message}`);
        });
      }
    }, this.config.autoSaveInterval);

    console.log(
      `[BindingStorage] Auto-save started (interval: ${this.config.autoSaveInterval}ms)`
    );
  }

  /**
   * Mark bindings as dirty (needs save)
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
        console.error(`[BindingStorage] Final save failed: ${err.message}`);
      });
    }

    console.log(`[BindingStorage] Storage destroyed`);
  }

  /**
   * Get storage file path
   * @returns Current file path
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if storage file exists
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

  /**
   * Wrap SessionBinder to automatically mark dirty on bind/unbind
   * This should be called after creating the storage
   */
  wrapSessionBinder(): void {
    // Store original methods
    const originalBind = this.sessionBinder.bind.bind(this.sessionBinder);
    const originalUnbind = this.sessionBinder.unbind.bind(this.sessionBinder);

    // Wrap bind method
    this.sessionBinder.bind = (sessionId: string, accountId: string) => {
      const result = originalBind(sessionId, accountId);
      this.markDirty();
      return result;
    };

    // Wrap unbind method
    this.sessionBinder.unbind = (sessionId: string) => {
      const result = originalUnbind(sessionId);
      if (result) {
        this.markDirty();
      }
      return result;
    };

    console.log(`[BindingStorage] Wrapped SessionBinder methods for auto-save`);
  }
}

/**
 * Create and initialize BindingStorage with auto-save
 * @param sessionBinder - SessionBinder instance
 * @param config - Storage configuration
 * @returns BindingStorage instance (auto-save started)
 */
export function createBindingStorage(
  sessionBinder: SessionBinder,
  config?: BindingStorageConfig
): BindingStorage {
  const storage = new BindingStorage(sessionBinder, config);

  // Load existing bindings if available
  storage.load().catch((err) => {
    console.warn(`[BindingStorage] Initial load failed: ${err.message}`);
  });

  // Start auto-save
  storage.startAutoSave();

  // Wrap SessionBinder to auto-mark dirty
  storage.wrapSessionBinder();

  return storage;
}
