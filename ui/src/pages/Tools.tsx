import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../api/client";
import type { ToolsResponse } from "../api/types";
import Panel from "../components/Panel";
import StatusBadge from "../components/StatusBadge";

export default function Tools() {
  const [toggles, setToggles] = useState<ToolsResponse["toggles"] | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    apiGet<ToolsResponse>("/tools")
      .then((data) => setToggles(data.toggles))
      .catch((err) => setStatus(err instanceof Error ? err.message : "Failed to load tools"));
  }, []);

  const updateToggle = async (key: keyof ToolsResponse["toggles"], value: boolean) => {
    if (!toggles) return;
    const next = { ...toggles, [key]: value };
    setToggles(next);
    try {
      await apiPut("/tools", { toggles: next });
      setStatus("Saved. Restart required.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">Tools & toggles</h2>
          <p className="text-slate-400">Enable or disable runtime subsystems.</p>
        </div>
        {status && <StatusBadge label={status} tone={status.includes("failed") ? "error" : "warn"} />}
      </div>

      <Panel title="Runtime switches" description="Changes require restart to apply.">
        {toggles ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(toggles).map(([key, value]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-3 text-sm"
              >
                <span className="capitalize text-slate-200">{key}</span>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) => updateToggle(key as keyof ToolsResponse["toggles"], event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Loading toggles...</p>
        )}
      </Panel>
    </div>
  );
}
