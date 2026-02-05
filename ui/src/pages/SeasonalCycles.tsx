/**
 * Seasonal Cycles
 * Scheduler / drone flights control plane
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, Card, Input, Modal, Skeleton } from "../components/base";
import { DataTable, JsonEditor, JsonPanel } from "../components/ops";
import {
  createJob,
  deleteJob,
  getJobsPage,
  runJob,
  toggleJob,
} from "../api/client";
import type { CronJob } from "../api/types";

function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  if (diff < 60_000) return "soon";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
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

type TriggerType = "agent_ask" | "tool_call" | "webhook";

type JobDraft = {
  name: string;
  schedule: string;
  triggerType: TriggerType;
  agentPrompt: string;
  toolName: string;
  toolArgsJson: string;
  webhookUrl: string;
  webhookMethod: "GET" | "POST" | "PUT";
  webhookHeadersJson: string;
  webhookBodyJson: string;
  actions: Array<
    | { type: "memory_update"; key?: string; tagsCsv?: string }
    | { type: "send_message"; channel: string; recipient: string }
    | { type: "log_event"; level: "info" | "warn" | "error"; prefix?: string }
  >;
};

const defaultDraft = (): JobDraft => ({
  name: "",
  schedule: "*/5 * * * *",
  triggerType: "agent_ask",
  agentPrompt: "",
  toolName: "memory_search",
  toolArgsJson: "{\n  \"query\": \"\"\n}",
  webhookUrl: "",
  webhookMethod: "POST",
  webhookHeadersJson: "{\n  \"Content-Type\": \"application/json\"\n}",
  webhookBodyJson: "{\n  \"hello\": \"world\"\n}",
  actions: [],
});

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const SeasonalCycles: React.FC = () => {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [enabled, setEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<JobDraft>(defaultDraft);
  const [selected, setSelected] = useState<CronJob | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["jobs", { limit, offset }],
    queryFn: () => getJobsPage({ limit, offset }),
    refetchInterval: 10_000,
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleJob(id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runJob(id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJob(id),
    onSuccess: async () => {
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trigger = (() => {
        if (draft.triggerType === "agent_ask") return { type: "agent_ask", data: { prompt: draft.agentPrompt } };
        if (draft.triggerType === "tool_call") {
          const parsed = tryParseJson(draft.toolArgsJson);
          if (!parsed.ok) throw new Error(`Invalid tool args JSON: ${parsed.error}`);
          return { type: "tool_call", data: { tool: draft.toolName, args: parsed.value } };
        }
        const headers = tryParseJson(draft.webhookHeadersJson);
        if (!headers.ok) throw new Error(`Invalid webhook headers JSON: ${headers.error}`);
        const body = tryParseJson(draft.webhookBodyJson);
        if (!body.ok) throw new Error(`Invalid webhook body JSON: ${body.error}`);
        if (!draft.webhookUrl.trim()) throw new Error("Webhook trigger requires a URL");
        return {
          type: "webhook",
          data: {
            url: draft.webhookUrl,
            method: draft.webhookMethod,
            headers: headers.value,
            body: body.value,
          },
        };
      })();

      const actions = draft.actions.map((a) => {
        if (a.type === "memory_update") {
          const tags = (a.tagsCsv ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          return { type: "memory_update", data: { type: "memory_update", key: a.key, tags } };
        }
        if (a.type === "send_message") {
          return {
            type: "send_message",
            data: { type: "send_message", channel: a.channel, recipient: a.recipient },
          };
        }
        return { type: "log_event", data: { type: "log_event", level: a.level, prefix: a.prefix } };
      });

      const res = await createJob({ name: draft.name, schedule: draft.schedule, trigger, actions });
      if (!res.ok) throw new Error(res.error || "Failed to create job");
      return res;
    },
    onSuccess: async () => {
      setDraft(defaultDraft());
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const jobs = (jobsQuery.data?.jobs ?? []) as CronJob[];
  const total = jobsQuery.data?.total ?? jobs.length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .filter((j) => (enabled === "all" ? true : enabled === "enabled" ? j.enabled : !j.enabled))
      .filter((j) => (q ? j.name.toLowerCase().includes(q) || j.id.toLowerCase().includes(q) : true));
  }, [enabled, jobs, search]);

  const columns = useMemo<Array<ColumnDef<CronJob>>>(
    () => [
      {
        header: "Status",
        accessorKey: "enabled",
        cell: (ctx) => (
          <Badge variant={ctx.row.original.enabled ? "drone" : "default"} dot pulse={ctx.row.original.enabled} size="sm">
            {ctx.row.original.enabled ? "enabled" : "paused"}
          </Badge>
        ),
      },
      {
        header: "Job",
        accessorKey: "name",
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="text-gray-100 truncate">{ctx.row.original.name}</div>
            <div className="text-[11px] text-gray-500 font-mono truncate">{ctx.row.original.id}</div>
          </div>
        ),
      },
      {
        header: "Schedule",
        accessorKey: "schedule",
        cell: (ctx) => <span className="text-xs font-mono text-gray-300">{ctx.row.original.schedule}</span>,
      },
      {
        header: "Last",
        accessorKey: "lastRunAt",
        cell: (ctx) => <span className="text-xs text-gray-400">{formatDate(ctx.row.original.lastRunAt)}</span>,
      },
      {
        header: "Next",
        accessorKey: "nextRunAt",
        cell: (ctx) => <span className="text-xs text-gray-400">{formatRelative(ctx.row.original.nextRunAt)}</span>,
      },
      {
        header: "Trigger",
        accessorKey: "trigger",
        cell: (ctx) => <span className="text-xs text-gray-400">{ctx.row.original.trigger?.type}</span>,
      },
    ],
    []
  );

  if (jobsQuery.isLoading) {
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
            <span className="text-3xl">🗓️</span>
            Seasonal Cycles
          </h1>
          <p className="text-sm text-gray-400">Scheduler / Drone Flights</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="drone">{total} jobs</Badge>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            + New Schedule
          </Button>
        </div>
      </header>

      <div className="p-4 border-b border-chamber-wall">
        <div className="grid grid-cols-8 gap-2 items-center">
          <Input
            placeholder="Search name or id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="col-span-3"
          />
          <select
            value={enabled}
            onChange={(e) => setEnabled(e.target.value as any)}
            className="col-span-1 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Paused</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            className="col-span-1 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          <div className="col-span-3 flex justify-end gap-2">
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
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DataTable
          data={filtered}
          columns={columns}
          onRowClick={(row) => setSelected(row)}
          empty={<div className="text-sm text-gray-500">No jobs.</div>}
        />
      </div>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New Schedule" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">Name</div>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Hourly Deep Maintenance" />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Cron schedule</div>
              <Input value={draft.schedule} onChange={(e) => setDraft((d) => ({ ...d, schedule: e.target.value }))} placeholder="0 * * * *" />
            </div>
          </div>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-white">Trigger</div>
                <div className="text-xs text-gray-500">What causes the flight to run.</div>
              </div>
              <select
                value={draft.triggerType}
                onChange={(e) => setDraft((d) => ({ ...d, triggerType: e.target.value as any }))}
                className="bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="agent_ask">agent_ask</option>
                <option value="tool_call">tool_call</option>
                <option value="webhook">webhook</option>
              </select>
            </div>

            <div className="mt-3">
              {draft.triggerType === "agent_ask" && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">Prompt</div>
                  <textarea
                    value={draft.agentPrompt}
                    onChange={(e) => setDraft((d) => ({ ...d, agentPrompt: e.target.value }))}
                    rows={6}
                    className="w-full bg-chamber-dark border border-chamber-wall rounded-lg p-3 text-sm text-white font-mono"
                    placeholder="Review logs, summarize errors, and store findings in memory."
                  />
                </div>
              )}

              {draft.triggerType === "tool_call" && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Tool name</div>
                    <Input value={draft.toolName} onChange={(e) => setDraft((d) => ({ ...d, toolName: e.target.value }))} />
                  </div>
                  <JsonEditor
                    title="Tool args (JSON)"
                    value={draft.toolArgsJson}
                    onChange={(v) => setDraft((d) => ({ ...d, toolArgsJson: v }))}
                    height={220}
                  />
                </div>
              )}

              {draft.triggerType === "webhook" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-3">
                      <div className="text-xs text-gray-400 mb-1">URL</div>
                      <Input value={draft.webhookUrl} onChange={(e) => setDraft((d) => ({ ...d, webhookUrl: e.target.value }))} placeholder="https://example.com/hook" />
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Method</div>
                      <select
                        value={draft.webhookMethod}
                        onChange={(e) => setDraft((d) => ({ ...d, webhookMethod: e.target.value as any }))}
                        className="w-full bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>
                  </div>
                  <JsonEditor
                    title="Headers (JSON)"
                    value={draft.webhookHeadersJson}
                    onChange={(v) => setDraft((d) => ({ ...d, webhookHeadersJson: v }))}
                    height={180}
                  />
                  <JsonEditor
                    title="Body (JSON)"
                    value={draft.webhookBodyJson}
                    onChange={(v) => setDraft((d) => ({ ...d, webhookBodyJson: v }))}
                    height={220}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-white">Actions</div>
                <div className="text-xs text-gray-500">What to do with the output.</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, { type: "memory_update" }] }))}
                >
                  + memory_update
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, { type: "send_message", channel: "whatsapp", recipient: "" }] }))}
                >
                  + send_message
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, { type: "log_event", level: "info" }] }))}
                >
                  + log_event
                </Button>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {draft.actions.length === 0 ? (
                <div className="text-sm text-gray-500">No actions.</div>
              ) : (
                draft.actions.map((a, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-chamber-wall bg-chamber-dark">
                    <div className="flex items-center justify-between">
                      <Badge variant="default">{a.type}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            actions: d.actions.filter((_, i) => i !== idx),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {a.type === "memory_update" && (
                        <>
                          <div className="col-span-1">
                            <div className="text-xs text-gray-400 mb-1">Key</div>
                            <Input
                              value={a.key ?? ""}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, key: e.target.value } : x)) as any,
                                }))
                              }
                              placeholder="weekly:rollup"
                            />
                          </div>
                          <div className="col-span-2">
                            <div className="text-xs text-gray-400 mb-1">Tags (comma)</div>
                            <Input
                              value={a.tagsCsv ?? ""}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, tagsCsv: e.target.value } : x)) as any,
                                }))
                              }
                              placeholder="maintenance, hourly"
                            />
                          </div>
                        </>
                      )}

                      {a.type === "send_message" && (
                        <>
                          <div>
                            <div className="text-xs text-gray-400 mb-1">Channel</div>
                            <select
                              value={a.channel}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, channel: e.target.value } : x)) as any,
                                }))
                              }
                              className="w-full bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                            >
                              <option value="whatsapp">whatsapp</option>
                              <option value="telegram">telegram</option>
                              <option value="cli">cli</option>
                              <option value="web">web</option>
                              <option value="discord">discord</option>
                            </select>
                          </div>
                          <div className="col-span-2">
                            <div className="text-xs text-gray-400 mb-1">Recipient</div>
                            <Input
                              value={a.recipient}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, recipient: e.target.value } : x)) as any,
                                }))
                              }
                              placeholder="123@s.whatsapp.net"
                            />
                          </div>
                        </>
                      )}

                      {a.type === "log_event" && (
                        <>
                          <div>
                            <div className="text-xs text-gray-400 mb-1">Level</div>
                            <select
                              value={a.level}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, level: e.target.value as any } : x)) as any,
                                }))
                              }
                              className="w-full bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                            >
                              <option value="info">info</option>
                              <option value="warn">warn</option>
                              <option value="error">error</option>
                            </select>
                          </div>
                          <div className="col-span-2">
                            <div className="text-xs text-gray-400 mb-1">Prefix</div>
                            <Input
                              value={a.prefix ?? ""}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  actions: d.actions.map((x, i) => (i === idx ? { ...a, prefix: e.target.value } : x)) as any,
                                }))
                              }
                              placeholder="weekly-deep-dive:"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={!draft.name.trim() || !draft.schedule.trim()}
            >
              Create Job
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Job · ${selected.name}` : "Job"}
        size="xl"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-gray-400">Next run</div>
                <div className="text-white font-semibold">{formatDate(selected.nextRunAt)} ({formatRelative(selected.nextRunAt)})</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => toggleMutation.mutate(selected.id)}
                  loading={toggleMutation.isPending}
                >
                  {selected.enabled ? "Pause" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runMutation.mutate(selected.id)}
                  loading={runMutation.isPending}
                >
                  Run now
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!confirm(`Delete job \"${selected.name}\"?`)) return;
                    deleteMutation.mutate(selected.id);
                  }}
                  loading={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>

            <JsonPanel title="Job JSON" endpoint="/api/jobs" value={selected} />
          </div>
        )}
      </Modal>
    </div>
  );
};
