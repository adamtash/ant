import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api/client";
import type { ConfigResponse } from "../api/types";
import Panel from "../components/Panel";
import StatusBadge from "../components/StatusBadge";

const sectionClasses = "rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 space-y-3";

type ProviderItem = {
  type?: string;
  cliProvider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: Record<string, string>;
  contextWindow?: number;
  embeddingsModel?: string;
  args?: string[];
};

type CliToolProvider = {
  command?: string;
  args?: string[];
};

type BrowserProfile = {
  cdpUrl?: string;
};

export default function Config() {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [jsonValue, setJsonValue] = useState("");
  const [activeTab, setActiveTab] = useState<"form" | "json">("form");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ConfigResponse>("/config")
      .then((data) => {
        setConfig(data.config);
        setJsonValue(JSON.stringify(data.config, null, 2));
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : "Failed to load config"));
  }, []);

  const updateConfig = (path: string, value: any) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const keys = path.split(".");
      let cursor: any = next;
      keys.slice(0, -1).forEach((key) => {
        cursor[key] = cursor[key] ?? {};
        cursor = cursor[key];
      });
      cursor[keys[keys.length - 1]] = value;
      setJsonValue(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const updateProviderItem = (providerKey: string, field: keyof ProviderItem, value: any) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.providers = next.providers ?? { items: {}, default: "" };
      next.providers.items = next.providers.items ?? {};
      const current = (next.providers.items[providerKey] ?? {}) as ProviderItem;
      next.providers.items[providerKey] = { ...current, [field]: value };
      setJsonValue(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const updateCliProvider = (providerKey: string, field: keyof CliToolProvider, value: any) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.cliTools = next.cliTools ?? {};
      next.cliTools.providers = next.cliTools.providers ?? {};
      const current = (next.cliTools.providers[providerKey] ?? {}) as CliToolProvider;
      next.cliTools.providers[providerKey] = { ...current, [field]: value };
      setJsonValue(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const updateBrowserProfile = (profileKey: string, value: BrowserProfile) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.browser = next.browser ?? {};
      next.browser.profiles = next.browser.profiles ?? {};
      next.browser.profiles[profileKey] = value;
      setJsonValue(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const grouped = config ?? {};
  const providerItems: Record<string, ProviderItem> = grouped.providers?.items ?? {};
  const cliProviders: Record<string, CliToolProvider> = grouped.cliTools?.providers ?? {};
  const browserProfiles: Record<string, BrowserProfile> = grouped.browser?.profiles ?? {};
  const memorySync = grouped.memory?.sync ?? {};

  const saveConfig = async () => {
    try {
      if (activeTab === "json") {
        const parsed = JSON.parse(jsonValue);
        await apiPut("/config", parsed);
        setConfig(parsed);
      } else if (config) {
        await apiPut("/config", config);
      }
      setStatus("Saved. Restart required.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save config");
    }
  };

  const restart = async () => {
    try {
      await apiPost("/restart");
      setStatus("Restarting runtime...");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Restart failed");
    }
  };

  if (!config) {
    return (
      <div className="space-y-4">
        <h2 className="text-3xl font-semibold">Config</h2>
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">Config editor</h2>
          <p className="text-slate-400">Edit runtime config in form or raw JSON.</p>
        </div>
        <div className="flex items-center gap-2">
          {status && <StatusBadge label={status} tone={status.toLowerCase().includes("fail") ? "error" : "warn"} />}
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-sm"
            onClick={() => setActiveTab((tab) => (tab === "form" ? "json" : "form"))}
          >
            {activeTab === "form" ? "JSON view" : "Form view"}
          </button>
          <button
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
            onClick={saveConfig}
          >
            Save
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-sm"
            onClick={restart}
          >
            Restart
          </button>
        </div>
      </div>

      {activeTab === "json" ? (
        <Panel title="Raw JSON" description="Validate before saving. Unknown fields preserved.">
          <textarea
            value={jsonValue}
            onChange={(event) => setJsonValue(event.target.value)}
            rows={24}
            className="w-full rounded-xl border border-slate-800/60 bg-slate-900/70 p-4 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
          />
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel title="Workspace" description="File paths and workspace roots.">
            <div className={sectionClasses}>
              <Field label="Workspace dir">
                <input
                  value={grouped.workspaceDir ?? ""}
                  onChange={(event) => updateConfig("workspaceDir", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="State dir">
                <input
                  value={grouped.stateDir ?? ""}
                  onChange={(event) => updateConfig("stateDir", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="UI" description="Web UI server configuration.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.ui?.enabled)}
                  onChange={(event) => updateConfig("ui.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Host">
                <input
                  value={grouped.ui?.host ?? ""}
                  onChange={(event) => updateConfig("ui.host", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Port">
                <input
                  type="number"
                  value={grouped.ui?.port ?? 0}
                  onChange={(event) => updateConfig("ui.port", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Auto open">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.ui?.autoOpen)}
                  onChange={(event) => updateConfig("ui.autoOpen", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Open URL">
                <input
                  value={grouped.ui?.openUrl ?? ""}
                  onChange={(event) => updateConfig("ui.openUrl", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Static dir">
                <input
                  value={grouped.ui?.staticDir ?? ""}
                  onChange={(event) => updateConfig("ui.staticDir", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Providers" description="Default provider and model routing.">
            <div className={sectionClasses}>
              <Field label="Default provider">
                <input
                  value={grouped.providers?.default ?? ""}
                  onChange={(event) => updateConfig("providers.default", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing chat">
                <input
                  value={grouped.routing?.chat ?? ""}
                  onChange={(event) => updateConfig("routing.chat", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing tools">
                <input
                  value={grouped.routing?.tools ?? ""}
                  onChange={(event) => updateConfig("routing.tools", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing embeddings">
                <input
                  value={grouped.routing?.embeddings ?? ""}
                  onChange={(event) => updateConfig("routing.embeddings", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing summary">
                <input
                  value={grouped.routing?.summary ?? ""}
                  onChange={(event) => updateConfig("routing.summary", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing subagent">
                <input
                  value={grouped.routing?.subagent ?? ""}
                  onChange={(event) => updateConfig("routing.subagent", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Routing parentForCli">
                <input
                  value={grouped.routing?.parentForCli ?? ""}
                  onChange={(event) => updateConfig("routing.parentForCli", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Providers: items" description="Edit each provider definition.">
            <div className="space-y-4">
              {Object.keys(providerItems).length === 0 && (
                <p className="text-sm text-slate-400">No provider items configured.</p>
              )}
              {Object.entries(providerItems).map(([key, item]) => (
                <div key={key} className={sectionClasses}>
                  <div className="text-sm font-semibold text-slate-200">{key}</div>
                  <Field label="Type">
                    <input
                      value={item.type ?? ""}
                      onChange={(event) => updateProviderItem(key, "type", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="CLI provider">
                    <input
                      value={item.cliProvider ?? ""}
                      onChange={(event) => updateProviderItem(key, "cliProvider", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Base URL">
                    <input
                      value={item.baseUrl ?? ""}
                      onChange={(event) => updateProviderItem(key, "baseUrl", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="API key">
                    <input
                      value={item.apiKey ?? ""}
                      onChange={(event) => updateProviderItem(key, "apiKey", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Model">
                    <input
                      value={item.model ?? ""}
                      onChange={(event) => updateProviderItem(key, "model", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Models (JSON object)">
                    <textarea
                      value={JSON.stringify(item.models ?? {}, null, 2)}
                      onChange={(event) => {
                        try {
                          updateProviderItem(key, "models", JSON.parse(event.target.value));
                        } catch {
                          // ignore parse errors while typing
                        }
                      }}
                      rows={4}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-xs"
                    />
                  </Field>
                  <Field label="Embeddings model">
                    <input
                      value={item.embeddingsModel ?? ""}
                      onChange={(event) => updateProviderItem(key, "embeddingsModel", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Context window">
                    <input
                      type="number"
                      value={item.contextWindow ?? 0}
                      onChange={(event) => updateProviderItem(key, "contextWindow", Number(event.target.value))}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Args (comma separated)">
                    <input
                      value={(item.args ?? []).join(",")}
                      onChange={(event) =>
                        updateProviderItem(
                          key,
                          "args",
                          event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        )
                      }
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Memory" description="Local memory indexing and sync.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.memory?.enabled)}
                  onChange={(event) => updateConfig("memory.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Index sessions">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.memory?.indexSessions)}
                  onChange={(event) => updateConfig("memory.indexSessions", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="SQLite path">
                <input
                  value={grouped.memory?.sqlitePath ?? ""}
                  onChange={(event) => updateConfig("memory.sqlitePath", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Embeddings model">
                <input
                  value={grouped.memory?.embeddingsModel ?? ""}
                  onChange={(event) => updateConfig("memory.embeddingsModel", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Chunk chars">
                <input
                  type="number"
                  value={grouped.memory?.chunkChars ?? 0}
                  onChange={(event) => updateConfig("memory.chunkChars", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Chunk overlap">
                <input
                  type="number"
                  value={grouped.memory?.chunkOverlap ?? 0}
                  onChange={(event) => updateConfig("memory.chunkOverlap", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Max results">
                <input
                  type="number"
                  value={grouped.memory?.maxResults ?? 0}
                  onChange={(event) => updateConfig("memory.maxResults", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Min score">
                <input
                  type="number"
                  value={grouped.memory?.minScore ?? 0}
                  step="0.01"
                  onChange={(event) => updateConfig("memory.minScore", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Memory sync" description="Sync behavior for memory indexing.">
            <div className={sectionClasses}>
              <Field label="On session start">
                <input
                  type="checkbox"
                  checked={Boolean(memorySync.onSessionStart)}
                  onChange={(event) => updateConfig("memory.sync.onSessionStart", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="On search">
                <input
                  type="checkbox"
                  checked={Boolean(memorySync.onSearch)}
                  onChange={(event) => updateConfig("memory.sync.onSearch", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Watch">
                <input
                  type="checkbox"
                  checked={Boolean(memorySync.watch)}
                  onChange={(event) => updateConfig("memory.sync.watch", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Watch debounce ms">
                <input
                  type="number"
                  value={memorySync.watchDebounceMs ?? 0}
                  onChange={(event) => updateConfig("memory.sync.watchDebounceMs", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Interval minutes">
                <input
                  type="number"
                  value={memorySync.intervalMinutes ?? 0}
                  onChange={(event) => updateConfig("memory.sync.intervalMinutes", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Sessions delta bytes">
                <input
                  type="number"
                  value={memorySync.sessionsDeltaBytes ?? 0}
                  onChange={(event) => updateConfig("memory.sync.sessionsDeltaBytes", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Sessions delta messages">
                <input
                  type="number"
                  value={memorySync.sessionsDeltaMessages ?? 0}
                  onChange={(event) => updateConfig("memory.sync.sessionsDeltaMessages", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Agent" description="Behavioral settings for the main agent.">
            <div className={sectionClasses}>
              <Field label="System prompt">
                <textarea
                  value={grouped.agent?.systemPrompt ?? ""}
                  onChange={(event) => updateConfig("agent.systemPrompt", event.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Max history tokens">
                <input
                  type="number"
                  value={grouped.agent?.maxHistoryTokens ?? 0}
                  onChange={(event) => updateConfig("agent.maxHistoryTokens", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Temperature">
                <input
                  type="number"
                  value={grouped.agent?.temperature ?? 0}
                  step="0.1"
                  onChange={(event) => updateConfig("agent.temperature", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Subagents" description="Subagent pool behavior.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.subagents?.enabled)}
                  onChange={(event) => updateConfig("subagents.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Timeout ms">
                <input
                  type="number"
                  value={grouped.subagents?.timeoutMs ?? 0}
                  onChange={(event) => updateConfig("subagents.timeoutMs", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Archive after minutes">
                <input
                  type="number"
                  value={grouped.subagents?.archiveAfterMinutes ?? 0}
                  onChange={(event) => updateConfig("subagents.archiveAfterMinutes", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="CLI tools" description="CLI tool provider wiring.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.cliTools?.enabled)}
                  onChange={(event) => updateConfig("cliTools.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Timeout ms">
                <input
                  type="number"
                  value={grouped.cliTools?.timeoutMs ?? 0}
                  onChange={(event) => updateConfig("cliTools.timeoutMs", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="MCP enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.cliTools?.mcp?.enabled)}
                  onChange={(event) => updateConfig("cliTools.mcp.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="MCP tools">
                <input
                  value={(grouped.cliTools?.mcp?.tools ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "cliTools.mcp.tools",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="CLI tool providers" description="Command configuration for each CLI provider.">
            <div className="space-y-4">
              {Object.keys(cliProviders).length === 0 && (
                <p className="text-sm text-slate-400">No CLI tool providers configured.</p>
              )}
              {Object.entries(cliProviders).map(([key, provider]) => (
                <div key={key} className={sectionClasses}>
                  <div className="text-sm font-semibold text-slate-200">{key}</div>
                  <Field label="Command">
                    <input
                      value={provider.command ?? ""}
                      onChange={(event) => updateCliProvider(key, "command", event.target.value)}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Args (comma separated)">
                    <input
                      value={(provider.args ?? []).join(",")}
                      onChange={(event) =>
                        updateCliProvider(
                          key,
                          "args",
                          event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        )
                      }
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Queue" description="Command queue thresholds.">
            <div className={sectionClasses}>
              <Field label="Warn after ms">
                <input
                  type="number"
                  value={grouped.queue?.warnAfterMs ?? 0}
                  onChange={(event) => updateConfig("queue.warnAfterMs", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Browser" description="Playwright and browser automation.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.browser?.enabled)}
                  onChange={(event) => updateConfig("browser.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Headless">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.browser?.headless)}
                  onChange={(event) => updateConfig("browser.headless", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Default profile">
                <input
                  value={grouped.browser?.defaultProfile ?? ""}
                  onChange={(event) => updateConfig("browser.defaultProfile", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Proxy base URL">
                <input
                  value={grouped.browser?.proxyBaseUrl ?? ""}
                  onChange={(event) => updateConfig("browser.proxyBaseUrl", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Browser profiles" description="CDP URLs for named profiles.">
            <div className="space-y-4">
              {Object.keys(browserProfiles).length === 0 && (
                <p className="text-sm text-slate-400">No browser profiles configured.</p>
              )}
              {Object.entries(browserProfiles).map(([key, profile]) => (
                <div key={key} className={sectionClasses}>
                  <div className="text-sm font-semibold text-slate-200">{key}</div>
                  <Field label="CDP URL">
                    <input
                      value={profile.cdpUrl ?? ""}
                      onChange={(event) => updateBrowserProfile(key, { ...profile, cdpUrl: event.target.value })}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Logging" description="Log level and file settings.">
            <div className={sectionClasses}>
              <Field label="Level">
                <input
                  value={grouped.logging?.level ?? ""}
                  onChange={(event) => updateConfig("logging.level", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="File level">
                <input
                  value={grouped.logging?.fileLevel ?? ""}
                  onChange={(event) => updateConfig("logging.fileLevel", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="File path">
                <input
                  value={grouped.logging?.filePath ?? ""}
                  onChange={(event) => updateConfig("logging.filePath", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Runtime" description="Restart command configuration.">
            <div className={sectionClasses}>
              <Field label="Restart command">
                <input
                  value={grouped.runtime?.restart?.command ?? ""}
                  onChange={(event) => updateConfig("runtime.restart.command", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Restart args (comma separated)">
                <input
                  value={(grouped.runtime?.restart?.args ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "runtime.restart.args",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Restart cwd">
                <input
                  value={grouped.runtime?.restart?.cwd ?? ""}
                  onChange={(event) => updateConfig("runtime.restart.cwd", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Queue" description="Command queue thresholds.">
            <div className={sectionClasses}>
              <Field label="Warn after ms">
                <input
                  type="number"
                  value={grouped.queue?.warnAfterMs ?? 0}
                  onChange={(event) => updateConfig("queue.warnAfterMs", Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Browser" description="Playwright and browser automation.">
            <div className={sectionClasses}>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.browser?.enabled)}
                  onChange={(event) => updateConfig("browser.enabled", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Headless">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.browser?.headless)}
                  onChange={(event) => updateConfig("browser.headless", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Default profile">
                <input
                  value={grouped.browser?.defaultProfile ?? ""}
                  onChange={(event) => updateConfig("browser.defaultProfile", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Proxy base URL">
                <input
                  value={grouped.browser?.proxyBaseUrl ?? ""}
                  onChange={(event) => updateConfig("browser.proxyBaseUrl", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Browser profiles" description="CDP URLs for named profiles.">
            <div className="space-y-4">
              {Object.keys(browserProfiles).length === 0 && (
                <p className="text-sm text-slate-400">No browser profiles configured.</p>
              )}
              {Object.entries(browserProfiles).map(([key, profile]) => (
                <div key={key} className={sectionClasses}>
                  <div className="text-sm font-semibold text-slate-200">{key}</div>
                  <Field label="CDP URL">
                    <input
                      value={profile.cdpUrl ?? ""}
                      onChange={(event) => updateBrowserProfile(key, { ...profile, cdpUrl: event.target.value })}
                      className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Logging" description="Log level and file settings.">
            <div className={sectionClasses}>
              <Field label="Level">
                <input
                  value={grouped.logging?.level ?? ""}
                  onChange={(event) => updateConfig("logging.level", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="File level">
                <input
                  value={grouped.logging?.fileLevel ?? ""}
                  onChange={(event) => updateConfig("logging.fileLevel", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="File path">
                <input
                  value={grouped.logging?.filePath ?? ""}
                  onChange={(event) => updateConfig("logging.filePath", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Runtime" description="Restart command configuration.">
            <div className={sectionClasses}>
              <Field label="Restart command">
                <input
                  value={grouped.runtime?.restart?.command ?? ""}
                  onChange={(event) => updateConfig("runtime.restart.command", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Restart args (comma separated)">
                <input
                  value={(grouped.runtime?.restart?.args ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "runtime.restart.args",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Restart cwd">
                <input
                  value={grouped.runtime?.restart?.cwd ?? ""}
                  onChange={(event) => updateConfig("runtime.restart.cwd", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="WhatsApp" description="WhatsApp integration settings.">
            <div className={sectionClasses}>
              <Field label="Session dir">
                <input
                  value={grouped.whatsapp?.sessionDir ?? ""}
                  onChange={(event) => updateConfig("whatsapp.sessionDir", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Respond to groups">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.respondToGroups)}
                  onChange={(event) => updateConfig("whatsapp.respondToGroups", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Mention only">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.mentionOnly)}
                  onChange={(event) => updateConfig("whatsapp.mentionOnly", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Bot name">
                <input
                  value={grouped.whatsapp?.botName ?? ""}
                  onChange={(event) => updateConfig("whatsapp.botName", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Respond to self only">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.respondToSelfOnly)}
                  onChange={(event) => updateConfig("whatsapp.respondToSelfOnly", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Allow self messages">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.allowSelfMessages)}
                  onChange={(event) => updateConfig("whatsapp.allowSelfMessages", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Reset on logout">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.resetOnLogout)}
                  onChange={(event) => updateConfig("whatsapp.resetOnLogout", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Typing indicator">
                <input
                  type="checkbox"
                  checked={Boolean(grouped.whatsapp?.typingIndicator)}
                  onChange={(event) => updateConfig("whatsapp.typingIndicator", event.target.checked)}
                  className="h-5 w-5 accent-brand-500"
                />
              </Field>
              <Field label="Mention keywords">
                <input
                  value={(grouped.whatsapp?.mentionKeywords ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "whatsapp.mentionKeywords",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Owner JIDs">
                <input
                  value={(grouped.whatsapp?.ownerJids ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "whatsapp.ownerJids",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Startup message">
                <input
                  value={grouped.whatsapp?.startupMessage ?? ""}
                  onChange={(event) => updateConfig("whatsapp.startupMessage", event.target.value)}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Startup recipients">
                <input
                  value={(grouped.whatsapp?.startupRecipients ?? []).join(",")}
                  onChange={(event) =>
                    updateConfig(
                      "whatsapp.startupRecipients",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </label>
  );
}
