/**
 * Tunnels
 * Channel connectivity + pairing workflows
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Badge, Button, Card, Modal, Skeleton } from "../components/base";
import {
  approveTelegramPairing,
  denyTelegramPairing,
  getChannels,
  getTelegramPairing,
  removeTelegramAllowFrom,
  type ChannelResponse,
  type TelegramPairingSnapshotResponse,
} from "../api/client";

type ChannelStatus = ChannelResponse["channels"][number];

function channelIcon(id: string): string {
  if (id === "whatsapp") return "📱";
  if (id === "telegram") return "✈️";
  if (id === "cli") return "💻";
  if (id === "web") return "🌐";
  return "🔌";
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const Tunnels: React.FC = () => {
  const queryClient = useQueryClient();
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: getChannels,
    refetchInterval: (query) => {
      const channels = (query.state.data as ChannelResponse | undefined)?.channels ?? [];
      const hasQr = channels.some((c) => typeof c.status.qr === "string" && !c.status.connected);
      return hasQr ? 2000 : 10_000;
    },
  });

  const telegramQuery = useQuery({
    queryKey: ["telegramPairing"],
    queryFn: getTelegramPairing,
    enabled: telegramModalOpen,
    refetchInterval: telegramModalOpen ? 2000 : false,
  });

  const approveMutation = useMutation({
    mutationFn: (code: string) => approveTelegramPairing(code),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["telegramPairing"] }),
  });

  const denyMutation = useMutation({
    mutationFn: (code: string) => denyTelegramPairing(code),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["telegramPairing"] }),
  });

  const removeAllowMutation = useMutation({
    mutationFn: (entry: string) => removeTelegramAllowFrom(entry),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["telegramPairing"] }),
  });

  const channels = ((channelsQuery.data as ChannelResponse | undefined)?.channels ?? []) as ChannelStatus[];

  const sorted = useMemo(() => {
    const score = (id: string) =>
      id === "whatsapp" ? 0 : id === "telegram" ? 1 : id === "cli" ? 2 : id === "web" ? 3 : 9;
    return [...channels].sort((a, b) => score(a.id) - score(b.id));
  }, [channels]);

  if (channelsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={120} />
        <Skeleton variant="rectangular" height={120} />
      </div>
    );
  }

  const pairing = telegramQuery.data as TelegramPairingSnapshotResponse | undefined;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">📡</span>
            Tunnels
          </h1>
          <p className="text-sm text-gray-400">Communication Channels</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["channels"] })}
          loading={channelsQuery.isFetching}
        >
          Refresh Status
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sorted.map((channel) => (
            <Card key={channel.id} className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-3xl">{channelIcon(channel.id)}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-white capitalize">{channel.id}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          channel.status.connected ? "bg-nurse-green" : "bg-soldier-rust"
                        }`}
                      />
                      <span>{channel.status.connected ? "Connected" : "Disconnected"}</span>
                      {typeof channel.status.dmPolicy === "string" ? (
                        <>
                          <span>•</span>
                          <span className="font-mono">{channel.status.dmPolicy}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <Badge variant={channel.status.connected ? "nurse" : "soldier"} dot pulse={!channel.status.connected}>
                  {channel.status.connected ? "online" : "offline"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                {channel.status.selfJid ? (
                  <div className="col-span-2">
                    self: <span className="text-white font-mono">{channel.status.selfJid}</span>
                  </div>
                ) : null}
                {typeof channel.status.messageCount === "number" ? (
                  <div>
                    msgs: <span className="text-white font-mono">{channel.status.messageCount}</span>
                  </div>
                ) : null}
                {typeof channel.status.activeUsers === "number" ? (
                  <div>
                    users: <span className="text-white font-mono">{channel.status.activeUsers}</span>
                  </div>
                ) : null}
                {typeof channel.status.lastMessageAt === "number" ? (
                  <div className="col-span-2">
                    last: <span className="text-white">{formatDate(channel.status.lastMessageAt)}</span>
                  </div>
                ) : null}
              </div>

              {typeof channel.status.qr === "string" ? (
                <div className="flex flex-col items-center gap-3 border-t border-chamber-wall pt-4">
                  <div className="bg-white p-4 rounded-lg">
                    <QRCodeSVG value={channel.status.qr} size={168} />
                  </div>
                  <div className="text-xs text-gray-400 text-center">
                    {channel.id === "whatsapp" ? "Scan in WhatsApp to connect." : "Scan to open Telegram bot."}
                    {typeof channel.status.selfUsername === "string" ? (
                      <div className="mt-1 text-gray-500">@{channel.status.selfUsername}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {typeof channel.status.message === "string" && channel.status.message.trim() ? (
                <details className="border-t border-chamber-wall pt-3">
                  <summary className="cursor-pointer text-xs text-gray-400">Details</summary>
                  <pre className="mt-2 text-xs text-gray-200 whitespace-pre-wrap break-words bg-chamber-dark/50 rounded p-3 border border-chamber-wall">
                    {channel.status.message}
                  </pre>
                </details>
              ) : null}

              {channel.id === "telegram" ? (
                <div className="border-t border-chamber-wall pt-3 flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    Pairing codes via <span className="font-mono text-white">/pair</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setTelegramModalOpen(true)}>
                    Pairing
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}

          {sorted.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center p-12 text-gray-500">
              <span className="text-4xl mb-4">🔇</span>
              <p>No active tunnels found</p>
            </div>
          ) : null}
        </div>
      </div>

      <Modal isOpen={telegramModalOpen} onClose={() => setTelegramModalOpen(false)} title="Telegram Pairing" size="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400">
              Approve pairing codes requested via <span className="font-mono text-white">/pair</span>.
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["telegramPairing"] })}
              loading={telegramQuery.isFetching}
            >
              Refresh
            </Button>
          </div>

          <div className="border border-chamber-wall rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-chamber-wall/30 text-xs text-gray-400">
              Pending Requests ({pairing?.requests?.length ?? 0})
            </div>
            <div className="p-3 space-y-3">
              {pairing?.requests?.length ? (
                pairing.requests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-white font-mono">{req.code}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {req.username ? `${req.username} · ` : ""}userId {req.userId}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(req.code)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={denyMutation.isPending}
                        onClick={() => denyMutation.mutate(req.code)}
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500">No pending requests.</div>
              )}
            </div>
          </div>

          <div className="border border-chamber-wall rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-chamber-wall/30 text-xs text-gray-400">
              Allowlist ({pairing?.allowFrom?.length ?? 0})
            </div>
            <div className="p-3 space-y-2">
              {pairing?.allowFrom?.length ? (
                pairing.allowFrom.map((entry) => (
                  <div key={entry} className="flex items-center justify-between gap-3">
                    <div className="text-sm text-white font-mono truncate">{entry}</div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={removeAllowMutation.isPending}
                      onClick={() => removeAllowMutation.mutate(entry)}
                    >
                      Remove
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500">No allowlist entries.</div>
              )}
            </div>
          </div>

          <Card>
            <div className="text-xs text-gray-500">
              Tip: approving a request adds the user to <span className="font-mono text-white">telegram.allowFrom</span>.
            </div>
          </Card>
        </div>
      </Modal>
    </div>
  );
};
