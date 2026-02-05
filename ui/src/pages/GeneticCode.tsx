/**
 * Genetic Code
 * Config plan/apply flow (backend-transparent)
 */

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Badge, Button, Card, Input, Modal, Skeleton } from "../components/base";
import { JsonEditor, JsonPanel } from "../components/ops";
import { applyConfigChanges, dryRunConfigChanges, getConfig, getEnv, updateEnv, validateConfig } from "../api/client";
import type { EnvResponse, EnvUpdateResponse } from "../api/types";

function stripResolved(obj: Record<string, unknown>): Record<string, unknown> {
  const { resolved: _resolved, ...rest } = obj as any;
  return rest as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      const k = ak[i]!;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function diffToPatch(base: Record<string, unknown>, next: Record<string, unknown>, prefix = ""): {
  patch: Record<string, unknown>;
  changedPaths: string[];
  removedPaths: string[];
} {
  const patch: Record<string, unknown> = {};
  const changedPaths: string[] = [];
  const removedPaths: string[] = [];

  for (const key of Object.keys(base)) {
    if (!(key in next)) {
      removedPaths.push(prefix ? `${prefix}.${key}` : key);
    }
  }

  for (const [key, nextValue] of Object.entries(next)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in base)) {
      patch[key] = nextValue;
      changedPaths.push(path);
      continue;
    }

    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(nextValue)) {
      const inner = diffToPatch(baseValue, nextValue, path);
      if (Object.keys(inner.patch).length > 0) {
        patch[key] = inner.patch;
        changedPaths.push(...inner.changedPaths);
      }
      removedPaths.push(...inner.removedPaths);
      continue;
    }

    if (!deepEqual(baseValue, nextValue)) {
      patch[key] = nextValue;
      changedPaths.push(path);
    }
  }

  return { patch, changedPaths, removedPaths };
}

function findSecretPaths(value: unknown): string[] {
  if (!isPlainObject(value)) return [];
  const out: string[] = [];

  const telegram = value.telegram;
  if (isPlainObject(telegram)) {
    const botToken = telegram.botToken;
    if (typeof botToken === "string" && botToken.trim()) out.push("telegram.botToken");
    const webhook = telegram.webhook;
    if (isPlainObject(webhook)) {
      const secretToken = (webhook as any).secretToken;
      if (typeof secretToken === "string" && secretToken.trim()) out.push("telegram.webhook.secretToken");
    }
  }

  const providers = value.providers;
  if (isPlainObject(providers) && isPlainObject(providers.items)) {
    for (const [id, provider] of Object.entries(providers.items)) {
      if (!isPlainObject(provider)) continue;
      const apiKey = (provider as any).apiKey;
      if (typeof apiKey === "string" && apiKey.trim()) {
        out.push(`providers.items.${id}.apiKey`);
      }
      const authProfiles = (provider as any).authProfiles;
      if (Array.isArray(authProfiles)) {
        authProfiles.forEach((profile, idx) => {
          if (!isPlainObject(profile)) return;
          const pKey = (profile as any).apiKey;
          if (typeof pKey === "string" && pKey.trim()) {
            out.push(`providers.items.${id}.authProfiles[${idx}].apiKey`);
          }
        });
      }
    }
  }

  return out;
}

export const GeneticCode: React.FC = () => {
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});

  const cfgQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const envQuery = useQuery({
    queryKey: ["env"],
    queryFn: getEnv,
    enabled: envOpen,
  });

  const configPath = cfgQuery.data?.path ?? "";
  const rawConfig = (cfgQuery.data?.config ?? null) as Record<string, unknown> | null;

  const baseEditable = useMemo(() => {
    if (!rawConfig) return null;
    return stripResolved(rawConfig);
  }, [rawConfig]);

  useEffect(() => {
    if (!baseEditable) return;
    if (dirty) return;
    setText(JSON.stringify(baseEditable, null, 2));
  }, [baseEditable, dirty]);

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text) as unknown;
      if (!isPlainObject(value)) return { ok: false as const, error: "Root must be a JSON object", value: null };
      return { ok: true as const, error: null as string | null, value };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err), value: null };
    }
  }, [text]);

  const diff = useMemo(() => {
    if (!baseEditable || !parsed.ok) return null;
    return diffToPatch(baseEditable, parsed.value);
  }, [baseEditable, parsed]);

  const secretPaths = useMemo(() => {
    if (!parsed.ok) return [];
    return findSecretPaths(parsed.value);
  }, [parsed]);

  const patch = diff?.patch ?? {};
  const changedPaths = diff?.changedPaths ?? [];
  const removedPaths = diff?.removedPaths ?? [];

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error ?? "Invalid JSON");
      return validateConfig(parsed.value);
    },
    onSuccess: () => setValidateOpen(true),
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error ?? "Invalid JSON");
      return dryRunConfigChanges(patch);
    },
    onSuccess: () => setPlanOpen(true),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error ?? "Invalid JSON");
      return applyConfigChanges(patch);
    },
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      setApplyOpen(true);
    },
  });

  const envMutation = useMutation({
    mutationFn: (updates: Record<string, string | null>) => updateEnv(updates),
    onSuccess: async () => {
      setEnvDraft({});
      await queryClient.invalidateQueries({ queryKey: ["env"] });
    },
  });

  if (cfgQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={100} />
        <Skeleton variant="rectangular" height={420} />
      </div>
    );
  }

  const plan = dryRunMutation.data as any;
  const requiresRestart = Boolean(plan?.requiresRestart);
  const validateResult = validateMutation.data;
  const applyResult = applyMutation.data as any;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🧬</span>
            Genetic Code
          </h1>
          <p className="text-sm text-gray-400 truncate">{configPath}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={parsed.ok ? "nurse" : "soldier"} dot pulse={parsed.ok}>
            {parsed.ok ? "Valid JSON" : "Invalid JSON"}
          </Badge>
          <Badge variant={changedPaths.length > 0 ? "queen" : "default"}>{changedPaths.length} changes</Badge>
          {secretPaths.length > 0 ? (
            <Badge variant="soldier">{secretPaths.length} secrets in config</Badge>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setEnvOpen(true)}>
            Secrets
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRawOpen(true)}>
            View raw
          </Button>
        </div>
      </header>

      {requiresRestart && (
        <div className="px-4 py-3 border-b border-chamber-wall bg-soldier-alert/10 text-sm text-gray-200 flex items-center justify-between gap-3">
          <div>
            <span className="font-semibold text-white">Restart required</span>{" "}
            <span className="text-gray-400">Apply completed, but changes require a full restart.</span>
          </div>
          <Badge variant="soldier">requiresRestart</Badge>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize="58%" minSize="40%" className="h-full">
            <div className="h-full p-4 overflow-y-auto">
              <JsonEditor
                title="Config (editable)"
                value={text}
                onChange={(v) => {
                  setText(v);
                  setDirty(true);
                }}
                height={720}
                footer={
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="text-xs text-gray-500">
                      Note: key removals are not applied by server merge. ({removedPaths.length} removals detected)
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => validateMutation.mutate()}
                        loading={validateMutation.isPending}
                        disabled={!parsed.ok}
                      >
                        Validate
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => dryRunMutation.mutate()}
                        loading={dryRunMutation.isPending}
                        disabled={!parsed.ok || changedPaths.length === 0}
                      >
                        Dry run
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => applyMutation.mutate()}
                        loading={applyMutation.isPending}
                        disabled={!parsed.ok || changedPaths.length === 0}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                }
              />
            </div>
          </Panel>

          <Separator className="w-1 bg-chamber-wall/60 hover:bg-queen-amber/50 transition-colors" />

          <Panel minSize="30%" className="h-full">
            <div className="h-full p-4 overflow-y-auto space-y-4">
              <Card>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-white">Change Summary</div>
                  <Button variant="secondary" size="sm" onClick={() => setPlanOpen(true)} disabled={!plan}>
                    Open plan
                  </Button>
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  <div>Changed paths: {changedPaths.length}</div>
                  <div>Removed paths: {removedPaths.length} (not applied)</div>
                </div>
                {secretPaths.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-soldier-alert">
                      Secrets detected in ant.config.json (move to .env)
                    </summary>
                    <div className="mt-2 max-h-40 overflow-auto rounded border border-chamber-wall bg-chamber-dark/50 p-2 text-xs font-mono text-gray-200 space-y-1">
                      {secretPaths.slice(0, 50).map((p) => (
                        <div key={p}>{p}</div>
                      ))}
                      {secretPaths.length > 50 ? (
                        <div className="text-gray-500">… {secretPaths.length - 50} more</div>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      Use <span className="font-mono text-white">Secrets</span> to store tokens in <span className="font-mono text-white">.env</span>,
                      then remove them from config.
                    </div>
                  </details>
                ) : null}
                {changedPaths.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-gray-400">Changed dot-paths</summary>
                    <div className="mt-2 max-h-52 overflow-auto rounded border border-chamber-wall bg-chamber-dark/50 p-2 text-xs font-mono text-gray-200 space-y-1">
                      {changedPaths.slice(0, 250).map((p) => (
                        <div key={p}>{p}</div>
                      ))}
                      {changedPaths.length > 250 && <div className="text-gray-500">… {changedPaths.length - 250} more</div>}
                    </div>
                  </details>
                )}
              </Card>

              <JsonPanel title="Patch (sent as `changes`)" endpoint="POST /api/config" value={patch} />

              {validateResult ? <JsonPanel title="Validation result" endpoint="POST /api/config/validate" value={validateResult} /> : null}
              {plan ? <JsonPanel title="Dry-run plan" endpoint="POST /api/config (dryRun)" value={plan} /> : null}
              {applyResult ? <JsonPanel title="Apply result" endpoint="POST /api/config" value={applyResult} /> : null}
            </div>
          </Panel>
        </Group>
      </div>

      <Modal isOpen={rawOpen} onClose={() => setRawOpen(false)} title="Raw Config (from backend)" size="xl">
        <JsonPanel title="Raw /api/config" endpoint="/api/config" value={cfgQuery.data ?? { loading: true }} />
      </Modal>

      <Modal isOpen={envOpen} onClose={() => setEnvOpen(false)} title="Secrets (.env)" size="lg">
        <div className="space-y-4">
          <div className="text-xs text-gray-400">
            {envQuery.data?.path ? (
              <>
                Editing <span className="font-mono text-white">{envQuery.data.path}</span>. Values are never displayed —
                only whether they are set.
              </>
            ) : (
              "Loading…"
            )}
          </div>

          {envQuery.isLoading ? (
            <Skeleton variant="rectangular" height={180} />
          ) : envQuery.error ? (
            <Card>
              <div className="text-sm text-soldier-alert">
                Failed to load env: {envQuery.error instanceof Error ? envQuery.error.message : String(envQuery.error)}
              </div>
            </Card>
          ) : (
            <>
              {(
                [
                  { key: "OPENAI_API_KEY", label: "OpenAI API Key" },
                  { key: "COPILOT_TOKEN", label: "Copilot Token" },
                  { key: "CLAUDE_API_KEY", label: "Claude API Key" },
                  { key: "ANT_TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token" },
                ] as const
              ).map(({ key, label }) => {
                const status = (envQuery.data as EnvResponse | undefined)?.keys?.[key];
                const isSet = Boolean(status?.envSet || status?.fileSet);
                const draftValue = envDraft[key] ?? "";

                return (
                  <Card key={key} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{label}</div>
                        <div className="text-xs text-gray-500 font-mono">{key}</div>
                      </div>
                      <Badge variant={isSet ? "nurse" : "soldier"}>{isSet ? "set" : "empty"}</Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                      <div className="md:col-span-2">
                        <Input
                          type="password"
                          value={draftValue}
                          onChange={(e) => setEnvDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder={isSet ? "•••••••• (enter to replace)" : "enter value"}
                          helperText={isSet ? "A value is already set; entering a new value will replace it." : undefined}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          className="flex-1"
                          onClick={() => envMutation.mutate({ [key]: draftValue })}
                          disabled={!draftValue.trim()}
                          loading={envMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => envMutation.mutate({ [key]: null })}
                          loading={envMutation.isPending}
                        >
                          Unset
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {envMutation.data ? (
                <JsonPanel title="Update result" endpoint="POST /api/env" value={envMutation.data as EnvUpdateResponse} />
              ) : null}

              <Card>
                <div className="text-sm text-gray-300">
                  Most env changes require a restart. Run <span className="font-mono text-white">ant restart</span> after
                  updating secrets.
                </div>
              </Card>
            </>
          )}
        </div>
      </Modal>

      <Modal isOpen={validateOpen} onClose={() => setValidateOpen(false)} title="Validation" size="lg">
        <JsonPanel title="Validation result" endpoint="POST /api/config/validate" value={validateResult ?? { loading: true }} />
      </Modal>

      <Modal isOpen={planOpen} onClose={() => setPlanOpen(false)} title="Dry Run Plan" size="xl">
        <JsonPanel title="Dry-run plan" endpoint="POST /api/config (dryRun)" value={plan ?? { loading: true }} />
      </Modal>

      <Modal isOpen={applyOpen} onClose={() => setApplyOpen(false)} title="Apply Result" size="lg">
        <JsonPanel title="Apply result" endpoint="POST /api/config" value={applyResult ?? { loading: true }} />
        {applyResult?.requiresRestart ? (
          <Card className="mt-3">
            <div className="text-sm text-gray-300">
              Restart required. Run <span className="font-mono text-white">ant restart</span> (or stop/start the runtime).
            </div>
          </Card>
        ) : null}
      </Modal>
    </div>
  );
};
