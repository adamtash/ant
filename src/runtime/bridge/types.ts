export type BridgeRequest = {
  id: string;
  type: string;
  payload?: unknown;
};

export type BridgeResponse = {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export type BridgeEvent = {
  type: string;
  payload?: unknown;
};

export type BridgeMessage =
  | { kind: "request"; request: BridgeRequest }
  | { kind: "response"; response: BridgeResponse }
  | { kind: "event"; event: BridgeEvent };

export type BridgeEnvelope = {
  channel: "bridge";
  target: "gateway" | "worker";
  message: BridgeMessage;
};

export type BridgeSend = (envelope: BridgeEnvelope) => void;
