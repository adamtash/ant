export type InboundMessage = {
  sessionKey: string;
  chatId: string;
  senderId?: string;
  senderName?: string;
  text: string;
  isGroup: boolean;
  timestamp: number;
};

export type DeliveryContext = {
  channel: "whatsapp";
  chatId: string;
};
