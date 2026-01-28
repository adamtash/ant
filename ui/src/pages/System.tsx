import { useEffect, useState } from "react";
import { apiGet } from "../api/client";
import type { InstallStatusResponse, MemoryStatsResponse, WhatsAppStatusResponse } from "../api/types";
import Panel from "../components/Panel";
import StatusBadge from "../components/StatusBadge";

export default function System() {
  const [installStatus, setInstallStatus] = useState<InstallStatusResponse["status"] | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStatsResponse["stats"] | null>(null);
  const [whatsApp, setWhatsApp] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<InstallStatusResponse>("/install/status")
      .then((data) => setInstallStatus(data.status))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load install status"));

    apiGet<MemoryStatsResponse>("/memory/stats")
      .then((data) => setMemoryStats(data.stats))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load memory stats"));

    apiGet<WhatsAppStatusResponse>("/whatsapp/status")
      .then((data) => setWhatsApp(data.status))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load WhatsApp status"));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">System</h2>
          <p className="text-slate-400">Install health, memory sync, WhatsApp status.</p>
        </div>
        {error && <StatusBadge label={error} tone="error" />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Install status" description="Node, platform, and Playwright checks.">
          {installStatus ? (
            <div className="space-y-2 text-sm text-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-400">Node</span>
                <span>{installStatus.node}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Platform</span>
                <span>{installStatus.platform} · {installStatus.arch}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Playwright</span>
                <span>{installStatus.playwright.installed ? "installed" : "missing"}</span>
              </div>
              <div className="text-xs text-slate-400 break-all">Log file: {installStatus.logFile}</div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Loading...</p>
          )}
        </Panel>

        <Panel title="Memory" description="Index sync and persistence metrics.">
          {memoryStats ? (
            <div className="space-y-2 text-sm text-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-400">Enabled</span>
                <span>{memoryStats.enabled ? "yes" : "no"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last run</span>
                <span>{memoryStats.lastRunAt ? new Date(memoryStats.lastRunAt).toLocaleString() : "never"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Files</span>
                <span>{memoryStats.fileCount}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Loading...</p>
          )}
        </Panel>
      </div>

      <Panel title="WhatsApp status" description="Connection snapshot from the runtime.">
        <pre className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-4 text-xs text-slate-200 whitespace-pre-wrap">
          {whatsApp ? JSON.stringify(whatsApp, null, 2) : "Loading..."}
        </pre>
      </Panel>
    </div>
  );
}
