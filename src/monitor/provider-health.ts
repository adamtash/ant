/**
 * Provider Health Tracking System
 *
 * Tracks per-provider metrics and health status for visibility into API status.
 */

import type { Logger } from "../log.js";
import type { EventStream } from "./event-stream.js";
import type { Unsubscribe } from "./types.js";

/**
 * Provider health status
 */
export type ProviderHealthStatus = "healthy" | "degraded" | "cooldown" | "offline";

/**
 * Provider cooldown info
 */
export interface ProviderCooldown {
  until: number;
  reason: "rate_limit" | "quota" | "auth" | "maintenance" | "error";
  startedAt: number;
}

/**
 * Provider statistics
 */
export interface ProviderStats {
  requestCount: number;
  errorCount: number;
  successCount: number;
  avgResponseTime: number;
  errorRate: number;
  lastRequestAt?: number;
  lastErrorAt?: number;
}

/**
 * Provider health information
 */
export interface ProviderHealth {
  id: string;
  name: string;
  type: "openai" | "cli" | "ollama";
  model: string;
  status: ProviderHealthStatus;
  stats: ProviderStats;
  cooldown?: ProviderCooldown;
  lastSeen: number;
  healthySince?: number;
}

/**
 * Request tracking entry
 */
interface RequestEntry {
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * Provider Health Tracker
 *
 * Monitors and tracks provider health metrics
 */
export class ProviderHealthTracker {
  private readonly logger: Logger;
  private readonly providers = new Map<string, ProviderHealth>();
  private readonly requestHistory = new Map<string, RequestEntry[]>();
  private readonly maxHistorySize = 100;
  private streamSubscription?: Unsubscribe;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: "provider-health" });
  }

  /**
   * Connect to event stream
   */
  connectToStream(stream: EventStream): Unsubscribe {
    // Subscribe to relevant events
    this.streamSubscription = stream.subscribeAll((event) => {
      switch (event.type) {
        case "agent_thinking":
          // Request starting
          break;
        case "agent_response":
          // Request completed
          if (event.data) {
            const data = event.data as {
              duration?: number;
              success?: boolean;
              providerId?: string;
            };
            if (data.providerId && data.duration) {
              this.recordRequest(data.providerId, data.duration, data.success ?? true);
            }
          }
          break;
        case "error_occurred":
          // Error occurred
          if (event.data) {
            const data = event.data as {
              provider?: string;
              providerId?: string;
            };
            const providerId = data.provider || data.providerId;
            if (providerId) {
              this.recordError(providerId);
            }
          }
          break;
        case "provider_cooldown":
          // Provider entered cooldown
          if (event.data) {
            const data = event.data as {
              providerId: string;
              reason: ProviderCooldown["reason"];
              until: number;
            };
            this.setCooldown(data.providerId, data.reason, data.until);
          }
          break;
        case "provider_recovery":
          // Provider recovered
          if (event.data) {
            const data = event.data as { providerId: string };
            this.clearCooldown(data.providerId);
          }
          break;
      }
    });

    return () => {
      if (this.streamSubscription) {
        this.streamSubscription();
        this.streamSubscription = undefined;
      }
    };
  }

  /**
   * Register a provider for tracking
   */
  registerProvider(id: string, name: string, type: ProviderHealth["type"], model: string): void {
    const existing = this.providers.get(id);
    if (existing) {
      existing.name = name;
      existing.type = type;
      existing.model = model;
      existing.lastSeen = Date.now();
      return;
    }

    const now = Date.now();
    this.providers.set(id, {
      id,
      name,
      type,
      model,
      status: "healthy",
      stats: {
        requestCount: 0,
        errorCount: 0,
        successCount: 0,
        avgResponseTime: 0,
        errorRate: 0,
      },
      lastSeen: now,
      healthySince: now,
    });

    this.requestHistory.set(id, []);
    this.logger.debug({ providerId: id, name }, "Provider registered for health tracking");
  }

  /**
   * Record a successful request
   */
  recordRequest(providerId: string, duration: number, success: boolean): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    // Update history
    const history = this.requestHistory.get(providerId) || [];
    history.push({
      timestamp: Date.now(),
      duration,
      success,
    });

    // Trim history
    while (history.length > this.maxHistorySize) {
      history.shift();
    }

    // Update stats
    provider.stats.requestCount++;
    provider.lastSeen = Date.now();

    if (success) {
      provider.stats.successCount++;
      provider.stats.lastRequestAt = Date.now();
    } else {
      provider.stats.errorCount++;
      provider.stats.lastErrorAt = Date.now();
    }

    // Recalculate averages
    const recentHistory = history.slice(-20); // Last 20 requests
    const avgDuration = recentHistory.reduce((sum, r) => sum + r.duration, 0) / recentHistory.length;
    provider.stats.avgResponseTime = Math.round(avgDuration);
    provider.stats.errorRate = Math.round((provider.stats.errorCount / provider.stats.requestCount) * 100);

    // Update status based on error rate
    this.updateStatus(providerId);
  }

  /**
   * Record an error
   */
  recordError(providerId: string, error?: string): void {
    this.recordRequest(providerId, 0, false);
  }

  /**
   * Set provider cooldown
   */
  setCooldown(providerId: string, reason: ProviderCooldown["reason"], until: number): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    provider.status = "cooldown";
    provider.cooldown = {
      until,
      reason,
      startedAt: Date.now(),
    };

    this.logger.warn(
      { providerId, reason, until: new Date(until).toISOString() },
      "Provider entered cooldown"
    );
  }

  /**
   * Clear provider cooldown
   */
  clearCooldown(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    provider.status = "healthy";
    provider.cooldown = undefined;
    provider.healthySince = Date.now();

    this.logger.info({ providerId }, "Provider recovered from cooldown");
  }

  /**
   * Get provider health
   */
  getProviderHealth(providerId: string): ProviderHealth | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all provider health info
   */
  getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers by status
   */
  getProvidersByStatus(status: ProviderHealthStatus): ProviderHealth[] {
    return this.getAllProviderHealth().filter((p) => p.status === status);
  }

  /**
   * Check if provider is healthy
   */
  isHealthy(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    // Check cooldown
    if (provider.cooldown && provider.cooldown.until > Date.now()) {
      return false;
    }

    return provider.status === "healthy";
  }

  /**
   * Get best available provider
   */
  getBestProvider(): ProviderHealth | undefined {
    const providers = this.getAllProviderHealth()
      .filter((p) => this.isHealthy(p.id))
      .sort((a, b) => {
        // Sort by error rate, then avg response time
        if (a.stats.errorRate !== b.stats.errorRate) {
          return a.stats.errorRate - b.stats.errorRate;
        }
        return a.stats.avgResponseTime - b.stats.avgResponseTime;
      });

    return providers[0];
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    cooldown: number;
    offline: number;
    overallErrorRate: number;
  } {
    const providers = this.getAllProviderHealth();
    const total = providers.length;
    const healthy = providers.filter((p) => p.status === "healthy").length;
    const degraded = providers.filter((p) => p.status === "degraded").length;
    const cooldown = providers.filter((p) => p.status === "cooldown").length;
    const offline = providers.filter((p) => p.status === "offline").length;

    const totalRequests = providers.reduce((sum, p) => sum + p.stats.requestCount, 0);
    const totalErrors = providers.reduce((sum, p) => sum + p.stats.errorCount, 0);
    const overallErrorRate = totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 100) : 0;

    return {
      total,
      healthy,
      degraded,
      cooldown,
      offline,
      overallErrorRate,
    };
  }

  /**
   * Clean up old data
   */
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

    for (const [providerId, history] of this.requestHistory) {
      const filtered = history.filter((r) => r.timestamp > cutoff);
      this.requestHistory.set(providerId, filtered);
    }
  }

  private updateStatus(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider || provider.cooldown) return;

    const { errorRate, requestCount } = provider.stats;

    // Determine status based on error rate
    if (errorRate > 50) {
      provider.status = "offline";
    } else if (errorRate > 20) {
      provider.status = "degraded";
    } else {
      provider.status = "healthy";
      if (!provider.healthySince) {
        provider.healthySince = Date.now();
      }
    }

    // Log significant status changes
    if (errorRate > 20 && requestCount > 10) {
      this.logger.warn(
        { providerId, errorRate, status: provider.status },
        "Provider health degraded"
      );
    }
  }
}

/**
 * Create a provider health tracker
 */
export function createProviderHealthTracker(
  logger: Logger,
  stream: EventStream
): { tracker: ProviderHealthTracker; disconnect: Unsubscribe } {
  const tracker = new ProviderHealthTracker(logger);
  const disconnect = tracker.connectToStream(stream);
  return { tracker, disconnect };
}
