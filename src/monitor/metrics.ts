/**
 * Performance Metrics Collection
 *
 * Collects and aggregates performance metrics from the event stream.
 */

import type { EventStore } from "./event-store.js";
import type { EventStream } from "./event-stream.js";
import type {
  AggregationPeriod,
  ErrorOccurredData,
  ErrorSeverity,
  ErrorStats,
  EventCount,
  MonitorEvent,
  SessionStats,
  SystemMetrics,
  ToolExecutedData,
  ToolUsageStats,
  Unsubscribe,
} from "./types.js";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Real-time metrics collector
 */
export class MetricsCollector {
  private readonly startTime = Date.now();
  private readonly toolMetrics = new Map<string, ToolMetricsAccumulator>();
  private readonly errorCounts = new Map<string, number>();
  private readonly severityCounts = new Map<ErrorSeverity, number>();
  private readonly recentErrors: MonitorEvent<ErrorOccurredData>[] = [];
  private readonly sessionDurations: number[] = [];
  private readonly sessionMessageCounts: number[] = [];
  private totalEvents = 0;
  private activeSessions = 0;
  private subscriptions: Unsubscribe[] = [];

  private readonly maxRecentErrors: number;
  private readonly maxSampleSize: number;

  constructor(options?: { maxRecentErrors?: number; maxSampleSize?: number }) {
    this.maxRecentErrors = options?.maxRecentErrors ?? 100;
    this.maxSampleSize = options?.maxSampleSize ?? 1000;
  }

  /**
   * Connect to event stream for real-time metrics
   */
  connectToStream(stream: EventStream): Unsubscribe {
    // Track all events
    this.subscriptions.push(
      stream.subscribeAll(() => {
        this.totalEvents++;
      }),
    );

    // Track tool executions
    this.subscriptions.push(
      stream.subscribe<ToolExecutedData>("tool_executed", (event) => {
        this.recordToolExecution(event.data);
      }),
    );

    // Track errors
    this.subscriptions.push(
      stream.subscribe<ErrorOccurredData>("error_occurred", (event) => {
        this.recordError(event as MonitorEvent<ErrorOccurredData>);
      }),
    );

    // Track session lifecycle
    this.subscriptions.push(
      stream.subscribe("session_started", () => {
        this.activeSessions++;
      }),
    );

    this.subscriptions.push(
      stream.subscribe("session_ended", (event) => {
        this.activeSessions = Math.max(0, this.activeSessions - 1);
        const data = event.data as { duration?: number; messagesCount?: number };
        if (data.duration !== undefined) {
          this.addSample(this.sessionDurations, data.duration);
        }
        if (data.messagesCount !== undefined) {
          this.addSample(this.sessionMessageCounts, data.messagesCount);
        }
      }),
    );

    return () => {
      for (const unsub of this.subscriptions) {
        unsub();
      }
      this.subscriptions = [];
    };
  }

  /**
   * Record a tool execution
   */
  recordToolExecution(data: ToolExecutedData): void {
    let acc = this.toolMetrics.get(data.name);
    if (!acc) {
      acc = new ToolMetricsAccumulator(data.name);
      this.toolMetrics.set(data.name, acc);
    }
    acc.record(data.duration, data.success);
  }

  /**
   * Record an error
   */
  recordError(event: MonitorEvent<ErrorOccurredData>): void {
    const { errorType, severity } = event.data;

    // Count by type
    const typeCount = this.errorCounts.get(errorType) ?? 0;
    this.errorCounts.set(errorType, typeCount + 1);

    // Count by severity
    const sevCount = this.severityCounts.get(severity) ?? 0;
    this.severityCounts.set(severity, sevCount + 1);

    // Keep recent errors
    this.recentErrors.unshift(event);
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.pop();
    }
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get total event count
   */
  getTotalEvents(): number {
    return this.totalEvents;
  }

  /**
   * Get active session count
   */
  getActiveSessions(): number {
    return this.activeSessions;
  }

  /**
   * Get tool usage statistics
   */
  getToolStats(): ToolUsageStats[] {
    return Array.from(this.toolMetrics.values()).map((acc) => acc.getStats());
  }

  /**
   * Get error statistics
   */
  getErrorStats(): ErrorStats {
    const bySeverity: Record<ErrorSeverity, number> = {
      low: this.severityCounts.get("low") ?? 0,
      medium: this.severityCounts.get("medium") ?? 0,
      high: this.severityCounts.get("high") ?? 0,
      critical: this.severityCounts.get("critical") ?? 0,
    };

    const byType: Record<string, number> = {};
    for (const [type, count] of this.errorCounts) {
      byType[type] = count;
    }

    return {
      totalErrors: this.recentErrors.length,
      bySeverity,
      byType,
      recentErrors: this.recentErrors.slice(0, 10),
    };
  }

  /**
   * Get session statistics
   */
  getSessionStats(): SessionStats {
    return {
      totalSessions: this.sessionDurations.length,
      activeSessions: this.activeSessions,
      avgDuration: average(this.sessionDurations),
      avgMessagesPerSession: average(this.sessionMessageCounts),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.toolMetrics.clear();
    this.errorCounts.clear();
    this.severityCounts.clear();
    this.recentErrors.length = 0;
    this.sessionDurations.length = 0;
    this.sessionMessageCounts.length = 0;
    this.totalEvents = 0;
    this.activeSessions = 0;
  }

  private addSample(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > this.maxSampleSize) {
      arr.shift();
    }
  }
}

/**
 * Accumulator for tool-level metrics
 */
class ToolMetricsAccumulator {
  private totalCalls = 0;
  private successCount = 0;
  private failureCount = 0;
  private totalDuration = 0;
  private minDuration = Infinity;
  private maxDuration = 0;

  constructor(private readonly name: string) {}

  record(duration: number, success: boolean): void {
    this.totalCalls++;
    this.totalDuration += duration;

    if (success) {
      this.successCount++;
    } else {
      this.failureCount++;
    }

    if (duration < this.minDuration) {
      this.minDuration = duration;
    }
    if (duration > this.maxDuration) {
      this.maxDuration = duration;
    }
  }

  getStats(): ToolUsageStats {
    return {
      name: this.name,
      totalCalls: this.totalCalls,
      successCount: this.successCount,
      failureCount: this.failureCount,
      avgDuration: this.totalCalls > 0 ? this.totalDuration / this.totalCalls : 0,
      minDuration: this.minDuration === Infinity ? 0 : this.minDuration,
      maxDuration: this.maxDuration,
    };
  }
}

/**
 * Metrics aggregator that combines real-time and historical data
 */
export class MetricsAggregator {
  constructor(
    private readonly collector: MetricsCollector,
    private readonly store: EventStore,
  ) {}

  /**
   * Get comprehensive system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const toolUsage = this.collector.getToolStats();
    const sessionStats = this.collector.getSessionStats();
    const errorStats = this.collector.getErrorStats();
    const eventsPerHour = this.store.getEventCountsByPeriod("hour", 24);

    // Get top errors from store for historical data
    const storeErrorStats = this.store.getErrorStats(Date.now() - MS_PER_DAY);
    const topErrors = Object.entries(storeErrorStats.byType)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      eventsPerHour,
      toolUsage,
      sessionStats,
      errorStats,
      topErrors,
      uptime: this.collector.getUptime(),
    };
  }

  /**
   * Get event counts for a specific period
   */
  getEventCounts(
    period: AggregationPeriod,
    limit?: number,
  ): EventCount[] {
    const periodMap = {
      minute: "hour" as const,
      hour: "hour" as const,
      day: "day" as const,
      week: "day" as const,
    };

    return this.store.getEventCountsByPeriod(periodMap[period], limit);
  }

  /**
   * Get tool statistics for a time range
   */
  getToolStatsForRange(startTime?: number): ToolUsageStats[] {
    const storeStats = this.store.getToolStats(startTime);

    return storeStats.map((s) => ({
      name: s.name,
      totalCalls: s.totalCalls,
      successCount: s.successCount,
      failureCount: s.failureCount,
      avgDuration: s.avgDuration,
      minDuration: 0, // Not tracked in store
      maxDuration: 0, // Not tracked in store
    }));
  }

  /**
   * Get error rate (errors per hour)
   */
  getErrorRate(hours = 1): number {
    const startTime = Date.now() - hours * MS_PER_HOUR;
    const stats = this.store.getErrorStats(startTime);
    return stats.totalErrors / hours;
  }

  /**
   * Get success rate for a specific tool
   */
  getToolSuccessRate(toolName: string): number {
    const stats = this.collector.getToolStats().find((s) => s.name === toolName);
    if (!stats || stats.totalCalls === 0) return 1;
    return stats.successCount / stats.totalCalls;
  }
}

/**
 * Create a metrics system connected to stream and store
 */
export function createMetricsSystem(
  stream: EventStream,
  store: EventStore,
): { collector: MetricsCollector; aggregator: MetricsAggregator; disconnect: Unsubscribe } {
  const collector = new MetricsCollector();
  const aggregator = new MetricsAggregator(collector, store);

  const disconnect = collector.connectToStream(stream);

  return { collector, aggregator, disconnect };
}

// Utility functions

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}
