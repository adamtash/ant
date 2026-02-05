import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet, classifyError, getTaskRaw } from "../../api/client";
import { useSelectionStore } from "../../state/selectionStore";
import { useEventsStore } from "../../state/eventsStore";
import { Badge, Button } from "../base";
import { JsonPanel } from "./JsonPanel";

export const EntityDrawer: React.FC = () => {
  const navigate = useNavigate();
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const events = useEventsStore((s) => s.events);

  const [classification, setClassification] = useState<unknown | null>(null);
  const [classifying, setClassifying] = useState(false);

  const errorEvent = useMemo(() => {
    if (!selected || selected.type !== "error") return null;
    return events.slice().reverse().find((e) => e.id === selected.id) ?? null;
  }, [events, selected]);

  const taskQuery = useQuery({
    queryKey: ["task", selected?.type === "task" ? selected.id : ""],
    queryFn: async () => getTaskRaw((selected as any).id),
    enabled: Boolean(selected && selected.type === "task"),
    refetchInterval: (data: any) => (data?.status === "running" || data?.status === "queued" ? 2000 : false),
  });

  const subagentQuery = useQuery({
    queryKey: ["mainAgentTask", selected?.type === "subagent" ? selected.id : ""],
    queryFn: async () =>
      apiGet<{ ok: boolean; task?: unknown }>(`/main-agent/tasks/${encodeURIComponent((selected as any).id)}`),
    enabled: Boolean(selected && selected.type === "subagent"),
    refetchInterval: 5000,
  });

  const title = selected ? `${selected.type.toUpperCase()} · ${selected.id}` : "";

  const onOpen = () => {
    if (!selected) return;
    if (selected.type === "task") navigate(`/tasks/${encodeURIComponent(selected.id)}`);
    if (selected.type === "session") navigate(`/pheromone?session=${encodeURIComponent(selected.id)}`);
  };

  const classify = async () => {
    if (!errorEvent) return;
    setClassifying(true);
    try {
      const payload = errorEvent.data as any;
      const message = payload?.message || payload?.error || JSON.stringify(payload);
      const res = await classifyError(String(message), { event: errorEvent });
      setClassification(res.classification);
    } finally {
      setClassifying(false);
    }
  };

  const body = (() => {
    if (!selected) return null;
    if (selected.type === "task") {
      return <JsonPanel title="Task JSON" endpoint={`/api/tasks/${encodeURIComponent(selected.id)}`} value={taskQuery.data ?? { loading: true }} />;
    }
    if (selected.type === "subagent") {
      return (
        <JsonPanel
          title="Main-Agent Task JSON"
          endpoint={`/api/main-agent/tasks/${encodeURIComponent(selected.id)}`}
          value={(subagentQuery.data as any)?.task ?? subagentQuery.data ?? { loading: true }}
        />
      );
    }
    if (selected.type === "error") {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge variant="soldier" dot pulse>
              incident
            </Badge>
            <Button variant="secondary" size="sm" onClick={classify} loading={classifying}>
              Classify
            </Button>
          </div>
          <JsonPanel title="Error Event" endpoint="/api/events/stream" value={errorEvent ?? { notFound: true }} />
          {classification !== null ? <JsonPanel title="Classification" value={classification} /> : null}
        </div>
      );
    }
    return <JsonPanel title="Selection" value={selected} />;
  })();

  return (
    <AnimatePresence>
      {selected && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={clear}
          />
          <motion.aside
            className="fixed top-0 right-0 z-50 h-full w-[460px] max-w-[92vw] bg-chamber-tunnel border-l border-chamber-wall shadow-2xl flex flex-col"
            initial={{ x: 460 }}
            animate={{ x: 0 }}
            exit={{ x: 460 }}
            transition={{ type: "tween", duration: 0.18 }}
          >
            <div className="p-4 border-b border-chamber-wall flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-500">Inspector</div>
                <div className="text-white font-semibold truncate">{title}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onOpen}>
                  Open
                </Button>
                <Button variant="secondary" size="sm" onClick={clear}>
                  Close
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">{body}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
