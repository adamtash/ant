/**
 * Alert System for Critical Errors
 *
 * Monitors error frequency and sends alerts when thresholds are exceeded.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { EventStream } from "./event-stream.js";
import type {
  Alert,
  AlertChannel,
  AlertConfig,
  AlertHandler,
  ErrorOccurredData,
  ErrorSeverity,
  MonitorEvent,
  Unsubscribe,
} from "./types.js";

const SEVERITY_LEVELS: Record<ErrorSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  channels: ["console"],
  errorThreshold: 10,
  errorWindowMs: 60_000, // 1 minute
  cooldownMs: 300_000, // 5 minutes
  minSeverity: "medium",
};

/**
 * Alert system for monitoring critical errors
 */
export class Alerter {
  private readonly config: AlertConfig;
  private readonly errorTimestamps: number[] = [];
  private readonly handlers = new Map<AlertChannel, AlertHandler>();
  private lastAlertTime = 0;
  private streamSubscription?: Unsubscribe;
  private customHandlers: AlertHandler[] = [];

  constructor(config?: Partial<AlertConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupDefaultHandlers();
  }

  /**
   * Connect to event stream and monitor for errors
   */
  connectToStream(stream: EventStream): Unsubscribe {
    if (this.streamSubscription) {
      this.streamSubscription();
    }

    this.streamSubscription = stream.subscribe<ErrorOccurredData>(
      "error_occurred",
      async (event) => {
        await this.handleError(event as MonitorEvent<ErrorOccurredData>);
      },
    );

    return () => {
      if (this.streamSubscription) {
        this.streamSubscription();
        this.streamSubscription = undefined;
      }
    };
  }

  /**
   * Register a custom alert handler
   */
  addHandler(handler: AlertHandler): Unsubscribe {
    this.customHandlers.push(handler);
    return () => {
      const idx = this.customHandlers.indexOf(handler);
      if (idx !== -1) {
        this.customHandlers.splice(idx, 1);
      }
    };
  }

  /**
   * Set handler for a specific channel
   */
  setChannelHandler(channel: AlertChannel, handler: AlertHandler): void {
    this.handlers.set(channel, handler);
  }

  /**
   * Manually trigger an alert
   */
  async sendAlert(alert: Omit<Alert, "id" | "timestamp">): Promise<void> {
    const fullAlert: Alert = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...alert,
    };

    await this.dispatchAlert(fullAlert);
  }

  /**
   * Check if alerting is in cooldown period
   */
  isInCooldown(): boolean {
    return Date.now() - this.lastAlertTime < this.config.cooldownMs;
  }

  /**
   * Get current error count in the window
   */
  getErrorCountInWindow(): number {
    this.pruneOldErrors();
    return this.errorTimestamps.length;
  }

  /**
   * Get time until cooldown expires (0 if not in cooldown)
   */
  getCooldownRemaining(): number {
    const remaining = this.config.cooldownMs - (Date.now() - this.lastAlertTime);
    return Math.max(0, remaining);
  }

  /**
   * Reset error tracking state
   */
  reset(): void {
    this.errorTimestamps.length = 0;
    this.lastAlertTime = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AlertConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AlertConfig> {
    return { ...this.config };
  }

  private async handleError(event: MonitorEvent<ErrorOccurredData>): Promise<void> {
    if (!this.config.enabled) return;

    const { severity } = event.data;

    // Check minimum severity
    if (SEVERITY_LEVELS[severity] < SEVERITY_LEVELS[this.config.minSeverity]) {
      return;
    }

    // Handle critical errors immediately
    if (severity === "critical") {
      await this.triggerCriticalAlert(event);
      return;
    }

    // Track error for threshold checking
    this.errorTimestamps.push(event.timestamp);
    this.pruneOldErrors();

    // Check if threshold exceeded
    if (this.errorTimestamps.length >= this.config.errorThreshold) {
      await this.triggerThresholdAlert();
    }
  }

  private async triggerCriticalAlert(event: MonitorEvent<ErrorOccurredData>): Promise<void> {
    if (this.isInCooldown()) return;

    const alert: Alert = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: "critical_error",
      severity: "critical",
      title: "Critical Error Occurred",
      message: event.data.message,
      context: {
        errorType: event.data.errorType,
        stack: event.data.stack,
        sessionKey: event.sessionKey,
        channel: event.channel,
        ...event.data.context,
      },
    };

    await this.dispatchAlert(alert);
  }

  private async triggerThresholdAlert(): Promise<void> {
    if (this.isInCooldown()) return;

    const alert: Alert = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: "error_threshold",
      severity: "high",
      title: "Error Threshold Exceeded",
      message: `${this.errorTimestamps.length} errors occurred in the last ${Math.round(this.config.errorWindowMs / 1000)} seconds`,
      context: {
        errorCount: this.errorTimestamps.length,
        timeWindowMs: this.config.errorWindowMs,
        threshold: this.config.errorThreshold,
      },
    };

    await this.dispatchAlert(alert);
  }

  private async dispatchAlert(alert: Alert): Promise<void> {
    this.lastAlertTime = Date.now();

    const promises: Promise<void>[] = [];

    // Dispatch to configured channels
    for (const channel of this.config.channels) {
      const handler = this.handlers.get(channel);
      if (handler) {
        promises.push(handler(alert).catch(() => {}));
      }
    }

    // Dispatch to custom handlers
    for (const handler of this.customHandlers) {
      promises.push(handler(alert).catch(() => {}));
    }

    await Promise.all(promises);
  }

  private pruneOldErrors(): void {
    const cutoff = Date.now() - this.config.errorWindowMs;
    while (this.errorTimestamps.length > 0 && (this.errorTimestamps[0] ?? 0) < cutoff) {
      this.errorTimestamps.shift();
    }
  }

  private setupDefaultHandlers(): void {
    // Console handler
    this.handlers.set("console", async (alert) => {
      const prefix = getAlertPrefix(alert.severity);
      console.error(`${prefix} [ALERT] ${alert.title}`);
      console.error(`  Message: ${alert.message}`);
      console.error(`  Time: ${new Date(alert.timestamp).toISOString()}`);
      console.error(`  ID: ${alert.id}`);
      if (Object.keys(alert.context).length > 0) {
        console.error(`  Context: ${JSON.stringify(alert.context, null, 2)}`);
      }
    });

    // File handler
    this.handlers.set("file", async (alert) => {
      if (!this.config.alertFilePath) return;

      const dir = path.dirname(this.config.alertFilePath);
      await fs.mkdir(dir, { recursive: true });

      const line = JSON.stringify({
        ...alert,
        timestampIso: new Date(alert.timestamp).toISOString(),
      }) + "\n";

      await fs.appendFile(this.config.alertFilePath, line, "utf-8");
    });

    // Webhook handler (placeholder - implement actual HTTP call)
    this.handlers.set("webhook", async (alert) => {
      if (!this.config.webhookUrl) return;

      try {
        await fetch(this.config.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alert),
        });
      } catch {
        // Ignore webhook failures
      }
    });

    // WhatsApp handler (placeholder - requires WhatsApp client integration)
    this.handlers.set("whatsapp", async (_alert) => {
      // This would need to be connected to the WhatsApp client
      // Implementation depends on how WhatsApp client is exposed
      // For now, log a warning that this needs to be set up
      if (this.config.whatsappRecipients?.length) {
        console.warn("[Alerter] WhatsApp handler not configured. Set a custom handler using setChannelHandler.");
      }
    });
  }
}

/**
 * Create an alerter connected to an event stream
 */
export function createAlerter(
  stream: EventStream,
  config?: Partial<AlertConfig>,
): { alerter: Alerter; disconnect: Unsubscribe } {
  const alerter = new Alerter(config);
  const disconnect = alerter.connectToStream(stream);
  return { alerter, disconnect };
}

/**
 * Get colored prefix for console output based on severity
 */
function getAlertPrefix(severity: ErrorSeverity): string {
  switch (severity) {
    case "critical":
      return "\x1b[41m\x1b[37m CRITICAL \x1b[0m";
    case "high":
      return "\x1b[31m[HIGH]\x1b[0m";
    case "medium":
      return "\x1b[33m[MEDIUM]\x1b[0m";
    case "low":
      return "\x1b[36m[LOW]\x1b[0m";
    default:
      return "[ALERT]";
  }
}
