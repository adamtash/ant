/**
 * Pheromone Trails
 * Sessions explorer (pageable + export + delete)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Virtuoso } from "react-virtuoso";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input, Skeleton, Tabs, TabPanel } from "../components/base";
import { DataTable, JsonPanel, ToolChain } from "../components/ops";
import { deleteSession, getSession, getSessionToolParts, getSessionsPage } from "../api/client";
import type { Session, SessionMessage } from "../api/types";

function channelIcon(channel: Session["channel"]): string {
  switch (channel) {
    case "whatsapp":
      return "📱";
    case "telegram":
      return "✈️";
    case "cli":
      return "💻";
    case "web":
      return "🌐";
    default:
      return "💬";
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function roleVariant(role: SessionMessage["role"]): "queen" | "nurse" | "architect" | "default" {
  if (role === "user") return "queen";
  if (role === "assistant") return "nurse";
  if (role === "tool") return "architect";
  return "default";
}

export const PheromonTrails: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<Session["channel"] | "all">("all");
  const [activeTab, setActiveTab] = useState("messages");

  const selectedFromUrl = searchParams.get("session");
  const [selectedKey, setSelectedKey] = useState<string | null>(selectedFromUrl);
  const selectedKeyRef = useRef<string | null>(selectedKey);
  selectedKeyRef.current = selectedKey;

  useEffect(() => {
    const next = searchParams.get("session");
    setSelectedKey(next);
  }, [searchParams]);

  const sessionsQuery = useQuery({
    queryKey: ["sessions", { limit, offset }],
    queryFn: () => getSessionsPage({ limit, offset }),
    refetchInterval: 10_000,
  });

  const sessionQuery = useQuery({
    queryKey: ["session", selectedKey ?? ""],
    queryFn: () => getSession(selectedKey!),
    enabled: Boolean(selectedKey),
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => deleteSession(key),
    onSuccess: async () => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("session");
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const sessions = (sessionsQuery.data?.sessions ?? []) as Session[];
  const total = sessionsQuery.data?.total ?? sessions.length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions
      .filter((s) => (channel === "all" ? true : s.channel === channel))
      .filter((s) => (q ? s.key.toLowerCase().includes(q) : true))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [channel, search, sessions]);

  const columns = useMemo<Array<ColumnDef<Session>>>(
    () => [
      {
        header: "Channel",
        accessorKey: "channel",
        cell: (ctx) => (
          <div className="flex items-center gap-2">
            <span>{channelIcon(ctx.row.original.channel)}</span>
            <span className="text-xs text-gray-400">{ctx.row.original.channel}</span>
          </div>
        ),
      },
      {
        header: "Session",
        accessorKey: "key",
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="text-gray-100 truncate">{ctx.row.original.key}</div>
            <div className="text-[11px] text-gray-500">
              {ctx.row.original.messageCount} msgs · last {formatDate(ctx.row.original.lastMessageAt)}
            </div>
          </div>
        ),
      },
    ],
    []
  );

  const messages = (sessionQuery.data?.messages ?? []) as SessionMessage[];

  const selectedSessionMeta = useMemo(() => {
    if (!selectedKey) return null;
    return filtered.find((s) => s.key === selectedKey) ?? sessions.find((s) => s.key === selectedKey) ?? null;
  }, [filtered, selectedKey, sessions]);

  if (sessionsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={100} />
        <Skeleton variant="rectangular" height={420} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">✨</span>
            Pheromone Trails
          </h1>
          <p className="text-sm text-gray-400">Sessions (history + tool traces)</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default">{total} sessions</Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sessions"] })}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize="34%" minSize="24%" className="h-full">
            <div className="h-full flex flex-col border-r border-chamber-wall">
              <div className="p-4 border-b border-chamber-wall space-y-2">
                <Input
                  placeholder="Search sessionKey…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as any)}
                    className="col-span-2 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="all">All</option>
                    <option value="whatsapp">whatsapp</option>
                    <option value="telegram">telegram</option>
                    <option value="cli">cli</option>
                    <option value="web">web</option>
                    <option value="discord">discord</option>
                  </select>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                    className="bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                    disabled={offset === 0}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOffset((o) => (o + limit < total ? o + limit : o))}
                    disabled={offset + limit >= total}
                  >
                    Next
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <DataTable
                  data={filtered}
                  columns={columns}
                  dense
                  onRowClick={(row) => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("session", row.key);
                      return next;
                    });
                    setActiveTab("messages");
                  }}
                  empty={<div className="text-sm text-gray-500">No sessions.</div>}
                />
              </div>
            </div>
          </Panel>

          <Separator className="w-1 bg-chamber-wall/60 hover:bg-queen-amber/50 transition-colors" />

          <Panel minSize="40%" className="h-full">
            <div className="h-full flex flex-col">
              {!selectedKey ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl">🐜</div>
                    <div className="mt-3 text-lg font-semibold text-white">Select a session</div>
                    <div className="mt-1 text-sm text-gray-500">Tip: open from Task Detail or Nursery.</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-4 border-b border-chamber-wall flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-500">Session</div>
                      <div className="text-white font-semibold truncate">{selectedKey}</div>
                      {selectedSessionMeta && (
                        <div className="mt-1 text-xs text-gray-500">
                          {channelIcon(selectedSessionMeta.channel)} {selectedSessionMeta.channel} ·{" "}
                          {selectedSessionMeta.messageCount} msgs · last {formatDate(selectedSessionMeta.lastMessageAt)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(selectedKey);
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        Copy key
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          const key = selectedKeyRef.current;
                          if (!key) return;
                          const [session, toolParts] = await Promise.all([
                            getSession(key),
                            getSessionToolParts(key),
                          ]);
                          downloadJson(`${key.replaceAll(":", "_")}.json`, { session, toolParts });
                        }}
                      >
                        Export
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!confirm(`Delete session \"${selectedKey}\"?`)) return;
                          deleteMutation.mutate(selectedKey);
                        }}
                        loading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="px-4 pt-4">
                    <Tabs
                      tabs={[
                        { id: "messages", label: "Messages", icon: <span>💬</span> },
                        { id: "tools", label: "Tool Chain", icon: <span>🔧</span> },
                        { id: "raw", label: "Raw JSON", icon: <span>📄</span> },
                      ]}
                      activeTab={activeTab}
                      onChange={setActiveTab}
                      variant="pills"
                    />
                  </div>

                  <div className="flex-1 overflow-hidden p-4">
                    <TabPanel tabId="messages" activeTab={activeTab}>
                      {sessionQuery.isLoading ? (
                        <Skeleton variant="rectangular" height={200} />
                      ) : (
                        <Card className="h-[calc(100vh-220px)] overflow-hidden">
                          <Virtuoso
                            style={{ height: "100%" }}
                            data={messages}
                            followOutput="smooth"
                            itemContent={(index, msg) => (
                              <div key={index} className="py-2 border-b border-chamber-wall/40">
                                <div className="flex items-center gap-2">
                                  <Badge variant={roleVariant(msg.role)} size="sm">
                                    {msg.role}
                                  </Badge>
                                  <span className="text-xs text-gray-500">{formatDate(msg.ts)}</span>
                                  {msg.model && (
                                    <Badge variant="default" size="sm" className="ml-auto">
                                      {msg.providerId ? `${msg.providerId}: ` : ""}
                                      {msg.model}
                                    </Badge>
                                  )}
                                </div>
                                <pre className="mt-2 text-xs text-gray-200 whitespace-pre-wrap break-words bg-chamber-dark/60 rounded-lg p-3 border border-chamber-wall">
                                  {msg.content}
                                </pre>
                              </div>
                            )}
                          />
                        </Card>
                      )}
                    </TabPanel>

                    <TabPanel tabId="tools" activeTab={activeTab}>
                      <Card>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg font-semibold text-white">Tool Chain</h3>
                          <Badge variant="default">/api/sessions/:key/tool-parts</Badge>
                        </div>
                        <ToolChain sessionKey={selectedKey} />
                      </Card>
                    </TabPanel>

                    <TabPanel tabId="raw" activeTab={activeTab}>
                      <JsonPanel
                        title="Session JSON"
                        endpoint={`/api/sessions/${encodeURIComponent(selectedKey)}`}
                        value={sessionQuery.data ?? { loading: true }}
                      />
                    </TabPanel>
                  </div>
                </>
              )}
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
};
