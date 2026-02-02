/**
 * Event Pub/Sub System for Agent Events
 *
 * Provides a centralized event bus for publishing and subscribing to
 * all agent-related events in the system.
 */

import crypto from "node:crypto";

import type {
  EventData,
  EventFilter,
  EventListener,
  EventType,
  MonitorEvent,
  Unsubscribe,
} from "./types.js";

/**
 * Type-safe event emitter for monitoring events
 */
export class EventStream {
  private readonly listeners = new Map<EventType | "*", Set<EventListener<EventData>>>();
  private readonly filters = new Map<EventListener<EventData>, EventFilter<EventData>>();
  private readonly eventBuffer: MonitorEvent<EventData>[] = [];
  private readonly maxBufferSize: number;
  private paused = false;

  constructor(options?: { maxBufferSize?: number }) {
    this.maxBufferSize = options?.maxBufferSize ?? 1000;
  }

  /**
   * Subscribe to events of a specific type
   */
  subscribe<T extends EventData>(
    type: EventType,
    listener: EventListener<T>,
    filter?: EventFilter<T>,
  ): Unsubscribe {
    return this.addListener(type, listener as EventListener<EventData>, filter as EventFilter<EventData>);
  }

  /**
   * Subscribe to all events
   */
  subscribeAll<T extends EventData>(
    listener: EventListener<T>,
    filter?: EventFilter<T>,
  ): Unsubscribe {
    return this.addListener("*", listener as EventListener<EventData>, filter as EventFilter<EventData>);
  }

  /**
   * Publish an event to all subscribers
   */
  async publish<T extends EventData>(
    type: EventType,
    data: T,
    options?: {
      sessionKey?: string;
      channel?: string;
    },
  ): Promise<MonitorEvent<T>> {
    const event: MonitorEvent<T> = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      sessionKey: options?.sessionKey,
      channel: options?.channel as MonitorEvent<T>["channel"],
      data,
    };

    // Buffer events while paused
    if (this.paused) {
      if (this.eventBuffer.length < this.maxBufferSize) {
        this.eventBuffer.push(event as MonitorEvent<EventData>);
      }
      return event;
    }

    await this.dispatch(event as MonitorEvent<EventData>);
    return event;
  }

  /**
   * Create a typed publisher for a specific event type
   */
  createPublisher<T extends EventData>(type: EventType) {
    return async (data: T, options?: { sessionKey?: string; channel?: string }) => {
      return this.publish(type, data, options);
    };
  }

  /**
   * Pause event dispatch (events are buffered)
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume event dispatch and flush buffered events
   */
  async resume(): Promise<void> {
    this.paused = false;
    const events = [...this.eventBuffer];
    this.eventBuffer.length = 0;

    for (const event of events) {
      await this.dispatch(event);
    }
  }

  /**
   * Check if the stream is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get the number of buffered events
   */
  getBufferSize(): number {
    return this.eventBuffer.length;
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
    this.filters.clear();
  }

  /**
   * Get listener count for a specific type (or all)
   */
  listenerCount(type?: EventType | "*"): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * Wait for the next event of a specific type
   */
  once<T extends EventData>(
    type: EventType,
    filter?: EventFilter<T>,
    timeout?: number,
  ): Promise<MonitorEvent<T>> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsubscribe = this.subscribe<T>(
        type,
        (event) => {
          if (timeoutId) clearTimeout(timeoutId);
          unsubscribe();
          resolve(event);
        },
        filter,
      );

      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${type}`));
        }, timeout);
      }
    });
  }

  /**
   * Create a filtered view of the event stream
   */
  filter<T extends EventData>(predicate: EventFilter<T>): FilteredEventStream<T> {
    return new FilteredEventStream(this, predicate);
  }

  private addListener(
    type: EventType | "*",
    listener: EventListener<EventData>,
    filter?: EventFilter<EventData>,
  ): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);

    if (filter) {
      this.filters.set(listener, filter);
    }

    return () => {
      set?.delete(listener);
      this.filters.delete(listener);
      if (set?.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  private async dispatch(event: MonitorEvent<EventData>): Promise<void> {
    const typeListeners = this.listeners.get(event.type);
    const allListeners = this.listeners.get("*");

    const listeners = new Set<EventListener<EventData>>();
    if (typeListeners) {
      for (const l of typeListeners) listeners.add(l);
    }
    if (allListeners) {
      for (const l of allListeners) listeners.add(l);
    }

    const promises: Promise<void>[] = [];

    for (const listener of listeners) {
      const filter = this.filters.get(listener);
      if (filter && !filter(event)) {
        continue;
      }

      try {
        const result = listener(event);
        if (result instanceof Promise) {
          promises.push(result.catch(() => {}));
        }
      } catch {
        // Ignore listener errors
      }
    }

    await Promise.all(promises);
  }
}

/**
 * A filtered view of an event stream
 */
export class FilteredEventStream<T extends EventData> {
  constructor(
    private readonly stream: EventStream,
    private readonly predicate: EventFilter<T>,
  ) {}

  subscribe(listener: EventListener<T>): Unsubscribe {
    return this.stream.subscribeAll<T>(listener, this.predicate);
  }

  filter(predicate: EventFilter<T>): FilteredEventStream<T> {
    const combined: EventFilter<T> = (event) =>
      this.predicate(event) && predicate(event);
    return new FilteredEventStream(this.stream, combined);
  }
}

/**
 * Global event stream singleton
 */
let globalStream: EventStream | undefined;

/**
 * Get or create the global event stream
 */
export function getEventStream(): EventStream {
  if (!globalStream) {
    globalStream = new EventStream();
  }
  return globalStream;
}

/**
 * Set a custom global event stream (useful for testing)
 */
export function setEventStream(stream: EventStream): void {
  globalStream = stream;
}

/**
 * Helper to create event publishers for common event types
 */
export function createEventPublishers(stream: EventStream) {
  return {
    messageReceived: stream.createPublisher("message_received"),
    messageQueued: stream.createPublisher("message_queued"),
    messageProcessing: stream.createPublisher("message_processing"),
    messageProcessed: stream.createPublisher("message_processed"),
    messageDropped: stream.createPublisher("message_dropped"),
    messageTimeout: stream.createPublisher("message_timeout"),
    
    agentThinking: stream.createPublisher("agent_thinking"),
    agentResponse: stream.createPublisher("agent_response"),
    
    toolExecuting: stream.createPublisher("tool_executing"),
    toolExecuted: stream.createPublisher("tool_executed"),
    toolPartUpdated: stream.createPublisher("tool_part_updated"),
    
    subagentSpawned: stream.createPublisher("subagent_spawned"),
    cronTriggered: stream.createPublisher("cron_triggered"),
    errorOccurred: stream.createPublisher("error_occurred"),
    memoryIndexed: stream.createPublisher("memory_indexed"),
    sessionStarted: stream.createPublisher("session_started"),
    sessionEnded: stream.createPublisher("session_ended"),
    mainAgentStatusChanged: stream.createPublisher("main_agent_status_changed"),
    
    jobCreated: stream.createPublisher("job_created"),
    jobStarted: stream.createPublisher("job_started"),
    jobCompleted: stream.createPublisher("job_completed"),
    jobFailed: stream.createPublisher("job_failed"),
    jobEnabled: stream.createPublisher("job_enabled"),
    jobDisabled: stream.createPublisher("job_disabled"),
    jobRemoved: stream.createPublisher("job_removed"),
    
    skillCreated: stream.createPublisher("skill_created"),
    skillDeleted: stream.createPublisher("skill_deleted"),
    
    providerCooldown: stream.createPublisher("provider_cooldown"),
    providerRecovery: stream.createPublisher("provider_recovery"),
  };
}
