import https from 'https';
import {
  TimeRange,
  QuotaLimitResponse,
  ModelUsageResponse,
  ToolUsageResponse,
  FullUsageResponse,
} from '../types/pool';

/**
 * Z.ai Usage API Client
 *
 * Provides methods to query usage statistics from Z.ai API:
 * - Model usage statistics
 * - Tool usage statistics
 * - Quota limit information
 *
 * API Endpoints:
 * - GET /api/monitor/usage/model-usage - Model usage statistics
 * - GET /api/monitor/usage/tool-usage - Tool usage statistics
 * - GET /api/monitor/usage/quota/limit - Quota limit information
 *
 * Authentication:
 * - Authorization header with API key
 *
 * Usage:
 * ```typescript
 * const client = new ZaiUsageClient({
 *   apiBaseUrl: 'https://api.z.ai',
 *   apiKey: 'your-api-key',
 * });
 *
 * const quotaLimit = await client.getQuotaLimit();
 * const modelUsage = await client.getModelUsage();
 * ```
 */
export class ZaiUsageClient {
  private apiBaseUrl: string;
  private apiKey: string;

  /**
   * Create Z.ai Usage API client
   * @param options - Client configuration
   * @param options.apiBaseUrl - Z.ai API base URL
   * @param options.apiKey - API key for authentication
   */
  constructor(options: { apiBaseUrl: string; apiKey: string }) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.apiKey = options.apiKey;
  }

  /**
   * Format date to API required format (yyyy-MM-dd HH:mm:ss)
   * @param date - Date to format
   * @returns Formatted date string
   */
  private formatTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Get quota limit information
   *
   * Returns token and time limits with current usage percentages.
   *
   * @returns Quota limit response
   * @throws Error if API call fails
   */
  async getQuotaLimit(): Promise<QuotaLimitResponse> {
    console.log('[ZaiUsageClient] Fetching quota limit...');
    return this.request<QuotaLimitResponse>('/api/monitor/usage/quota/limit', {});
  }

  /**
   * Get model usage statistics
   *
   * @param timeRange - Optional time range (defaults to last 5 hours)
   * @returns Model usage response
   * @throws Error if API call fails
   */
  async getModelUsage(timeRange?: TimeRange): Promise<ModelUsageResponse> {
    const now = new Date();
    const defaultRange: TimeRange = {
      // Default to last 5 hours
      startTime: this.formatTime(new Date(now.getTime() - 5 * 60 * 60 * 1000)),
      endTime: this.formatTime(now),
    };

    const range = timeRange || defaultRange;
    console.log(
      `[ZaiUsageClient] Fetching model usage from ${range.startTime} to ${range.endTime}...`
    );

    return this.request<ModelUsageResponse>('/api/monitor/usage/model-usage', range);
  }

  /**
   * Get tool usage statistics
   *
   * @param timeRange - Optional time range (defaults to last 5 hours)
   * @returns Tool usage response
   * @throws Error if API call fails
   */
  async getToolUsage(timeRange?: TimeRange): Promise<ToolUsageResponse> {
    const now = new Date();
    const defaultRange: TimeRange = {
      // Default to last 5 hours
      startTime: this.formatTime(new Date(now.getTime() - 5 * 60 * 60 * 1000)),
      endTime: this.formatTime(now),
    };

    const range = timeRange || defaultRange;
    console.log(
      `[ZaiUsageClient] Fetching tool usage from ${range.startTime} to ${range.endTime}...`
    );

    return this.request<ToolUsageResponse>('/api/monitor/usage/tool-usage', range);
  }

  /**
   * Get full usage information (all-in-one)
   *
   * Fetches quota limits, model usage, and tool usage in a single call.
   *
   * @param timeRange - Optional time range for usage queries
   * @returns Full usage response
   * @throws Error if any API call fails
   */
  async getFullUsage(timeRange?: TimeRange): Promise<FullUsageResponse> {
    console.log('[ZaiUsageClient] Fetching full usage information...');

    const [quotaLimits, modelUsage, toolUsage] = await Promise.all([
      this.getQuotaLimit(),
      this.getModelUsage(timeRange),
      this.getToolUsage(timeRange),
    ]);

    return {
      quotaLimits,
      modelUsage,
      toolUsage,
      syncedAt: new Date(),
    };
  }

  /**
   * Generic request method for Z.ai API
   *
   * @param path - API endpoint path
   * @param params - Query parameters
   * @returns Parsed JSON response
   * @throws Error if request fails or response is not OK
   */
  private async request<T>(
    path: string,
    params: Record<string, any>
  ): Promise<T> {
    const parsedBaseUrl = new URL(this.apiBaseUrl);
    const baseDomain = `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}`;
    const url = new URL(path, baseDomain);

    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    console.log(`[ZaiUsageClient] Requesting: ${url.toString()}`);

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: this.apiKey,
            'Accept-Language': 'en-US,en',
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode !== 200) {
              return reject(
                new Error(`HTTP ${res.statusCode}: ${data}`)
              );
            }

            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (e) {
              reject(new Error(`JSON parse error: ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => {
        console.error(`[ZaiUsageClient] Request error: ${err.message}`);
        reject(err);
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Get API base URL
   */
  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  /**
   * Parse quota limit response to extract percentages
   *
   * @param response - Quota limit response
   * @returns Object with 5-hour and weekly percentages
   */
  static parseQuotaPercentages(
    response: QuotaLimitResponse
  ): { last5HoursPercentage: number; weeklyPercentage: number } {
    const tokenLimit = response.data.limits.find(
      (l) => l.type === 'TOKENS_LIMIT'
    );
    const timeLimit = response.data.limits.find(
      (l) => l.type === 'TIME_LIMIT'
    );

    return {
      last5HoursPercentage: tokenLimit?.percentage || 0,
      weeklyPercentage: timeLimit?.percentage || 0,
    };
  }

  /**
   * Calculate total tokens from model usage
   *
   * @param response - Model usage response
   * @returns Total token count
   */
  static calculateTotalTokens(response: ModelUsageResponse): number {
    return response.data.items.reduce((total, item) => total + item.tokens, 0);
  }

  /**
   * Calculate total requests from model usage
   *
   * @param response - Model usage response
   * @returns Total request count
   */
  static calculateTotalRequests(response: ModelUsageResponse): number {
    return response.data.items.reduce((total, item) => total + item.requests, 0);
  }
}
