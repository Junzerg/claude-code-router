import { PoolManager } from './pool-manager';
import { CodingPlanAccount } from '../types/pool';

/**
 * Alert severity levels
 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/**
 * Alert types
 */
export type AlertType =
  | 'approaching_5h_limit'
  | 'approaching_weekly_limit'
  | 'account_limited'
  | 'account_error'
  | 'account_recovered'
  | 'concurrency_high'
  | 'sync_failed';

/**
 * Alert record structure
 */
export interface Alert {
  /** Unique alert identifier */
  id: string;
  /** Alert type */
  type: AlertType;
  /** Alert severity level */
  level: AlertLevel;
  /** Account ID that triggered the alert */
  accountId: string;
  /** Account name */
  accountName: string;
  /** Alert message */
  message: string;
  /** Alert timestamp */
  timestamp: Date;
  /** Additional data */
  data?: {
    /** Usage percentage (0-1) */
    percentage?: number;
    /** Threshold that was exceeded (0-1) */
    threshold?: number;
    /** Error message if applicable */
    errorMessage?: string;
    /** Current concurrency usage */
    concurrencyCurrent?: number;
    /** Maximum concurrency */
    concurrencyMax?: number;
    [key: string]: any;
  };
  /** Whether alert has been acknowledged */
  acknowledged: boolean;
  /** When alert was acknowledged */
  acknowledgedAt?: Date;
}

/**
 * Alert callback function type
 */
export type AlertCallback = (alert: Alert) => void | Promise<void>;

/**
 * Alert service configuration
 */
export interface AlertServiceConfig {
  /** 5-hour usage warning threshold (default: 0.8 = 80%) */
  fiveHourWarningThreshold?: number;
  /** 5-hour usage critical threshold (default: 0.95 = 95%) */
  fiveHourCriticalThreshold?: number;
  /** Weekly usage warning threshold (default: 0.8 = 80%) */
  weeklyWarningThreshold?: number;
  /** Weekly usage critical threshold (default: 0.95 = 95%) */
  weeklyCriticalThreshold?: number;
  /** Concurrency high usage threshold (default: 0.8 = 80%) */
  concurrencyWarningThreshold?: number;
  /** Maximum alerts to keep in memory (default: 100) */
  maxAlertsInMemory?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Alert Service
 *
 * Monitors account pool for various conditions and generates alerts.
 *
 * Features:
 * - Usage threshold monitoring (5-hour and weekly)
 * - Account status change detection
 * - Concurrency monitoring
 * - Alert history tracking
 * - Callback hooks for notifications (webhook, email, etc.)
 *
 * Usage:
 * ```typescript
 * const alertService = new AlertService(poolManager, {
 *   fiveHourWarningThreshold: 0.8,
 *   fiveHourCriticalThreshold: 0.95,
 * });
 *
 * // Add notification callback
 * alertService.onAlert(async (alert) => {
 *   // Send webhook, email, etc.
 *   await sendNotification(alert);
 * });
 *
 * // Start monitoring
 * alertService.start();
 * ```
 */
export class AlertService {
  private poolManager: PoolManager;
  private config: AlertServiceConfig;
  private alerts: Alert[] = [];
  private alertCallbacks: AlertCallback[] = [];
  private checkInterval?: NodeJS.Timeout;
  private checkIntervalMs: number = 60000; // 1 minute
  private lastAlertCheck: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

  /**
   * Create AlertService instance
   * @param poolManager - PoolManager instance to monitor
   * @param config - Alert configuration
   */
  constructor(
    poolManager: PoolManager,
    config?: AlertServiceConfig
  ) {
    this.poolManager = poolManager;
    this.config = {
      fiveHourWarningThreshold: config?.fiveHourWarningThreshold ?? 0.8,
      fiveHourCriticalThreshold: config?.fiveHourCriticalThreshold ?? 0.95,
      weeklyWarningThreshold: config?.weeklyWarningThreshold ?? 0.8,
      weeklyCriticalThreshold: config?.weeklyCriticalThreshold ?? 0.95,
      concurrencyWarningThreshold: config?.concurrencyWarningThreshold ?? 0.8,
      maxAlertsInMemory: config?.maxAlertsInMemory ?? 100,
      verbose: config?.verbose ?? false,
    };

    this.log('AlertService initialized');
  }

  /**
   * Register alert callback
   * @param callback - Function to call when alert is generated
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
    this.log(`Alert callback registered. Total callbacks: ${this.alertCallbacks.length}`);
  }

  /**
   * Clear all alert callbacks
   */
  clearCallbacks(): void {
    this.alertCallbacks = [];
    this.log('All alert callbacks cleared');
  }

  /**
   * Start monitoring
   * @param checkIntervalMinutes - Check interval in minutes (default: 1)
   */
  start(checkIntervalMinutes: number = 1): void {
    if (this.checkInterval) {
      this.log('Monitoring already running, ignoring start() call');
      return;
    }

    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;

    this.log(`Starting alert monitoring (interval: ${checkIntervalMinutes}m)`);

    // Initial check
    this.checkAllAccounts();

    // Start periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAllAccounts();
    }, this.checkIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      this.log('Alert monitoring stopped');
    }
  }

  /**
   * Check if monitoring is running
   */
  isRunning(): boolean {
    return this.checkInterval !== undefined;
  }

  /**
   * Check all accounts for alert conditions
   */
  private checkAllAccounts(): void {
    const accounts = this.poolManager.getAllAccounts();
    this.log(`Checking ${accounts.length} accounts for alert conditions`);

    for (const account of accounts) {
      this.checkAccount(account);
    }
  }

  /**
   * Check a single account for alert conditions
   */
  private checkAccount(account: CodingPlanAccount): void {
    // Check 5-hour usage
    this.checkFiveHourUsage(account);

    // Check weekly usage
    this.checkWeeklyUsage(account);

    // Check concurrency
    this.checkConcurrency(account);

    // Check account status
    this.checkAccountStatus(account);
  }

  /**
   * Check 5-hour usage threshold
   */
  private checkFiveHourUsage(account: CodingPlanAccount): void {
    const percentage = account.usage.last5Hours / account.config.last5HoursLimit;
    const cooldownKey = `5h_${account.id}`;

    // Check critical threshold
    if (percentage >= this.config.fiveHourCriticalThreshold!) {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'approaching_5h_limit',
          level: 'critical',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has reached ${(percentage * 100).toFixed(1)}% of 5-hour limit`,
          data: {
            percentage,
            threshold: this.config.fiveHourCriticalThreshold,
          },
        });
        this.setCooldown(cooldownKey);
      }
      return;
    }

    // Check warning threshold
    if (percentage >= this.config.fiveHourWarningThreshold!) {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'approaching_5h_limit',
          level: 'warning',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has reached ${(percentage * 100).toFixed(1)}% of 5-hour limit`,
          data: {
            percentage,
            threshold: this.config.fiveHourWarningThreshold,
          },
        });
        this.setCooldown(cooldownKey);
      }
    }
  }

  /**
   * Check weekly usage threshold
   */
  private checkWeeklyUsage(account: CodingPlanAccount): void {
    const percentage = account.usage.weekly / account.config.weeklyLimit;
    const cooldownKey = `weekly_${account.id}`;

    // Check critical threshold
    if (percentage >= this.config.weeklyCriticalThreshold!) {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'approaching_weekly_limit',
          level: 'critical',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has reached ${(percentage * 100).toFixed(1)}% of weekly limit`,
          data: {
            percentage,
            threshold: this.config.weeklyCriticalThreshold,
          },
        });
        this.setCooldown(cooldownKey);
      }
      return;
    }

    // Check warning threshold
    if (percentage >= this.config.weeklyWarningThreshold!) {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'approaching_weekly_limit',
          level: 'warning',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has reached ${(percentage * 100).toFixed(1)}% of weekly limit`,
          data: {
            percentage,
            threshold: this.config.weeklyWarningThreshold,
          },
        });
        this.setCooldown(cooldownKey);
      }
    }
  }

  /**
   * Check concurrency usage
   */
  private checkConcurrency(account: CodingPlanAccount): void {
    if (account.concurrency.max === 0) return;

    const percentage = account.concurrency.current / account.concurrency.max;
    const cooldownKey = `concurrency_${account.id}`;

    if (percentage >= this.config.concurrencyWarningThreshold!) {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'concurrency_high',
          level: 'warning',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} concurrency is at ${account.concurrency.current}/${account.concurrency.max}`,
          data: {
            concurrencyCurrent: account.concurrency.current,
            concurrencyMax: account.concurrency.max,
          },
        });
        this.setCooldown(cooldownKey);
      }
    }
  }

  /**
   * Check account status changes
   */
  private checkAccountStatus(account: CodingPlanAccount): void {
    const cooldownKey = `status_${account.id}_${account.status}`;

    // Check if account became limited
    if (account.status === 'limited') {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'account_limited',
          level: 'critical',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has become limited`,
          data: {
            reason: account.limitedInfo?.reason,
            errorMessage: account.limitedInfo?.errorMessage,
          },
        });
        this.setCooldown(cooldownKey);
      }
      return;
    }

    // Check if account has error
    if (account.status === 'error') {
      if (!this.isInCooldown(cooldownKey)) {
        this.createAlert({
          type: 'account_error',
          level: 'critical',
          accountId: account.id,
          accountName: account.name,
          message: `Account ${account.name} has encountered an error`,
          data: {
            reason: account.limitedInfo?.reason,
            errorMessage: account.limitedInfo?.errorMessage,
          },
        });
        this.setCooldown(cooldownKey);
      }
    }
  }

  /**
   * Create and dispatch an alert
   */
  private createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const alert: Alert = {
      ...alertData,
      id: this.generateAlertId(),
      timestamp: new Date(),
      acknowledged: false,
    };

    this.log(`Alert created: ${alert.level} - ${alert.message}`);

    // Add to alerts history
    this.alerts.unshift(alert);

    // Trim to max size
    if (this.alerts.length > this.config.maxAlertsInMemory!) {
      this.alerts = this.alerts.slice(0, this.config.maxAlertsInMemory);
    }

    // Call all registered callbacks
    for (const callback of this.alertCallbacks) {
      try {
        const result = callback(alert);
        if (result instanceof Promise) {
          result.catch((err) => {
            this.log(`Alert callback error: ${err.message}`);
          });
        }
      } catch (err) {
        this.log(`Alert callback error: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Record account recovery
   */
  recordRecovery(account: CodingPlanAccount): void {
    this.createAlert({
      type: 'account_recovered',
      level: 'info',
      accountId: account.id,
      accountName: account.name,
      message: `Account ${account.name} has recovered`,
    });
  }

  /**
   * Record sync failure
   */
  recordSyncFailure(accountId: string, error: Error): void {
    const account = this.poolManager.getAccount(accountId);
    if (!account) return;

    const cooldownKey = `sync_${accountId}`;
    if (this.isInCooldown(cooldownKey)) return;

    this.createAlert({
      type: 'sync_failed',
      level: 'warning',
      accountId: account.id,
      accountName: account.name,
      message: `Failed to sync account ${account.name}: ${error.message}`,
      data: {
        errorMessage: error.message,
      },
    });
    this.setCooldown(cooldownKey);
  }

  /**
   * Get all alerts
   * @param options - Filter options
   * @returns Filtered alerts
   */
  getAlerts(options?: {
    level?: AlertLevel;
    type?: AlertType;
    acknowledged?: boolean;
    accountId?: string;
    limit?: number;
  }): Alert[] {
    let filtered = [...this.alerts];

    if (options) {
      if (options.level !== undefined) {
        filtered = filtered.filter((a) => a.level === options.level);
      }
      if (options.type !== undefined) {
        filtered = filtered.filter((a) => a.type === options.type);
      }
      if (options.acknowledged !== undefined) {
        filtered = filtered.filter((a) => a.acknowledged === options.acknowledged);
      }
      if (options.accountId !== undefined) {
        filtered = filtered.filter((a) => a.accountId === options.accountId);
      }
      if (options.limit !== undefined) {
        filtered = filtered.slice(0, options.limit);
      }
    }

    return filtered;
  }

  /**
   * Get recent alerts
   * @param limit - Number of alerts to return
   * @returns Recent alerts
   */
  getRecentAlerts(limit: number = 10): Alert[] {
    return this.alerts.slice(0, limit);
  }

  /**
   * Acknowledge an alert
   * @param alertId - Alert ID to acknowledge
   * @returns True if acknowledged, false if not found
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date();
      this.log(`Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Acknowledge all alerts for an account
   * @param accountId - Account ID
   * @returns Number of alerts acknowledged
   */
  acknowledgeAccountAlerts(accountId: string): number {
    let count = 0;
    for (const alert of this.alerts) {
      if (alert.accountId === accountId && !alert.acknowledged) {
        alert.acknowledged = true;
        alert.acknowledgedAt = new Date();
        count++;
      }
    }
    this.log(`Acknowledged ${count} alerts for account ${accountId}`);
    return count;
  }

  /**
   * Clear alert history
   * @param acknowledgedOnly - Only clear acknowledged alerts
   */
  clearHistory(acknowledgedOnly: boolean = false): void {
    if (acknowledgedOnly) {
      const before = this.alerts.length;
      this.alerts = this.alerts.filter((a) => !a.acknowledged);
      this.log(`Cleared ${before - this.alerts.length} acknowledged alerts`);
    } else {
      const count = this.alerts.length;
      this.alerts = [];
      this.log(`Cleared all ${count} alerts`);
    }
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    totalAlerts: number;
    unacknowledgedCount: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    alertsByType: Record<string, number>;
  } {
    const unacknowledgedCount = this.alerts.filter((a) => !a.acknowledged).length;
    const criticalCount = this.alerts.filter((a) => a.level === 'critical').length;
    const warningCount = this.alerts.filter((a) => a.level === 'warning').length;
    const infoCount = this.alerts.filter((a) => a.level === 'info').length;

    const alertsByType: Record<string, number> = {};
    for (const alert of this.alerts) {
      alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
    }

    return {
      totalAlerts: this.alerts.length,
      unacknowledgedCount,
      criticalCount,
      warningCount,
      infoCount,
      alertsByType,
    };
  }

  /**
   * Set cooldown for a key
   */
  private setCooldown(key: string): void {
    this.lastAlertCheck.set(key, Date.now());
  }

  /**
   * Check if a key is in cooldown
   */
  private isInCooldown(key: string): boolean {
    const lastCheck = this.lastAlertCheck.get(key);
    if (lastCheck === undefined) return false;

    const elapsed = Date.now() - lastCheck;
    return elapsed < this.ALERT_COOLDOWN_MS;
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[AlertService] ${message}`);
    }
  }
}

/**
 * Create and initialize AlertService
 * @param poolManager - PoolManager instance
 * @param config - Alert configuration
 * @returns AlertService instance (monitoring started)
 */
export function createAlertService(
  poolManager: PoolManager,
  config?: AlertServiceConfig
): AlertService {
  const alertService = new AlertService(poolManager, config);
  alertService.start();
  return alertService;
}
