import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import type {
  ActionResponse,
  QueueDetailResponse,
  QueueDetailSnapshot,
  QueueItemSnapshot,
  QueueLaneSnapshot,
  StatusResponse,
  SubagentRecord,
} from "../api/types";
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

const workerNames = [
  "Moss Forager",
  "Clay Architect",
  "Sand Sentinel",
  "Leaf Weaver",
  "Tunnel Scout",
  "Root Tender",
  "Dune Runner",
  "Pebble Carrier",
  "Thatch Keeper",
  "Dusk Ranger",
  "River Guard",
  "Amber Mender",
];

const queenTitles = ["Amber Chamber", "Crimson Vault", "Silt Throne", "Moss Hollow", "Ochre Nest", "Cedar Keep"];

const workingTitles = [
  "Basalt Runner",
  "Grove Courier",
  "Sienna Scout",
  "Tide Watcher",
  "Umber Weaver",
  "Cinder Carrier",
  "Pollen Ranger",
  "Sable Miner",
];

const workerSlots = [
  { id: "nw", className: "left-[8%] top-[10%] colony-wiggle" },
  { id: "ne", className: "right-[10%] top-[12%] colony-wiggle-slow" },
  { id: "w", className: "left-[4%] top-[44%] colony-slower" },
  { id: "e", className: "right-[6%] top-[52%] colony-slowest" },
  { id: "sw", className: "left-[12%] bottom-[10%] colony-wiggle-fast" },
  { id: "se", className: "right-[12%] bottom-[12%] colony-wiggle" },
];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const stableWorkerName = (agent: SubagentRecord) => {
  const key = agent.id ?? agent.task;
  const hash = hashString(key);
  return workerNames[hash % workerNames.length];
};

const pickQueenTitle = () => queenTitles[Math.floor(Math.random() * queenTitles.length)] ?? "Amber Chamber";
const pickWorkingTitle = () =>
  workingTitles[Math.floor(Math.random() * workingTitles.length)] ?? "Basalt Runner";
const pickIdleTitle = () => {
  const titles = [...workerNames, ...workingTitles];
  return titles[Math.floor(Math.random() * titles.length)] ?? "Moss Forager";
};

const laneLabel = (lane: string) => {
  if (lane === "main") return "Main";
  if (lane === "ui:default") return "UI";
  return lane || "Main";
};

const trimmedText = (value: string, max = 120) => {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
};

export default function Colony() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [detail, setDetail] = useState<QueueDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ label: string; tone?: "good" | "warn" | "error" } | null>(
    null,
  );
  const [queenTitle] = useState(pickQueenTitle);
  const [workingTitle] = useState(pickWorkingTitle);
  const [idleTitle] = useState(pickIdleTitle);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await apiGet<StatusResponse>("/status");
        if (active) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load status");
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await apiGet<QueueDetailResponse>("/queue/detail");
        if (active) setDetail(next);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load queue detail");
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const lanes = status?.queue ?? [];
  const running = status?.running ?? [];
  const subagents = status?.subagents ?? [];
  const detailLanes = detail?.lanes ?? [];

  const queueSummary = useMemo(() => {
    const queued = lanes.reduce((acc, lane) => acc + lane.queued, 0);
    const active = lanes.reduce((acc, lane) => acc + lane.active, 0);
    return { queued, active, lanes: lanes.length };
  }, [lanes]);

  const laneLookup = useMemo(() => {
    const map = new Map<string, QueueLaneSnapshot>();
    for (const lane of lanes) map.set(lane.lane, lane);
    return map;
  }, [lanes]);

  const queenTask = running[0];
  const queenFocus = queenTask ? trimmedText(queenTask.text, 110) : "Queen at rest";
  const queenFocusDetail = queenTask
    ? `Working for ${formatDurationSince(queenTask.startedAt)}`
    : `Idle in ${idleTitle}`;
  const workingAgentLabel = queenTask ? workingTitle : idleTitle;

  const handleAction = async (label: string, path: string) => {
    setActionState({ label: `${label}...`, tone: "warn" });
    try {
      const response = await apiPost<ActionResponse>(path);
      if (response.ok) {
        setActionState({ label: `${label} triggered`, tone: "good" });
      } else {
        setActionState({ label: response.error ?? `${label} failed`, tone: "error" });
      }
    } catch (err) {
      setActionState({
        label: err instanceof Error ? err.message : `${label} failed`,
        tone: "error",
      });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">Colony</h2>
          <p className="text-slate-400">Ant-habitat view of the queen, workers, and queue lanes.</p>
        </div>
        <div className="flex items-center gap-2">
          {error ? <StatusBadge label={error} tone="error" /> : <StatusBadge label="live" tone="good" />}
          {actionState && <StatusBadge label={actionState.label} tone={actionState.tone} />}
        </div>
      </div>

      <SectionGrid>
        <StatCard
          label="Queue lanes"
          value={queueSummary.lanes}
          helper={`${queueSummary.active} active · ${queueSummary.queued} queued`}
        />
        <StatCard label="Queen" value={queenTask ? "working" : "resting"} helper={queenFocus} />
        <StatCard
          label="Working agent"
          value={workingAgentLabel}
          helper={queenTask ? "Assigned to current task" : "On standby"}
        />
        <StatCard
          label="Workers"
          value={subagents.length}
          helper={subagents.length ? "Active subagent pool" : "No subagents active"}
        />
      </SectionGrid>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Panel title="Colony map" description="Queen chamber centered; workers orbit along tunnels.">
          <ColonyMap
            queenFocus={queenFocus}
            queenDetail={queenFocusDetail}
            queenTitle={queenTitle}
            workingAgentLabel={workingAgentLabel}
            subagents={subagents}
          />
        </Panel>

        <Panel title="Colony controls" description="Trigger runtime lifecycle hooks.">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full border border-slate-700/60 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => handleAction("Start", "/start")}
              >
                Start
              </button>
              <button
                className="rounded-full border border-slate-700/60 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => handleAction("Stop", "/stop")}
              >
                Stop
              </button>
              <button
                className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => handleAction("Restart", "/restart")}
              >
                Restart
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Start uses the runtime.start hook; restart uses runtime.restart. Stop exits the process.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Queue lanes" description="Aggregated lane counts and oldest wait time.">
          <div className="space-y-3">
            {lanes.length === 0 && <p className="text-sm text-slate-400">Queue is idle.</p>}
            {lanes.map((lane) => (
              <QueueLane key={lane.lane} lane={lane} />
            ))}
          </div>
        </Panel>

        <Panel title="Queued messages" description="Per-lane queue detail and wait times.">
          <div className="space-y-3">
            {detailLanes.length === 0 && <p className="text-sm text-slate-400">No queued items.</p>}
            {detailLanes.map((lane) => (
              <QueueLaneDetail key={lane.lane} lane={lane} summary={laneLookup.get(lane.lane)} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ColonyMap({
  queenFocus,
  queenDetail,
  queenTitle,
  workingAgentLabel,
  subagents,
}: {
  queenFocus: string;
  queenDetail: string;
  queenTitle: string;
  workingAgentLabel: string;
  subagents: SubagentRecord[];
}) {
  const activeWorkers = subagents.length > 0;
  const signalLabel = activeWorkers ? "busy" : "quiet";
  const orbitClass = activeWorkers ? "colony-queen" : "colony-queen colony-slower";
  const tunnelLabel = activeWorkers ? "Six active routes" : "Dormant routes";
  const chamberLabel = `Queen chamber · ${queenTitle.toLowerCase()}`;
  const patrolLabel = `${workingAgentLabel.toLowerCase()} patrol`;
  const signalText = `Queue lanes: ${signalLabel}`;
  const orbitTone = activeWorkers ? "bg-amber-500/15" : "bg-amber-500/10";
  const workerAccent = activeWorkers ? "text-amber-200/80" : "text-slate-500";

  const workers = subagents.slice(0, workerSlots.length).map((agent, index) => ({
    ...agent,
    slot: workerSlots[index],
    name: stableWorkerName(agent),
  }));
  const emptySlots = workerSlots.slice(workers.length);

  return (
    <div className="relative h-[360px] overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-950 p-6">
      <svg viewBox="0 0 400 240" className="colony-branch">
        <line x1="200" y1="120" x2="80" y2="40" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
        <line x1="200" y1="120" x2="320" y2="45" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
        <line x1="200" y1="120" x2="40" y2="130" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
        <line x1="200" y1="120" x2="360" y2="140" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
        <line x1="200" y1="120" x2="90" y2="210" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
        <line x1="200" y1="120" x2="315" y2="210" className="colony-tunnel" stroke="#a16207" strokeWidth="2" />
      </svg>

      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <div
          className={`${orbitClass} flex h-28 w-28 items-center justify-center rounded-full border border-amber-500/40 ${orbitTone} text-center shadow-lg shadow-amber-500/10`}
        >
          <div>
            <p className="text-sm font-semibold text-amber-200">Queen</p>
            <p className="text-xs text-amber-100/80">{queenTitle}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-white">{queenFocus}</p>
          <p className="text-xs text-slate-400">{queenDetail}</p>
          <p className={`mt-1 text-xs ${workerAccent}`}>Working agent: {workingAgentLabel}</p>
        </div>
      </div>

      <div className="absolute left-10 top-6 rounded-full border border-slate-800/70 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
        {chamberLabel}
      </div>
      <div className="absolute right-10 bottom-6 rounded-full border border-slate-800/70 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
        {patrolLabel}
      </div>

      <div className="absolute left-8 bottom-12 flex flex-col gap-1 rounded-2xl border border-slate-800/70 bg-slate-900/70 p-3 text-xs text-slate-300">
        <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Tunnels</span>
        <span>{tunnelLabel}</span>
      </div>

      <div className="absolute right-12 top-12 flex flex-col gap-1 rounded-2xl border border-slate-800/70 bg-slate-900/70 p-3 text-xs text-slate-300">
        <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Signals</span>
        <span>{signalText}</span>
      </div>

      <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-500/20" />
      <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-500/10" />

      {workers.map((agent) => (
        <div key={agent.id ?? agent.task} className={`absolute ${agent.slot.className} colony-worker`}>
          <div className="flex w-40 flex-col gap-1 rounded-2xl border border-slate-800/70 bg-slate-900/80 p-3 shadow-lg shadow-slate-950/40">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">{agent.name}</p>
            <p className="text-sm font-semibold text-white line-clamp-1">{agent.task}</p>
            <p className="text-xs text-slate-400">{agent.label ?? agent.status}</p>
          </div>
        </div>
      ))}

      {emptySlots.map((slot) => (
        <div key={slot.id} className={`absolute ${slot.className} colony-worker opacity-50`}>
          <div className="flex w-40 flex-col gap-1 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Idle tunnel</p>
            <p className="text-sm font-semibold text-slate-300">Awaiting worker</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function QueueLane({ lane }: { lane: QueueLaneSnapshot }) {
  const waitLabel = lane.oldestEnqueuedAt ? formatDurationSince(lane.oldestEnqueuedAt) : "idle";
  const tone = lane.oldestEnqueuedAt ? "warn" : "good";
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{laneLabel(lane.lane)}</p>
          <p className="text-xs text-slate-400">
            {lane.active}/{lane.maxConcurrent} active · {lane.queued} queued
          </p>
        </div>
        <StatusBadge label={waitLabel} tone={tone} />
      </div>
    </div>
  );
}

function QueueLaneDetail({ lane, summary }: { lane: QueueDetailSnapshot; summary?: QueueLaneSnapshot }) {
  const queuedCount = summary?.queued ?? lane.items.length;
  return (
    <details className="rounded-xl border border-slate-800/60 bg-slate-900/70 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{laneLabel(lane.lane)}</p>
          <p className="text-xs text-slate-400">{queuedCount} queued</p>
        </div>
        <span className="text-xs text-slate-400">{summary?.active ?? 0} active</span>
      </summary>
      <div className="mt-3 space-y-2">
        {lane.items.length === 0 ? (
          <p className="text-xs text-slate-400">No queued items.</p>
        ) : (
          lane.items.map((item, index) => <QueueItem key={`${lane.lane}-${item.enqueuedAt}-${index}`} item={item} />)
        )}
      </div>
    </details>
  );
}

function QueueItem({ item }: { item: QueueItemSnapshot }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{trimmedText(item.text) || "(empty message)"}</p>
          <p className="text-xs text-slate-500">Lane {laneLabel(item.lane)}</p>
        </div>
        <span className="text-xs text-slate-400">{formatDurationSince(item.enqueuedAt)}</span>
      </div>
    </div>
  );
}
