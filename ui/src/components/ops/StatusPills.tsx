import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../base";
import { getStatus, apiGet } from "../../api/client";
import { useRealtimeState } from "../../realtime/provider";

type WorkerHealthResponse = {
  ok: boolean;
  health?: {
    ok: boolean;
    providersReady?: boolean;
    memoryReady?: boolean;
    uptimeMs?: number;
  };
  error?: string;
};

export const StatusPills: React.FC = () => {
  const realtime = useRealtimeState();

  const statusQuery = useQuery({ queryKey: ["status"], queryFn: getStatus });
  const workerQuery = useQuery({
    queryKey: ["workerHealth"],
    queryFn: () => apiGet<WorkerHealthResponse>("/worker/health"),
    refetchInterval: 5000,
  });

  const status = statusQuery.data as any;
  const health = status?.health as any;
  const mainAgent = status?.mainAgent as any;

  const errorRate = typeof health?.errorRate === "number" ? health.errorRate : 0;
  const totalErrors = typeof health?.totalErrors === "number" ? health.totalErrors : 0;

  const workerOk = (workerQuery.data as any)?.health?.ok ?? false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={realtime.connected ? "nurse" : "soldier"} size="sm" dot pulse={realtime.connected}>
        {realtime.connected ? `RT: ${realtime.transport}` : "RT: offline"}
      </Badge>

      <Badge variant={workerOk ? "nurse" : "soldier"} size="sm" dot pulse={workerOk}>
        Worker: {workerOk ? "ok" : "down"}
      </Badge>

      <Badge variant={mainAgent?.running ? "queen" : "default"} size="sm" dot pulse={mainAgent?.running}>
        Queen: {mainAgent?.running ? "running" : "paused"}
      </Badge>

      <Badge variant={errorRate > 0 ? "soldier" : "default"} size="sm" dot pulse={errorRate > 0}>
        Errors: {totalErrors} ({errorRate}/m)
      </Badge>
    </div>
  );
};

