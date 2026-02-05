import type { BridgeEnvelope, BridgeEvent, BridgeMessage, BridgeSend } from "./types.js";

export type BridgeRequestHandler = (payload: unknown) => Promise<unknown> | unknown;

export class BridgeServer {
  private readonly target: "gateway" | "worker";
  private readonly send: BridgeSend;
  private readonly handlers = new Map<string, BridgeRequestHandler>();

  constructor(params: { target: "gateway" | "worker"; send: BridgeSend }) {
    this.target = params.target;
    this.send = params.send;
  }

  register(type: string, handler: BridgeRequestHandler): void {
    this.handlers.set(type, handler);
  }

  handleEnvelope(envelope: BridgeEnvelope): void {
    if (envelope.channel !== "bridge") return;
    if (envelope.target !== this.target) return;

    const message: BridgeMessage = envelope.message;
    if (message.kind !== "request") return;

    void this.handleRequest(message.request.id, message.request.type, message.request.payload);
  }

  sendEvent(type: string, payload?: unknown): void {
    const target = this.target === "gateway" ? "worker" : "gateway";
    const event: BridgeEvent = { type, payload };
    const envelope: BridgeEnvelope = {
      channel: "bridge",
      target,
      message: { kind: "event", event },
    };
    this.send(envelope);
  }

  private async handleRequest(id: string, type: string, payload?: unknown): Promise<void> {
    const handler = this.handlers.get(type);
    if (!handler) {
      this.sendResponse(id, false, undefined, `Unknown bridge request: ${type}`);
      return;
    }

    try {
      const result = await handler(payload);
      this.sendResponse(id, true, result);
    } catch (err) {
      this.sendResponse(id, false, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private sendResponse(id: string, ok: boolean, payload?: unknown, error?: string): void {
    const target = this.target === "gateway" ? "worker" : "gateway";
    const envelope: BridgeEnvelope = {
      channel: "bridge",
      target,
      message: { kind: "response", response: { id, ok, payload, error } },
    };
    this.send(envelope);
  }
}
