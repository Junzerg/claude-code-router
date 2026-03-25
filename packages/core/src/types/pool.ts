/**
 * Account status enumeration
 */
export type AccountStatus =
  | 'active'      // Account is active and available
  | 'limited'     // Account is rate-limited or quota-exhausted
  | 'error'       // Account encountered an error
  | 'disabled';   // Account is manually disabled

/**
 * Concurrency state for an account
 */
export interface ConcurrencyState {
  /** Current number of active requests */
  current: number;
  /** Maximum allowed concurrent requests */
  max: number;
  /** Timestamp of last concurrency update */
  lastUpdated: Date;
  /** Session IDs occupying concurrency slots (optional, for debugging) */
  slots?: Set<string>;
}

/**
 * Usage state tracking for an account
 */
export interface UsageState {
  /** Usage in the last 5 hours (tokens or requests) */
  last5Hours: number;
  /** Weekly usage (tokens or requests) */
  weekly: number;
  /** 5-hour limit threshold */
  last5HoursLimit: number;
  /** Weekly limit threshold */
  weeklyLimit: number;
  /** Last sync timestamp with Z.ai API */
  lastSyncedAt?: Date;
  /** Last local update timestamp */
  lastUpdated?: Date;
  /** 5-hour usage percentage (from API, optional) */
  last5HoursPercentage?: number;
  /** Weekly usage percentage (from API, optional) */
  weeklyPercentage?: number;
}

/**
 * Session binding information
 */
export interface SessionBinding {
  /** Session ID (conversation_id) */
  sessionId: string;
  /** Bound account ID */
  accountId: string;
  /** Binding creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActiveAt: Date;
  /** Last update timestamp */
  updatedAt?: Date;
  /** TTL in minutes (default: 60) */
  ttlMinutes: number;
}

/**
 * Limited account information
 */
export interface LimitedInfo {
  /** Timestamp when account became limited */
  since: Date;
  /** Reason for limitation */
  reason: 'rate_limit' | 'quota_exhausted' | 'error' | 'manual';
  /** Error message if applicable */
  errorMessage?: string;
  /** Expected recovery time (if known) */
  recoverAt?: Date;
}

/**
 * Coding Plan account configuration
 */
export interface CodingPlanAccount {
  /** Unique account identifier */
  id: string;
  /** Account name/label */
  name: string;
  /** Platform identifier */
  platform: 'zai' | 'zhipu';
  /** API key for authentication */
  apiKey: string;
  /** API base URL */
  apiBaseUrl: string;
  /** Optional: reference a registered provider name to inherit headers/transformer */
  provider?: string;
  /** Optional: custom headers (overrides inherited headers from referenced provider) */
  headers?: Record<string, string>;
  /** Account status */
  status: AccountStatus;
  /** Concurrency state */
  concurrency: ConcurrencyState;
  /** Usage state */
  usage: UsageState;
  /** Account configuration */
  config: {
    /** Maximum concurrent requests (default: 3) */
    maxConcurrency: number;
    /** 5-hour usage limit */
    last5HoursLimit: number;
    /** Weekly usage limit */
    weeklyLimit: number;
    /** Buffer ratio (default: 0.1 = 10%) */
    bufferRatio: number;
  };
  /** Limited info (if status is 'limited') */
  limitedInfo?: LimitedInfo;
  /** Account metadata */
  metadata: {
    /** Creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Last usage timestamp */
    lastUsedAt?: Date;
  };
}

/**
 * Account pool configuration
 */
export interface AccountPoolConfig {
  /** Whether the pool is enabled */
  enabled: boolean;
  /** List of accounts in the pool */
  accounts: CodingPlanAccount[];
  /** Session bindings */
  sessionBindings: Map<string, SessionBinding>;
  /** Default max concurrency for new accounts */
  defaultMaxConcurrency: number;
  /** Buffer ratio for usage limits (e.g., 0.1 = 10% buffer) */
  bufferRatio: number;
  /** Session binding settings */
  sessionBinding: {
    /** Whether session binding is enabled */
    enabled: boolean;
    /** Session TTL in minutes */
    ttlMinutes: number;
    /** Whether to break binding when account is limited */
    breakOnLimited: boolean;
  };
  /** Error recovery settings */
  errorRecovery: {
    /** Maximum retry attempts */
    maxRetries: number;
    /** Delay between retries in milliseconds */
    retryDelayMs: number;
  };
  /** Usage sync settings */
  usageSync: {
    /** Whether usage sync is enabled */
    enabled: boolean;
    /** Sync interval in minutes */
    intervalMinutes: number;
  };
  /** Rate limit recovery settings */
  rateLimitRecovery: {
    /** Whether automatic recovery is enabled */
    enabled: boolean;
    /** Recovery interval in minutes (default: 60) */
    checkIntervalMinutes: number;
    /** Default recovery duration in minutes (default: 60) */
    defaultRecoveryMinutes: number;
  };
}

/**
 * Account selection result
 */
export interface AccountSelectionResult {
  /** Selected account ID */
  accountId: string;
  /** Selection reason */
  reason: 'session_binding' | 'available' | 'fallback';
  /** Session ID (if applicable) */
  sessionId?: string;
}

/**
 * Pool status summary
 */
export interface PoolStatusSummary {
  /** Total number of accounts */
  total: number;
  /** Number of active accounts */
  active: number;
  /** Number of limited accounts */
  limited: number;
  /** Number of error accounts */
  error: number;
  /** Number of disabled accounts */
  disabled: number;
  /** Total available concurrency slots */
  totalConcurrency: number;
  /** Currently available concurrency slots */
  availableConcurrency: number;
  /** Total usage percentage (5-hour) */
  totalUsagePercentage: number;
}

/**
 * Time range for usage queries
 */
export interface TimeRange {
  /** Start time in format: yyyy-MM-dd HH:mm:ss */
  startTime: string;
  /** End time in format: yyyy-MM-dd HH:mm:ss */
  endTime: string;
}

/**
 * Quota limit type
 */
export type QuotaLimitType = 'TOKENS_LIMIT' | 'TIME_LIMIT';

/**
 * Quota limit information
 */
export interface QuotaLimitInfo {
  /** Limit type */
  type: QuotaLimitType;
  /** Usage percentage (0-1) */
  percentage: number;
  /** Current usage amount */
  currentUsage?: number;
  /** Total limit amount */
  total?: number;
  /** Detailed usage information */
  usageDetails?: any;
}

/**
 * Quota limit response from Z.ai API
 */
export interface QuotaLimitResponse {
  code?: number;
  msg?: string;
  data: {
    limits: QuotaLimitInfo[];
  };
}

/**
 * Model usage item
 */
export interface ModelUsageItem {
  /** Model name */
  model: string;
  /** Token count */
  tokens: number;
  /** Request count */
  requests: number;
  /** Timestamp */
  timestamp: string;
}

/**
 * Model usage response from Z.ai API
 */
export interface ModelUsageResponse {
  code?: number;
  msg?: string;
  data: {
    items: ModelUsageItem[];
  };
}

/**
 * Tool usage item
 */
export interface ToolUsageItem {
  /** Tool name */
  tool: string;
  /** Usage count */
  count: number;
  /** Timestamp */
  timestamp: string;
}

/**
 * Tool usage response from Z.ai API
 */
export interface ToolUsageResponse {
  code?: number;
  msg?: string;
  data: {
    items: ToolUsageItem[];
  };
}

/**
 * Full usage response combining all usage data
 */
export interface FullUsageResponse {
  /** Quota limits */
  quotaLimits: QuotaLimitResponse;
  /** Model usage */
  modelUsage: ModelUsageResponse;
  /** Tool usage */
  toolUsage: ToolUsageResponse;
  /** Sync timestamp */
  syncedAt: Date;
}

/**
 * Z.ai error types
 */
export const ZaiErrorTypes = {
  // Rate limit errors
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  TOO_MANY_REQUESTS: 'too_many_requests',

  // Quota exhausted
  QUOTA_EXHAUSTED: 'quota_exhausted',
  INSUFFICIENT_QUOTA: 'insufficient_quota',

  // Concurrent limit
  CONCURRENT_LIMIT_REACHED: 'concurrent_limit_reached',

  // Account issues
  ACCOUNT_SUSPENDED: 'account_suspended',
  INVALID_API_KEY: 'invalid_api_key',

  // Server errors (may retry with different account)
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const;

export type ZaiErrorType = typeof ZaiErrorTypes[keyof typeof ZaiErrorTypes];

/**
 * API Error interface
 */
export interface ApiError {
  /** Error code */
  code?: string;
  /** Error type */
  type?: string;
  /** Error message */
  message: string;
  /** HTTP status code */
  status?: number;
  /** Raw error object */
  raw?: any;
}

/**
 * Retry record for tracking error history
 */
export interface RetryRecord {
  /** Account ID that failed */
  accountId: string;
  /** Timestamp of error */
  timestamp: number;
  /** Error details */
  error: ApiError;
}

/**
 * Error handling result
 */
export interface ErrorHandlingResult {
  /** Whether to switch to a new account */
  shouldSwitch: boolean;
  /** New account selection (if switching) */
  newAccountId?: string;
  /** Whether to retry the request */
  shouldRetry: boolean;
  /** Error message to return to user (if not retrying) */
  userMessage?: string;
}

/**
 * Account usage statistics for local tracking
 */
export interface AccountUsageStats {
  /** Request timestamp -> token count */
  requests: Map<number, number>;
  /** Request count in last 5 hours */
  last5Hours: number;
  /** Request count in current week */
  weekly: number;
  /** Last update timestamp */
  lastUpdated: Date;
}
