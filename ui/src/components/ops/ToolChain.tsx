import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSessionToolParts } from "../../api/client";
import { Badge } from "../base";

type ToolPart = {
  id: string;
  tool: string;
  state:
    | { status: "pending"; input: Record<string, unknown>; raw: string }
    | { status: "running"; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
    | { status: "completed"; input: Record<string, unknown>; title: string; output: string; metadata?: Record<string, unknown>; time: { start: number; end: number } }
    | { status: "error"; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } };
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function getToolStart(part: ToolPart): number {
  if (part.state.status === "running") return part.state.time.start;
  if (part.state.status === "completed") return part.state.time.start;
  if (part.state.status === "error") return part.state.time.start;
  return 0;
}

function getToolDuration(part: ToolPart): number | null {
  if (part.state.status === "completed") return part.state.time.end - part.state.time.start;
  if (part.state.status === "error") return part.state.time.end - part.state.time.start;
  return null;
}

export const ToolChain: React.FC<{ sessionKey: string }> = ({ sessionKey }) => {
  const query = useQuery({
    queryKey: ["sessionToolParts", sessionKey],
    queryFn: () => getSessionToolParts(sessionKey),
    enabled: Boolean(sessionKey),
    refetchInterval: 2000,
  });

  const toolParts = ((query.data as any)?.toolParts ?? []) as ToolPart[];
  const sorted = useMemo(() => [...toolParts].sort((a, b) => getToolStart(a) - getToolStart(b)), [toolParts]);

  if (!sessionKey) return null;

  if (sorted.length === 0) {
    return <div className="text-sm text-gray-500">No tool calls recorded yet.</div>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((part) => {
        const dur = getToolDuration(part);
        const status = part.state.status;
        return (
          <div key={part.id} className="p-3 bg-chamber-dark rounded-lg border border-chamber-wall">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-white font-medium truncate">{part.tool}</div>
                <div className="text-xs text-gray-500 truncate">{part.id}</div>
              </div>
              <div className="flex items-center gap-2">
                {dur !== null && <Badge variant="default">{formatDuration(dur)}</Badge>}
                <Badge
                  variant={
                    status === "completed" ? "nurse" : status === "error" ? "soldier" : status === "running" ? "queen" : "default"
                  }
                  dot
                  pulse={status === "running"}
                >
                  {status}
                </Badge>
              </div>
            </div>

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-400">Details</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Input</div>
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-black/20 rounded p-2 border border-chamber-wall">
                    {JSON.stringify(part.state.input, null, 2)}
                  </pre>
                </div>
                {part.state.status === "completed" && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Output</div>
                    <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-black/20 rounded p-2 border border-chamber-wall">
                      {part.state.output}
                    </pre>
                  </div>
                )}
                {part.state.status === "error" && (
                  <div className="text-xs text-soldier-alert whitespace-pre-wrap">{part.state.error}</div>
                )}
                {part.state.status === "pending" && (
                  <div className="text-xs text-gray-500 whitespace-pre-wrap">{part.state.raw}</div>
                )}
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
};

