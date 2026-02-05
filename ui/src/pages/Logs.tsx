/**
 * Colony Logs
 * Initial history via `/api/logs` + live tail via SSE `/api/logs/stream`
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Input, Skeleton } from "../components/base";
import { getLogsPage, openLogStream } from "../api/client";

type LogLevel = "debug" | "info" | "warn" | "error" | "unknown";

type LogRow = {
  raw: string;
  ts: number | null;
  level: LogLevel;
  msg: string;
  details: Record<string, unknown> | null;
};

function parseLogLine(raw: string): LogRow {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return { raw, ts: null, level: "unknown", msg: raw, details: null };
  }

  try {
    const obj = JSON.parse(trimmed) as any;
    const ts = typeof obj.time === "number" ? obj.time : typeof obj.timestamp === "number" ? obj.timestamp : null;
    const levelNum = typeof obj.level === "number" ? obj.level : null;
    const level: LogLevel =
      levelNum === null
        ? "unknown"
        : levelNum >= 50
          ? "error"
          : levelNum >= 40
            ? "warn"
            : levelNum >= 30
              ? "info"
              : "debug";
    const msg = typeof obj.msg === "string" ? obj.msg : typeof obj.message === "string" ? obj.message : raw;
    const { time: _time, timestamp: _timestamp, level: _level, msg: _msg, message: _message, ...rest } = obj;
    const details = Object.keys(rest).length ? (rest as Record<string, unknown>) : null;
    return { raw, ts, level, msg, details };
  } catch {
    return { raw, ts: null, level: "unknown", msg: raw, details: null };
  }
}

function levelVariant(level: LogLevel): "soldier" | "queen" | "nurse" | "default" {
  if (level === "error") return "soldier";
  if (level === "warn") return "queen";
  if (level === "info") return "nurse";
  return "default";
}

export const Logs: React.FC = () => {
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyLimit = 100;

  const seenTailRef = useRef<string[]>([]);

  const historyQuery = useQuery({
    queryKey: ["logs", { limit: historyLimit, offset: historyOffset }],
    queryFn: () => getLogsPage({ limit: historyLimit, offset: historyOffset }),
  });

  const total = historyQuery.data?.total ?? 0;

  useEffect(() => {
    if (!historyQuery.data?.data) return;
    const chunk = [...historyQuery.data.data].reverse().map(parseLogLine);
    setRows((prev) => {
      if (historyOffset === 0) return chunk;
      return [...chunk, ...prev];
    });
  }, [historyOffset, historyQuery.data?.data]);

  useEffect(() => {
    const source = openLogStream((line) => {
      if (paused) return;

      const recent = seenTailRef.current;
      if (recent.includes(line)) return;
      recent.push(line);
      if (recent.length > 200) recent.splice(0, recent.length - 200);

      setRows((prev) => [...prev, parseLogLine(line)].slice(-5000));
    });

    return () => source.close();
  }, [paused]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (level !== "all" && r.level !== level) return false;
      if (!q) return true;
      if (r.raw.toLowerCase().includes(q)) return true;
      if (r.msg.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [level, rows, search]);

  if (historyQuery.isLoading && rows.length === 0) {
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
            <span className="text-3xl">📜</span>
            Colony Logs
          </h1>
          <p className="text-sm text-gray-400">Gateway logs (history + live tail)</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default">{filtered.length} lines</Badge>
          <Button variant="secondary" size="sm" onClick={() => setRows([])}>
            Clear
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPaused((v) => !v)}>
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </header>

      <div className="p-4 border-b border-chamber-wall">
        <div className="grid grid-cols-12 gap-2 items-center">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="col-span-5"
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as any)}
            className="col-span-2 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All levels</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
            <option value="unknown">unknown</option>
          </select>
          <div className="col-span-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAutoScroll((v) => !v)}
            >
              Auto-scroll: {autoScroll ? "on" : "off"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setHistoryOffset((o) => o + historyLimit)}
              disabled={historyOffset + historyLimit >= total}
              loading={historyQuery.isFetching}
            >
              Load older
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <Card className="h-full overflow-hidden">
          <Virtuoso
            style={{ height: "100%" }}
            data={filtered}
            followOutput={autoScroll && !paused ? "smooth" : false}
            itemContent={(idx, row) => (
              <div key={idx} className="border-b border-chamber-wall/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-24 shrink-0">
                    {row.ts ? new Date(row.ts).toLocaleTimeString() : "—"}
                  </span>
                  <Badge variant={levelVariant(row.level)} size="sm">
                    {row.level}
                  </Badge>
                  <div className="min-w-0 text-sm text-gray-200 truncate">{row.msg}</div>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(row.raw);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>

                {row.details && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-gray-500">details</summary>
                    <pre className="mt-2 text-xs text-emerald-300 whitespace-pre-wrap break-words bg-black/20 rounded p-2 border border-chamber-wall">
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          />
        </Card>
      </div>
    </div>
  );
};
