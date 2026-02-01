/**
 * Monitoring & Observability Module
 *
 * Provides comprehensive event tracking, metrics collection, and alerting
 * for the ANT agent system.
 *
 * Usage:
 * ```typescript
 * import {
 *   getEventStream,
 *   createEventStore,
 *   createMetricsSystem,
 *   createAlerter,
 * } from "./monitor/index.js";
 *
 * // Get or create the global event stream
 * const stream = getEventStream();
 *
 * // Create persistent event store
 * const store = createEventStore(stateDir);
 * store.connectToStream(stream);
 *
 * // Set up metrics collection
 * const { collector, aggregator, disconnect } = createMetricsSystem(stream, store);
 *
 * // Set up alerting
 * const { alerter } = createAlerter(stream, { errorThreshold: 5 });
 *
 * // Publish events
 * stream.publish("message_received", {
 *   sender: "user123",
 *   contentPreview: "Hello...",
 *   messageLength: 50,
 * }, { sessionKey: "session-1", channel: "whatsapp" });
 * ```
 */

// Types
export type {
  EventType,
  ErrorSeverity,
  BaseEvent,
  MessageReceivedData,
  ToolExecutedData,
  AgentThinkingData,
  SubagentSpawnedData,
  CronTriggeredData,
  ErrorOccurredData,
  MemoryIndexedData,
  SessionStartedData,
  SessionEndedData,
  EventData,
  MonitorEvent,
  StoredEvent,
  EventQueryOptions,
  EventQueryResult,
  AggregationPeriod,
  EventCount,
  ToolUsageStats,
  SessionStats,
  ErrorStats,
  SystemMetrics,
  AlertChannel,
  AlertConfig,
  Alert,
  AlertHandler,
  EventStoreConfig,
  EventListener,
  Unsubscribe,
  EventFilter,
} from "./types.js";

// Event Stream
export {
  EventStream,
  FilteredEventStream,
  getEventStream,
  setEventStream,
  createEventPublishers,
} from "./event-stream.js";

// Event Store
export { EventStore, createEventStore } from "./event-store.js";

// Metrics
export {
  MetricsCollector,
  MetricsAggregator,
  createMetricsSystem,
} from "./metrics.js";

// Alerter
export { Alerter, createAlerter } from "./alerter.js";
