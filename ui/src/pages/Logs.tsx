import { useEffect, useMemo, useState } from "react";
import { apiGet, openLogStream } from "../api/client";
import type { LogsResponse } from "../api/types";
import Panel from "../components/Panel";
import StatusBadge from "../components/StatusBadge";

const MAX_LINES = 500;

export default function Logs() {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<string>("connecting");

  useEffect(() => {
    let active = true;
    apiGet<LogsResponse>("/logs?lines=200")
      .then((data) => {
        if (active) setLines(data.lines);
      })
      .catch(() => {
        if (active) setStatus("failed to load initial logs");
      });

    const source = openLogStream((line) => {
      if (paused) return;
      setLines((current) => [...current, line].slice(-MAX_LINES));
      setStatus("streaming");
    });

    source.onerror = () => {
      setStatus("reconnecting");
    };

    return () => {
      active = false;
      source.close();
    };
  }, [paused]);

  const visibleLines = useMemo(() => {
    if (!filter.trim()) return lines;
    const term = filter.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(term));
  }, [lines, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">Logs</h2>
          <p className="text-slate-400">SSE tail of runtime log output.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            label={status}
            tone={status === "streaming" ? "good" : status.includes("fail") ? "error" : "warn"}
          />
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-sm"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-sm"
            onClick={() => setLines([])}
          >
            Clear
          </button>
        </div>
      </div>

      <Panel title="Log stream" description="Live updates, filterable, max 500 lines.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter logs"
            className="w-full rounded-xl border border-slate-800/60 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
          />
        </div>
        <div className="mt-4 max-h-[520px] overflow-y-auto rounded-xl border border-slate-800/60 bg-black/60 p-4 text-xs text-slate-200">
          {visibleLines.length === 0 ? (
            <p className="text-slate-500">No log lines yet.</p>
          ) : (
            <pre className="whitespace-pre-wrap leading-5">
              {visibleLines.map((line, idx) => (
                <div key={`${line}-${idx}`} className="border-b border-slate-800/40 py-1">
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      </Panel>
    </div>
  );
}
