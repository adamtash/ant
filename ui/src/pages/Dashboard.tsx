import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api/client";
import type { MainTaskStatus, QueueLaneSnapshot, StatusResponse, SubagentRecord } from "../api/types";
import Panel from "../components/Panel";
import SectionGrid from "../components/SectionGrid";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";

const formatDurationMs = (ms: number) => {
  const diff = Math.max(0, ms);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const formatDurationSince = (timestamp: number) => formatDurationMs(Date.now() - timestamp);

const formatTimestamp = (ts: number) => new Date(ts).toLocaleTimeString();

export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await apiGet<StatusResponse>("/status");
        if (active) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load status");
        }
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const providers = data?.runtime.providers ?? [];
  const running = data?.running ?? [];
  const lanes = data?.queue ?? [];
  const subagents = data?.subagents ?? [];

  const queueSummary = useMemo(() => {
    const queued = lanes.reduce((acc, lane) => acc + lane.queued, 0);
    const active = lanes.reduce((acc, lane) => acc + lane.active, 0);
    return { queued, active, lanes: lanes.length };
  }, [lanes]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">Runtime overview</h2>
          <p className="text-slate-400">Live snapshot of providers, queue health, and task flow.</p>
        </div>
        {error ? <StatusBadge label={error} tone="error" /> : <StatusBadge label="online" tone="good" />}
      </div>

      <SectionGrid>
        <StatCard label="Providers" value={providers.length} helper="Active model endpoints" />
        <StatCard
          label="Queue lanes"
          value={queueSummary.lanes}
          helper={`${queueSummary.active} active / ${queueSummary.queued} queued`}
        />
        <StatCard label="Running tasks" value={running.length} helper={running[0]?.text ?? "No active tasks"} />
      </SectionGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Providers" description="Resolved model routing for chat, tools, and background tasks.">
          <div className="grid gap-3">
            {providers.length === 0 && <p className="text-sm text-slate-400">No providers configured.</p>}
            {providers.map((provider) => (
              <div
                key={provider.label}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/50 bg-slate-900/50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{provider.label}</p>
                  <p className="text-xs text-slate-400">{provider.id}</p>
                </div>
                <div className="text-xs text-slate-400">
                  {provider.model} · {provider.type}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Queue lanes" description="Live concurrency slots and oldest wait time.">
          <div className="space-y-3">
            {lanes.length === 0 && <p className="text-sm text-slate-400">Queue is idle.</p>}
            {lanes.map((lane) => (
              <QueueLane key={lane.lane} lane={lane} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Main tasks" description="Active main agent tasks with durations.">
          <div className="space-y-3">
            {running.length === 0 && <p className="text-sm text-slate-400">No running tasks.</p>}
            {running.map((task) => (
              <MainTask key={task.sessionKey} task={task} />
            ))}
          </div>
        </Panel>
        <Panel title="Subagents" description="Latest subagent activity in the pool.">
          <div className="space-y-3">
            {subagents.length === 0 && <p className="text-sm text-slate-400">No subagent activity.</p>}
            {subagents.map((agent) => (
              <SubagentRow key={agent.id ?? agent.task} agent={agent} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function QueueLane({ lane }: { lane: QueueLaneSnapshot }) {
  const waitLabel = lane.oldestEnqueuedAt ? formatDurationSince(lane.oldestEnqueuedAt) : "idle";
  const tone = lane.oldestEnqueuedAt ? "warn" : "good";
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{lane.lane}</p>
          <p className="text-xs text-slate-400">
            {lane.active}/{lane.maxConcurrent} active · {lane.queued} queued
          </p>
        </div>
        <StatusBadge label={waitLabel} tone={tone} />
      </div>
    </div>
  );
}

function MainTask({ task }: { task: MainTaskStatus }) {
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{task.text}</p>
          <p className="text-xs text-slate-400">{formatTimestamp(task.startedAt)}</p>
        </div>
        <StatusBadge label={formatDurationSince(task.startedAt)} tone="warn" />
      </div>
    </div>
  );
}

function SubagentRow({ agent }: { agent: SubagentRecord }) {
  const startedAt = agent.startedAt ?? agent.createdAt;
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{agent.task}</p>
          <p className="text-xs text-slate-400">
            {agent.label ?? agent.status} · {formatTimestamp(startedAt)}
          </p>
        </div>
        <StatusBadge label={agent.status} tone={agent.status === "error" ? "error" : "good"} />
      </div>
    </div>
  );
}
