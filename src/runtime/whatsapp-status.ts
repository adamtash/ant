export type WhatsAppStatus = {
  connection?: string;
  qr?: string;
  loggedOut?: boolean;
  statusCode?: number;
  lastUpdated: number;
};

export type WhatsAppStatusStore = {
  get: () => WhatsAppStatus;
  update: (partial: Partial<WhatsAppStatus>) => void;
};

export function createWhatsAppStatusStore(): WhatsAppStatusStore {
  let state: WhatsAppStatus = { connection: "init", lastUpdated: Date.now() };
  return {
    get: () => state,
    update: (partial) => {
      state = { ...state, ...partial, lastUpdated: Date.now() };
    },
  };
}
