import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStatus } from "../api/client";
import type { StatusResponse, SystemEvent } from "../api/types";
import { noteErrorEvent, reconcileColonyFromStatus } from "../colony/sync/reconcile";
import { useEventsStore } from "../state/eventsStore";
import { RealtimeHub, type HubMessage, type RealtimeConnectionState } from "./hub";

type RealtimeContextValue = RealtimeConnectionState;

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function isSystemEvent(payload: unknown): payload is SystemEvent {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.type === "string" &&
    typeof p.timestamp === "number" &&
    typeof p.severity === "string" &&
    typeof p.source === "string" &&
    p.data !== null &&
    typeof p.data === "object"
  );
}

function tryExtractStatusSnapshot(payload: unknown): StatusResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "status_snapshot") return null;
  const data = p.data as any;
  const status = data?.data ?? data;
  if (status && typeof status === "object" && (status as any).ok === true) {
    return status as StatusResponse;
  }
  return null;
}

function tryExtractStatusDelta(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "status_delta") return null;
  const data = p.data as any;
  const changes = (data?.changes ?? p.changes) as unknown;
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    return changes as Record<string, unknown>;
  }
  return null;
}

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const pushEvent = useEventsStore((s) => s.push);

  const hubRef = useRef<RealtimeHub | null>(null);
  if (!hubRef.current) hubRef.current = new RealtimeHub();

  const [conn, setConn] = useState<RealtimeConnectionState>({
    connected: false,
    transport: "disconnected",
    lastMessageAt: null,
    lastError: null,
  });

  const reconcileTimerRef = useRef<number | null>(null);
  const scheduleReconcile = () => {
    if (reconcileTimerRef.current) return;
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null;
      const status = queryClient.getQueryData(["status"]);
      if (status && typeof status === "object" && (status as any).ok === true) {
        reconcileColonyFromStatus(status as StatusResponse);
      }
    }, 50);
  };

  useEffect(() => {
    const hub = hubRef.current!;
    const unsubState = hub.subscribeState(setConn);

    const unsub = hub.subscribe((msg: HubMessage) => {
      const snapshot = tryExtractStatusSnapshot(msg.payload);
      if (snapshot) {
        queryClient.setQueryData(["status"], snapshot);
        scheduleReconcile();
        return;
      }

      const delta = tryExtractStatusDelta(msg.payload);
      if (delta) {
        queryClient.setQueryData(["status"], (prev) => {
          if (!prev || typeof prev !== "object") return prev;
          return { ...(prev as Record<string, unknown>), ...delta } as StatusResponse;
        });
        scheduleReconcile();
        return;
      }

      if (isSystemEvent(msg.payload)) {
        pushEvent(msg.payload);
        invalidateQueriesForEvent(queryClient, msg.payload);
        if (msg.payload.type === "error_occurred") {
          noteErrorEvent(msg.payload);
        }
      }
    });

    hub.start();
    return () => {
      unsub();
      unsubState();
      if (reconcileTimerRef.current) {
        window.clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
      hub.stop();
    };
  }, [pushEvent, queryClient]);

  // If we're on SSE (or disconnected), we won't receive status snapshots/deltas.
  // Keep status reasonably fresh with a light poll.
  useEffect(() => {
    if (conn.transport === "ws" && conn.connected) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const status = await getStatus();
        if (cancelled) return;
        queryClient.setQueryData(["status"], status);
        reconcileColonyFromStatus(status);
      } catch {
        // ignore
      }
    };

    void tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conn.connected, conn.transport, queryClient]);

  const value = useMemo<RealtimeContextValue>(() => conn, [conn]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export function useRealtimeState(): RealtimeConnectionState {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    return {
      connected: false,
      transport: "disconnected",
      lastMessageAt: null,
      lastError: "RealtimeProvider missing",
    };
  }
  return ctx;
}

function invalidateQueriesForEvent(queryClient: ReturnType<typeof useQueryClient>, event: SystemEvent): void {
  switch (event.type) {
    case "task_started":
    case "task_completed":
    case "task_created":
    case "task_status_changed":
    case "task_phase_changed":
    case "task_progress_updated":
    case "task_timeout_warning":
    case "task_timeout":
    case "task_retry_scheduled":
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      break;
    case "job_created":
    case "job_started":
    case "job_completed":
    case "job_failed":
    case "job_enabled":
    case "job_disabled":
    case "job_removed":
    case "cron_triggered":
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      break;
    case "skill_created":
    case "skill_deleted":
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      break;
    case "memory_indexed":
      void queryClient.invalidateQueries({ queryKey: ["memoryStats"] });
      void queryClient.invalidateQueries({ queryKey: ["memoryIndex"] });
      break;
    case "message_received":
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      break;
    case "provider_cooldown":
    case "provider_recovery":
      void queryClient.invalidateQueries({ queryKey: ["providerHealth"] });
      break;
    default:
      break;
  }
}
