/**
 * Event Bus - Pub/sub system for gateway events
 */

import type { GatewayEvent, GatewayEventType } from "./types.js";
import type { Logger } from "../log.js";

type EventHandler = (event: GatewayEvent) => void | Promise<void>;

/**
 * Event Bus for publishing and subscribing to gateway events
 */
export class EventBus {
  private handlers: Map<GatewayEventType | "*", Set<EventHandler>> = new Map();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: "event-bus" });
  }

  /**
   * Subscribe to events
   */
  on(type: GatewayEventType | "*", handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * Subscribe to an event once
   */
  once(type: GatewayEventType | "*", handler: EventHandler): () => void {
    const wrappedHandler: EventHandler = (event) => {
      this.handlers.get(type)?.delete(wrappedHandler);
      return handler(event);
    };

    return this.on(type, wrappedHandler);
  }

  /**
   * Emit an event
   */
  async emit(event: GatewayEvent): Promise<void> {
    this.logger.debug({ type: event.type, sessionKey: event.sessionKey }, "Event emitted");

    // Call specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event);
        } catch (err) {
          this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Event handler error");
        }
      }
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event);
        } catch (err) {
          this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Wildcard handler error");
        }
      }
    }
  }

  /**
   * Remove all handlers for a type
   */
  off(type: GatewayEventType | "*"): void {
    this.handlers.delete(type);
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count
   */
  get handlerCount(): number {
    let count = 0;
    for (const handlers of this.handlers.values()) {
      count += handlers.size;
    }
    return count;
  }
}
