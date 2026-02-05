export type RealtimeTransport = "ws" | "sse" | "disconnected";

export type RealtimeConnectionState = {
  connected: boolean;
  transport: RealtimeTransport;
  lastMessageAt: number | null;
  lastError: string | null;
};

export type HubMessage = {
  source: "ws" | "sse";
  payload: unknown;
  receivedAt: number;
};

export class RealtimeHub {
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;

  private listeners = new Set<(msg: HubMessage) => void>();
  private stateListeners = new Set<(state: RealtimeConnectionState) => void>();

  private started = false;
  private state: RealtimeConnectionState = {
    connected: false,
    transport: "disconnected",
    lastMessageAt: null,
    lastError: null,
  };

  private wsReconnectAttempts = 0;
  private wsReconnectTimer: number | null = null;
  private wsOpenTimeout: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connectWebSocket();
  }

  stop(): void {
    this.started = false;
    this.clearReconnectTimers();
    this.closeWebSocket();
    this.closeSse();
    this.setState({
      connected: false,
      transport: "disconnected",
      lastMessageAt: this.state.lastMessageAt,
      lastError: this.state.lastError,
    });
  }

  subscribe(listener: (msg: HubMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeState(listener: (state: RealtimeConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getState(): RealtimeConnectionState {
    return this.state;
  }

  private dispatch(msg: HubMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (err) {
        // Listener errors should never take down the hub
        // eslint-disable-next-line no-console
        console.error("[RealtimeHub] Listener error:", err);
      }
    }
  }

  private setState(next: RealtimeConnectionState): void {
    this.state = next;
    for (const listener of this.stateListeners) {
      try {
        listener(next);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[RealtimeHub] State listener error:", err);
      }
    }
  }

  private clearReconnectTimers(): void {
    if (this.wsReconnectTimer) {
      window.clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsOpenTimeout) {
      window.clearTimeout(this.wsOpenTimeout);
      this.wsOpenTimeout = null;
    }
  }

  private closeWebSocket(): void {
    this.clearReconnectTimers();
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  private closeSse(): void {
    if (!this.sse) return;
    try {
      this.sse.close();
    } catch {
      // ignore
    }
    this.sse = null;
  }

  private connectWebSocket(): void {
    if (!this.started) return;

    this.closeSse();
    this.closeWebSocket();

    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${wsProto}://${window.location.host}/api/ws`;

    let opened = false;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.fallbackToSse(err instanceof Error ? err.message : String(err));
      return;
    }

    this.wsOpenTimeout = window.setTimeout(() => {
      if (opened) return;
      this.fallbackToSse("WebSocket open timeout");
    }, 3000);

    this.ws.onopen = () => {
      opened = true;
      this.wsReconnectAttempts = 0;
      if (this.wsOpenTimeout) {
        window.clearTimeout(this.wsOpenTimeout);
        this.wsOpenTimeout = null;
      }
      this.setState({
        connected: true,
        transport: "ws",
        lastMessageAt: this.state.lastMessageAt,
        lastError: null,
      });
    };

    this.ws.onmessage = (event) => {
      const receivedAt = Date.now();
      this.setState({
        ...this.state,
        connected: true,
        transport: "ws",
        lastMessageAt: receivedAt,
      });

      try {
        const msg = JSON.parse(event.data as string) as { type?: string; payload?: unknown };
        if (msg.type === "pong") return;
        if (msg.type === "event") {
          this.dispatch({ source: "ws", payload: msg.payload, receivedAt });
          return;
        }
        this.dispatch({ source: "ws", payload: msg, receivedAt });
      } catch {
        this.dispatch({ source: "ws", payload: event.data, receivedAt });
      }
    };

    this.ws.onerror = () => {
      if (opened) return;
      this.fallbackToSse("WebSocket error");
    };

    this.ws.onclose = () => {
      const wasConnected = this.state.transport === "ws" && this.state.connected;
      this.setState({
        ...this.state,
        connected: false,
        transport: wasConnected ? "ws" : "disconnected",
      });

      if (!this.started) return;
      this.fallbackToSse("WebSocket closed");
    };
  }

  private fallbackToSse(reason: string): void {
    if (!this.started) return;

    this.closeWebSocket();
    this.connectSse(reason);

    // Try WS again later (upgrade path)
    this.wsReconnectAttempts += 1;
    const baseDelay = Math.min(30_000, 1000 * Math.pow(2, this.wsReconnectAttempts));
    const jitter = Math.floor(Math.random() * 250);
    const delay = baseDelay + jitter;

    this.wsReconnectTimer = window.setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  private connectSse(reason: string): void {
    if (!this.started) return;

    this.closeSse();
    this.setState({
      connected: false,
      transport: "sse",
      lastMessageAt: this.state.lastMessageAt,
      lastError: reason,
    });

    try {
      this.sse = new EventSource("/api/events/stream");
    } catch (err) {
      this.setState({
        connected: false,
        transport: "disconnected",
        lastMessageAt: this.state.lastMessageAt,
        lastError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    this.sse.addEventListener("event", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const receivedAt = Date.now();
      this.setState({
        ...this.state,
        connected: true,
        transport: "sse",
        lastMessageAt: receivedAt,
      });

      try {
        const payload = JSON.parse(event.data) as unknown;
        this.dispatch({ source: "sse", payload, receivedAt });
      } catch {
        this.dispatch({ source: "sse", payload: event.data, receivedAt });
      }
    });

    this.sse.onopen = () => {
      this.setState({
        ...this.state,
        connected: true,
        transport: "sse",
        lastError: null,
      });
    };

    this.sse.onerror = () => {
      this.setState({
        ...this.state,
        connected: false,
        transport: "sse",
        lastError: "SSE error",
      });
    };
  }
}

