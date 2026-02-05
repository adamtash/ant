/**
 * War Room
 * Incidents + health (backend-transparent)
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, Card, Input, Modal, Skeleton } from "../components/base";
import { DataTable, JsonPanel } from "../components/ops";
import { getErrorStats, getHealth, getProviderHealth } from "../api/client";
import type { SystemEvent } from "../api/types";
import { useEventsStore } from "../state/eventsStore";
import { useSelectionStore } from "../state/selectionStore";

type Incident = SystemEvent;

function severityVariant(sev: Incident["severity"]): "soldier" | "queen" | "default" {
  if (sev === "critical" || sev === "error") return "soldier";
  if (sev === "warn") return "queen";
  return "default";
}

function extractMessage(ev: Incident): string {
  const data = ev.data as any;
  const msg =
    data?.message ??
    data?.error ??
    data?.msg ??
    data?.reason ??
    data?.details ??
    data?.stack ??
    null;
  if (typeof msg === "string") return msg;
  try {
    return JSON.stringify(msg ?? data ?? ev, null, 2);
  } catch {
    return String(msg ?? ev.type);
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const WarRoom: React.FC = () => {
  const events = useEventsStore((s) => s.events);
  const clearEvents = useEventsStore((s) => s.clear);
  const select = useSelectionStore((s) => s.select);

  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Incident["severity"] | "all">("all");
  const [rawOpen, setRawOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 5000,
  });
  const errorStatsQuery = useQuery({
    queryKey: ["errorStats"],
    queryFn: getErrorStats,
    refetchInterval: 5000,
  });
  const providerHealthQuery = useQuery({
    queryKey: ["providerHealth"],
    queryFn: getProviderHealth,
    refetchInterval: 10_000,
  });

  const incidents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = events
      .filter(
        (e) =>
          e.type === "error_occurred" ||
          e.severity === "error" ||
          e.severity === "critical" ||
          e.severity === "warn"
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    return base
      .filter((e) => (severity === "all" ? true : e.severity === severity))
      .filter((e) => {
        if (!q) return true;
        const msg = extractMessage(e).toLowerCase();
        return (
          msg.includes(q) ||
          e.type.toLowerCase().includes(q) ||
          (e.sessionKey ?? "").toLowerCase().includes(q) ||
          (e.channel ?? "").toLowerCase().includes(q) ||
          (e.source ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 500);
  }, [events, query, severity]);

  const lastHourSeries = useMemo(() => {
    const now = Date.now();
    const start = now - 60 * 60 * 1000;
    const buckets = new Map<string, { errors: number; warns: number }>();
    for (let i = 0; i < 60; i++) {
      const t = new Date(start + i * 60 * 1000);
      const label = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
      buckets.set(label, { errors: 0, warns: 0 });
    }

    for (const ev of events) {
      if (ev.timestamp < start) continue;
      const t = new Date(ev.timestamp);
      const label = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
      const bucket = buckets.get(label);
      if (!bucket) continue;
      if (ev.severity === "error" || ev.severity === "critical") bucket.errors += 1;
      if (ev.severity === "warn") bucket.warns += 1;
    }

    return Array.from(buckets.entries()).map(([time, v]) => ({ time, ...v }));
  }, [events]);

  const incidentsLast5m = useMemo(() => {
    const cut = Date.now() - 5 * 60 * 1000;
    return events.filter(
      (e) =>
        e.timestamp >= cut && (e.severity === "error" || e.severity === "critical")
    ).length;
  }, [events]);

  const totalErrors =
    typeof (healthQuery.data as any)?.health?.totalErrors === "number"
      ? (healthQuery.data as any).health.totalErrors
      : (errorStatsQuery.data as any)?.stats?.totalErrors ?? 0;
  const errorRate =
    typeof (healthQuery.data as any)?.health?.errorRate === "number"
      ? (healthQuery.data as any).health.errorRate
      : (errorStatsQuery.data as any)?.stats?.errorRate ?? 0;

  const threatLevel = (() => {
    if (incidentsLast5m >= 6 || errorRate >= 6) return "critical";
    if (incidentsLast5m >= 3 || errorRate >= 3) return "high";
    if (incidentsLast5m >= 1 || errorRate >= 1) return "elevated";
    return "normal";
  })();

  const columns = useMemo<Array<ColumnDef<Incident>>>(
    () => [
      {
        header: "When",
        accessorKey: "timestamp",
        cell: (ctx) => (
          <span className="text-xs text-gray-400">
            {formatTime(ctx.row.original.timestamp)}
          </span>
        ),
      },
      {
        header: "Severity",
        accessorKey: "severity",
        cell: (ctx) => (
          <Badge
            variant={severityVariant(ctx.row.original.severity)}
            size="sm"
            dot
            pulse={ctx.row.original.severity !== "info"}
          >
            {ctx.row.original.severity}
          </Badge>
        ),
      },
      {
        header: "Type",
        accessorKey: "type",
        cell: (ctx) => (
          <span className="text-xs font-mono text-gray-300">
            {ctx.row.original.type}
          </span>
        ),
      },
      {
        header: "Message",
        accessorKey: "data",
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="truncate text-gray-100">
              {extractMessage(ctx.row.original)}
            </div>
            {(ctx.row.original.sessionKey || ctx.row.original.channel) && (
              <div className="mt-0.5 text-[11px] text-gray-500 font-mono truncate">
                {(ctx.row.original.sessionKey ?? "").slice(0, 48)}
                {ctx.row.original.channel ? ` · ${ctx.row.original.channel}` : ""}
              </div>
            )}
          </div>
        ),
      },
      {
        header: "Source",
        accessorKey: "source",
        cell: (ctx) => (
          <span className="text-xs text-gray-400">{ctx.row.original.source}</span>
        ),
      },
    ],
    []
  );

  if (providerHealthQuery.isLoading && events.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={120} />
        <Skeleton variant="rectangular" height={420} />
      </div>
    );
  }

  const providerSummary = (providerHealthQuery.data as any)?.summary as any;
  const providers = ((providerHealthQuery.data as any)?.providers ?? []) as any[];

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🛡️</span>
            War Room
          </h1>
          <p className="text-sm text-gray-400">
            Incidents, Error Rate, Provider Defense
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={threatLevel === "normal" ? "nurse" : "soldier"}
            dot
            pulse={threatLevel !== "normal"}
          >
            Threat: {threatLevel}
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => setRawOpen(true)}>
            Transparency
          </Button>
          <Button variant="ghost" size="sm" onClick={clearEvents}>
            Clear feed
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <div className="text-sm text-gray-400">Incidents (5m)</div>
            <div className="mt-1 text-3xl font-bold text-white">{incidentsLast5m}</div>
            <div className="mt-2 text-xs text-gray-500">from realtime events</div>
          </Card>
          <Card>
            <div className="text-sm text-gray-400">Error rate</div>
            <div className="mt-1 text-3xl font-bold text-white">{errorRate}/m</div>
            <div className="mt-2 text-xs text-gray-500">
              from `/api/health` / `/api/errors/stats`
            </div>
          </Card>
          <Card>
            <div className="text-sm text-gray-400">Total errors</div>
            <div className="mt-1 text-3xl font-bold text-white">{totalErrors}</div>
            <div className="mt-2 text-xs text-gray-500">gateway counter</div>
          </Card>
          <Card>
            <div className="text-sm text-gray-400">Providers</div>
            <div className="mt-1 text-3xl font-bold text-white">
              {providerSummary?.healthy ?? 0}/{providerSummary?.total ?? providers.length}
            </div>
            <div className="mt-2 text-xs text-gray-500">healthy / total</div>
          </Card>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 space-y-3">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Incident Feed</div>
                  <div className="text-xs text-gray-500">
                    Click a row to open the inspector.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search message, type, sessionKey…"
                    className="w-72"
                  />
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="all">All severities</option>
                    <option value="critical">critical</option>
                    <option value="error">error</option>
                    <option value="warn">warn</option>
                    <option value="info">info</option>
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <DataTable
                  data={incidents}
                  columns={columns}
                  dense
                  onRowClick={(row) => select({ type: "error", id: row.id })}
                  empty={<div className="text-sm text-gray-500">No incidents captured yet.</div>}
                />
              </div>
            </Card>

            <Card>
              <div className="text-lg font-semibold text-white mb-2">
                Error/Warn rate (last hour)
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={lastHourSeries}
                    margin={{ left: 6, right: 6, top: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94A3B8" }} interval={9} />
                    <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} allowDecimals={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="warns"
                      stroke="#F59E0B"
                      fill="#F59E0B"
                      fillOpacity={0.25}
                    />
                    <Area
                      type="monotone"
                      dataKey="errors"
                      stroke="#EF4444"
                      fill="#EF4444"
                      fillOpacity={0.25}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="col-span-4 space-y-4">
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-white">Provider Health</div>
                <Badge variant="default">{providers.length}</Badge>
              </div>
              <div className="mt-3 space-y-2">
                {providers.length === 0 ? (
                  <div className="text-sm text-gray-500">No providers.</div>
                ) : (
                  providers.slice(0, 8).map((p) => (
                    <div
                      key={p.id}
                      className="p-2 rounded-lg border border-chamber-wall bg-chamber-dark"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-white truncate">{p.name ?? p.id}</div>
                          <div className="text-[11px] text-gray-500 font-mono truncate">{p.model}</div>
                        </div>
                        <Badge
                          variant={
                            p.status === "healthy"
                              ? "nurse"
                              : p.status === "cooldown"
                                ? "architect"
                                : p.status === "degraded"
                                  ? "queen"
                                  : "soldier"
                          }
                          size="sm"
                          dot
                          pulse={p.status !== "healthy"}
                        >
                          {p.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400 flex items-center gap-3">
                        <span>req {p.stats?.requestCount ?? 0}</span>
                        <span>err {Math.round(p.stats?.errorRate ?? 0)}%</span>
                        {p.cooldown?.until ? <span>cooldown {formatTime(p.cooldown.until)}</span> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="text-lg font-semibold text-white">Defense Notes</div>
              <div className="mt-2 text-sm text-gray-400 space-y-1">
                <div>- Incidents are live events (no reconstruction).</div>
                <div>- Click any incident to inspect raw payload + classify.</div>
                <div>- Provider cooldowns come from `/api/providers/health`.</div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Modal isOpen={rawOpen} onClose={() => setRawOpen(false)} title="Transparency" size="xl">
        <div className="grid grid-cols-2 gap-4">
          <JsonPanel
            title="Errors stats"
            endpoint="/api/errors/stats"
            value={errorStatsQuery.data ?? { loading: true }}
          />
          <JsonPanel title="Health" endpoint="/api/health" value={healthQuery.data ?? { loading: true }} />
          <div className="col-span-2">
            <JsonPanel
              title="Provider health"
              endpoint="/api/providers/health"
              value={providerHealthQuery.data ?? { loading: true }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

