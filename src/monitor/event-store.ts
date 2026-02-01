/**
 * SQLite Event Store for Persistent Event Storage
 *
 * Stores all agent events in SQLite for querying, metrics, and analysis.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  EventData,
  EventQueryOptions,
  EventQueryResult,
  EventStoreConfig,
  EventType,
  MonitorEvent,
  StoredEvent,
  Unsubscribe,
} from "./types.js";
import type { EventStream } from "./event-stream.js";

const DEFAULT_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Persistent event store using SQLite
 */
export class EventStore {
  private readonly db: DatabaseSync;
  private readonly config: EventStoreConfig;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private streamSubscription?: Unsubscribe;

  constructor(config: Partial<EventStoreConfig> & { dbPath: string }) {
    this.config = {
      dbPath: config.dbPath,
      retentionDays: config.retentionDays ?? DEFAULT_RETENTION_DAYS,
      cleanupOnStartup: config.cleanupOnStartup ?? true,
      cleanupIntervalHours: config.cleanupIntervalHours ?? 24,
    };

    // Ensure directory exists
    const dir = path.dirname(this.config.dbPath);
    try {
      fs.mkdir(dir, { recursive: true }).catch(() => {});
    } catch {
      // Ignore sync issues, will fail on db open if needed
    }

    this.db = new DatabaseSync(this.config.dbPath);
    this.ensureSchema();

    if (this.config.cleanupOnStartup) {
      this.cleanup();
    }

    if (this.config.cleanupIntervalHours > 0) {
      const intervalMs = this.config.cleanupIntervalHours * 60 * 60 * 1000;
      this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    }
  }

  /**
   * Connect to an event stream and persist all events
   */
  connectToStream(stream: EventStream): Unsubscribe {
    if (this.streamSubscription) {
      this.streamSubscription();
    }

    this.streamSubscription = stream.subscribeAll((event) => {
      this.store(event);
    });

    return () => {
      if (this.streamSubscription) {
        this.streamSubscription();
        this.streamSubscription = undefined;
      }
    };
  }

  /**
   * Store an event in the database
   */
  store<T extends EventData>(event: MonitorEvent<T>): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, timestamp, session_key, channel, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.type,
      event.timestamp,
      event.sessionKey ?? null,
      event.channel ?? null,
      JSON.stringify(event.data),
    );
  }

  /**
   * Store multiple events in a transaction
   */
  storeBatch<T extends EventData>(events: MonitorEvent<T>[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, timestamp, session_key, channel, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN TRANSACTION");
    try {
      for (const event of events) {
        stmt.run(
          event.id,
          event.type,
          event.timestamp,
          event.sessionKey ?? null,
          event.channel ?? null,
          JSON.stringify(event.data),
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Query events with filtering options
   */
  query<T extends EventData>(options: EventQueryOptions = {}): EventQueryResult<T> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.type) {
      if (Array.isArray(options.type)) {
        const placeholders = options.type.map(() => "?").join(", ");
        conditions.push(`type IN (${placeholders})`);
        params.push(...options.type);
      } else {
        conditions.push("type = ?");
        params.push(options.type);
      }
    }

    if (options.sessionKey) {
      conditions.push("session_key = ?");
      params.push(options.sessionKey);
    }

    if (options.channel) {
      conditions.push("channel = ?");
      params.push(options.channel);
    }

    if (options.startTime !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(options.startTime);
    }

    if (options.endTime !== undefined) {
      conditions.push("timestamp <= ?");
      params.push(options.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = options.orderBy ?? "timestamp";
    const orderDir = options.orderDirection ?? "desc";
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Get total count
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM events ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow.count;

    // Get events
    const rows = this.db
      .prepare(
        `SELECT * FROM events ${whereClause} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as StoredEvent[];

    const events = rows.map((row) => this.deserializeEvent<T>(row));

    return {
      events,
      total,
      hasMore: offset + events.length < total,
    };
  }

  /**
   * Get a single event by ID
   */
  get<T extends EventData>(id: string): MonitorEvent<T> | undefined {
    const row = this.db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as unknown as StoredEvent | undefined;

    return row ? this.deserializeEvent<T>(row) : undefined;
  }

  /**
   * Get events by session
   */
  getBySession<T extends EventData>(sessionKey: string, limit?: number): MonitorEvent<T>[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE session_key = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(sessionKey, limit ?? 100) as unknown as StoredEvent[];

    return rows.map((row) => this.deserializeEvent<T>(row));
  }

  /**
   * Get recent events of a specific type
   */
  getRecent<T extends EventData>(type: EventType, limit?: number): MonitorEvent<T>[] {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(type, limit ?? 100) as unknown as StoredEvent[];

    return rows.map((row) => this.deserializeEvent<T>(row));
  }

  /**
   * Count events by type within a time range
   */
  countByType(startTime?: number, endTime?: number): Record<EventType, number> {
    const conditions: string[] = [];
    const params: number[] = [];

    if (startTime !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(startTime);
    }

    if (endTime !== undefined) {
      conditions.push("timestamp <= ?");
      params.push(endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(`SELECT type, COUNT(*) as count FROM events ${whereClause} GROUP BY type`)
      .all(...params) as Array<{ type: EventType; count: number }>;

    const result: Partial<Record<EventType, number>> = {};
    for (const row of rows) {
      result[row.type] = row.count;
    }

    return result as Record<EventType, number>;
  }

  /**
   * Get aggregated event counts by time period
   */
  getEventCountsByPeriod(
    period: "hour" | "day",
    limit?: number,
  ): Array<{ period: string; count: number }> {
    const format = period === "hour" ? "%Y-%m-%d %H:00" : "%Y-%m-%d";
    const maxLimit = limit ?? 24;

    const rows = this.db
      .prepare(
        `SELECT strftime('${format}', datetime(timestamp / 1000, 'unixepoch')) as period,
                COUNT(*) as count
         FROM events
         GROUP BY period
         ORDER BY period DESC
         LIMIT ?`,
      )
      .all(maxLimit) as Array<{ period: string; count: number }>;

    return rows.reverse();
  }

  /**
   * Get tool usage statistics
   */
  getToolStats(startTime?: number): Array<{
    name: string;
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgDuration: number;
  }> {
    const whereClause = startTime !== undefined ? "AND timestamp >= ?" : "";
    const params = startTime !== undefined ? [startTime] : [];

    const rows = this.db
      .prepare(
        `SELECT
           json_extract(data, '$.name') as name,
           COUNT(*) as totalCalls,
           SUM(CASE WHEN json_extract(data, '$.success') = 1 THEN 1 ELSE 0 END) as successCount,
           SUM(CASE WHEN json_extract(data, '$.success') = 0 THEN 1 ELSE 0 END) as failureCount,
           AVG(json_extract(data, '$.duration')) as avgDuration
         FROM events
         WHERE type = 'tool_executed' ${whereClause}
         GROUP BY name
         ORDER BY totalCalls DESC`,
      )
      .all(...params) as Array<{
      name: string;
      totalCalls: number;
      successCount: number;
      failureCount: number;
      avgDuration: number;
    }>;

    return rows;
  }

  /**
   * Get error statistics
   */
  getErrorStats(startTime?: number): {
    totalErrors: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  } {
    const whereClause = startTime !== undefined ? "AND timestamp >= ?" : "";
    const params = startTime !== undefined ? [startTime] : [];

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM events WHERE type = 'error_occurred' ${whereClause}`,
      )
      .get(...params) as { count: number };

    const severityRows = this.db
      .prepare(
        `SELECT json_extract(data, '$.severity') as severity, COUNT(*) as count
         FROM events
         WHERE type = 'error_occurred' ${whereClause}
         GROUP BY severity`,
      )
      .all(...params) as Array<{ severity: string; count: number }>;

    const typeRows = this.db
      .prepare(
        `SELECT json_extract(data, '$.errorType') as errorType, COUNT(*) as count
         FROM events
         WHERE type = 'error_occurred' ${whereClause}
         GROUP BY errorType
         ORDER BY count DESC
         LIMIT 10`,
      )
      .all(...params) as Array<{ errorType: string; count: number }>;

    const bySeverity: Record<string, number> = {};
    for (const row of severityRows) {
      if (row.severity) {
        bySeverity[row.severity] = row.count;
      }
    }

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      if (row.errorType) {
        byType[row.errorType] = row.count;
      }
    }

    return {
      totalErrors: totalRow.count,
      bySeverity,
      byType,
    };
  }

  /**
   * Delete events older than retention period
   */
  cleanup(): number {
    const cutoffTime = Date.now() - this.config.retentionDays * MS_PER_DAY;

    const result = this.db
      .prepare("DELETE FROM events WHERE timestamp < ?")
      .run(cutoffTime);

    return Number(result.changes);
  }

  /**
   * Delete all events
   */
  clear(): void {
    this.db.exec("DELETE FROM events");
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalEvents: number;
    oldestEvent: number | null;
    newestEvent: number | null;
    dbSizeBytes: number;
  } {
    const countRow = this.db
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as { count: number };

    const timeRow = this.db
      .prepare(
        "SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events",
      )
      .get() as { oldest: number | null; newest: number | null };

    // Get file size
    let dbSizeBytes = 0;
    try {
      const { statSync } = require("node:fs");
      const stats = statSync(this.config.dbPath);
      dbSizeBytes = stats.size;
    } catch {
      // Ignore
    }

    return {
      totalEvents: countRow.count,
      oldestEvent: timeRow.oldest,
      newestEvent: timeRow.newest,
      dbSizeBytes,
    };
  }

  /**
   * Close the database connection and cleanup
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    if (this.streamSubscription) {
      this.streamSubscription();
      this.streamSubscription = undefined;
    }

    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_key TEXT,
        channel TEXT,
        data TEXT NOT NULL
      )
    `);

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_key);
      CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp);
    `);
  }

  private deserializeEvent<T extends EventData>(row: StoredEvent): MonitorEvent<T> {
    return {
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      sessionKey: row.sessionKey ?? undefined,
      channel: row.channel as MonitorEvent<T>["channel"],
      data: JSON.parse(row.data) as T,
    };
  }
}

/**
 * Create an event store with auto-generated path in state directory
 */
export function createEventStore(stateDir: string, options?: Partial<Omit<EventStoreConfig, "dbPath">>): EventStore {
  const dbPath = path.join(stateDir, "events.db");
  return new EventStore({ dbPath, ...options });
}
