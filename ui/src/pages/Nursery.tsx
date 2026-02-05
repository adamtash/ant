/**
 * Nursery Page
 * Main-Agent task control plane (work queue + subagents)
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Input, Skeleton } from "../components/base";
import { DataTable, JsonPanel, ToolChain } from "../components/ops";
import {
  assignMainAgentTask,
  getMainAgentTask,
  getMainAgentTasks,
  pauseMainAgent,
  resumeMainAgent,
} from "../api/client";
import type { MainAgentTaskEntry } from "../api/types";

const statusBadgeVariant = (status: MainAgentTaskEntry["status"]) => {
  if (status === "running") return "queen";
  if (status === "succeeded") return "nurse";
  if (status === "failed") return "soldier";
  if (status === "retrying") return "architect";
  return "default";
};

export const Nursery: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [lane, setLane] = useState<MainAgentTaskEntry["lane"] | "all">("all");
  const [status, setStatus] = useState<MainAgentTaskEntry["status"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDuty, setNewDuty] = useState("");

  const tasksQuery = useQuery({
    queryKey: ["mainAgentTasks"],
    queryFn: getMainAgentTasks,
    refetchInterval: 5000,
  });

  const selectedTaskQuery = useQuery({
    queryKey: ["mainAgentTask", selectedId ?? ""],
    queryFn: () => getMainAgentTask(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: 5000,
  });

  const pauseMutation = useMutation({
    mutationFn: pauseMainAgent,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeMainAgent,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const assignMutation = useMutation({
    mutationFn: (description: string) => assignMainAgentTask(description),
    onSuccess: async () => {
      setNewDuty("");
      await queryClient.invalidateQueries({ queryKey: ["mainAgentTasks"] });
      await queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const tasks = (tasksQuery.data?.tasks ?? []) as MainAgentTaskEntry[];

  const decorated = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.taskId, t]));
    const depthCache = new Map<string, number>();
    const getDepth = (task: MainAgentTaskEntry): number => {
      if (!task.parentTaskId) return 0;
      if (depthCache.has(task.taskId)) return depthCache.get(task.taskId)!;
      let depth = 0;
      let current = task;
      const seen = new Set<string>();
      while (current.parentTaskId && !seen.has(current.parentTaskId) && depth < 6) {
        seen.add(current.parentTaskId);
        depth += 1;
        const parent = byId.get(current.parentTaskId);
        if (!parent) break;
        current = parent;
      }
      depthCache.set(task.taskId, depth);
      return depth;
    };

    return tasks.map((t) => ({ ...t, _depth: getDepth(t) }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decorated
      .filter((t) => (lane === "all" ? true : t.lane === lane))
      .filter((t) => (status === "all" ? true : t.status === status))
      .filter((t) => (q ? t.description.toLowerCase().includes(q) || t.taskId.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [decorated, lane, search, status]);

  const columns = useMemo<Array<ColumnDef<(typeof filtered)[number]>>>(
    () => [
      {
        header: "Status",
        accessorKey: "status",
        cell: (ctx) => (
          <Badge variant={statusBadgeVariant(ctx.row.original.status)} size="sm" dot pulse={ctx.row.original.status === "running"}>
            {ctx.row.original.status}
          </Badge>
        ),
      },
      {
        header: "Lane",
        accessorKey: "lane",
        cell: (ctx) => (
          <span className="text-xs font-mono text-gray-300">{ctx.row.original.lane}</span>
        ),
      },
      {
        header: "Phase",
        accessorKey: "phase",
        cell: (ctx) => (
          <span className="text-xs text-gray-400">{ctx.row.original.phase ?? "-"}</span>
        ),
      },
      {
        header: "Task",
        accessorKey: "description",
        cell: (ctx) => {
          const depth = (ctx.row.original as any)._depth as number;
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {depth > 0 && <span className="text-gray-600">{Array(depth).fill("—").join("")}</span>}
                <span className="truncate text-gray-100">{ctx.row.original.description}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 font-mono truncate">{ctx.row.original.taskId}</div>
            </div>
          );
        },
      },
      {
        header: "Updated",
        accessorKey: "updatedAt",
        cell: (ctx) => <span className="text-xs text-gray-400">{new Date(ctx.row.original.updatedAt).toLocaleTimeString()}</span>,
      },
    ],
    []
  );

  if (tasksQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={100} />
        <Skeleton variant="rectangular" height={420} />
      </div>
    );
  }

  const selectedTask = (selectedTaskQuery.data as any)?.task as MainAgentTaskEntry | undefined;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🥚</span>
            Nursery
          </h1>
          <p className="text-sm text-gray-400">Main-Agent Tasks & Subagents</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="nurse">{tasks.length} tasks</Badge>
          <Button variant="secondary" size="sm" onClick={() => pauseMutation.mutate()} loading={pauseMutation.isPending}>
            Pause Queen
          </Button>
          <Button variant="primary" size="sm" onClick={() => resumeMutation.mutate()} loading={resumeMutation.isPending}>
            Resume
          </Button>
        </div>
      </header>

      <div className="p-4 border-b border-chamber-wall">
        <div className="grid grid-cols-6 gap-2">
          <Input
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="col-span-2"
          />
          <select
            value={lane}
            onChange={(e) => setLane(e.target.value as any)}
            className="col-span-1 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All lanes</option>
            <option value="main">main</option>
            <option value="autonomous">autonomous</option>
            <option value="maintenance">maintenance</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="col-span-1 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All statuses</option>
            <option value="pending">pending</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="retrying">retrying</option>
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
            <option value="canceled">canceled</option>
          </select>
          <div className="col-span-2 flex gap-2">
            <Input
              placeholder="Assign a new duty…"
              value={newDuty}
              onChange={(e) => setNewDuty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newDuty.trim() && assignMutation.mutate(newDuty.trim())}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!newDuty.trim()}
              loading={assignMutation.isPending}
              onClick={() => assignMutation.mutate(newDuty.trim())}
            >
              Assign
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize="48%" minSize="30%">
            <div className="h-full p-4 overflow-auto">
              <DataTable
                data={filtered}
                columns={columns}
                dense
                empty="No tasks match filters."
                onRowClick={(row) => setSelectedId((row as any).taskId)}
              />
            </div>
          </Panel>

          <Separator className="w-1 bg-chamber-wall/60 hover:bg-queen-amber/40 transition-colors" />

          <Panel defaultSize="52%" minSize="30%">
            <div className="h-full p-4 overflow-auto space-y-4">
              {!selectedId ? (
                <Card>
                  <div className="text-gray-400 text-sm">Select a task to inspect.</div>
                </Card>
              ) : (
                <>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-500">Task</div>
                        <div className="text-white font-semibold truncate">{selectedTask?.description ?? selectedId}</div>
                        {selectedTask?.sessionKey && (
                          <div className="mt-2 text-xs text-gray-500 font-mono truncate">{selectedTask.sessionKey}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedTask?.sessionKey && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/pheromone?session=${encodeURIComponent(selectedTask.sessionKey)}`)}>
                            Session
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>

                  {selectedTask?.sessionKey ? (
                    <Card>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-white">Tool Chain</h3>
                        <Badge variant="default" size="sm">/api/sessions/:key/tool-parts</Badge>
                      </div>
                      <ToolChain sessionKey={selectedTask.sessionKey} />
                    </Card>
                  ) : null}

                  <JsonPanel title="Raw Task JSON" endpoint={`/api/main-agent/tasks/${encodeURIComponent(selectedId)}`} value={selectedTaskQuery.data ?? { loading: true }} />
                </>
              )}
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
};
