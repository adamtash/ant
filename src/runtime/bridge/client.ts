import crypto from "node:crypto";

import type { BridgeEnvelope, BridgeEvent, BridgeMessage, BridgeSend } from "./types.js";

export class BridgeClient {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly send: BridgeSend;
  private readonly timeoutMs: number;
  private readonly onEvent?: (event: BridgeEvent) => void;
  private readonly target: "gateway" | "worker";

  constructor(params: {
    send: BridgeSend;
    timeoutMs: number;
    target: "gateway" | "worker";
    onEvent?: (event: BridgeEvent) => void;
  }) {
    this.send = params.send;
    this.timeoutMs = params.timeoutMs;
    this.target = params.target;
    this.onEvent = params.onEvent;
  }

  request<T = unknown>(type: string, payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();

    const envelope: BridgeEnvelope = {
      channel: "bridge",
      target: this.target,
      message: { kind: "request", request: { id, type, payload } },
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request timed out: ${type}`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send(envelope);
    });
  }

  handleEnvelope(envelope: BridgeEnvelope): void {
    if (envelope.channel !== "bridge") return;

    const msg: BridgeMessage = envelope.message;
    if (msg.kind === "response") {
      const pending = this.pending.get(msg.response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.response.id);
      if (msg.response.ok) {
        pending.resolve(msg.response.payload);
      } else {
        pending.reject(new Error(msg.response.error || "Bridge response error"));
      }
      return;
    }

    if (msg.kind === "event") {
      this.onEvent?.(msg.event);
    }
  }
}
