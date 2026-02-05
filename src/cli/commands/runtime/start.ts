/**
 * Runtime Start Command - Start the agent runtime
 */

import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveWorkspaceOrStatePath,
  saveConfig,
  type AntConfig,
} from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, writePidFile, removePidFile, ensureRuntimePaths } from "../../../gateway/process-control.js";
import type { AgentEngine } from "../../../agent/engine.js";
import type { AgentExecutor } from "../../../scheduler/types.js";
import { collectToolMediaAttachments } from "../../../utils/tool-media.js";
import { collectToolOutboundMessages } from "../../../utils/tool-outbound.js";
import type { ReloadPlan } from "../../../config/reload-rules.js";
import type { ConfigWatcher } from "../../../config/watcher.js";
import type { Message } from "../../../agent/types.js";
import type { SessionManager } from "../../../gateway/session-manager.js";
import { BridgeClient } from "../../../runtime/bridge/client.js";
import { BridgeServer } from "../../../runtime/bridge/server.js";
import type { BridgeEnvelope } from "../../../runtime/bridge/types.js";

export interface StartOptions {
  config?: string;
  tui?: boolean;
  detached?: boolean;
  quiet?: boolean;
  role?: "gateway" | "worker";
}

export function createSchedulerAgentExecutor(agentEngine: AgentEngine): AgentExecutor {
  return async (params) => {
    const result = await agentEngine.execute({
      sessionKey: params.sessionKey,
      query: params.query,
      channel: "web",
      cronContext: params.cronContext,
      promptMode: "minimal",
    });

    return { response: result.response, error: result.error };
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "resolved") continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function findUiDist(startDir: string): string | null {
  let cursor = path.resolve(startDir);
  while (true) {
    const candidate = path.join(cursor, "ui", "dist", "index.html");
    if (fsSync.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function parseConfigValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const maybeJson = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (maybeJson) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  return trimmed;
}

const DEFAULT_HISTORY_MESSAGE_LIMIT = 80;

async function buildSessionHistory(params: {
  sessionManager: SessionManager;
  sessionKey: string;
  currentContent?: string | null;
  currentTimestamp?: number;
  limit?: number;
}): Promise<Message[]> {
  const limit = params.limit ?? DEFAULT_HISTORY_MESSAGE_LIMIT;
  const messages = await params.sessionManager.readMessages(params.sessionKey, limit);
  const history = messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      name: message.name,
      timestamp: message.timestamp,
      metadata: message.metadata,
    }));

  if (history.length > 0 && params.currentContent) {
    const last = history[history.length - 1];
    const timeDelta =
      typeof params.currentTimestamp === "number" && typeof last.timestamp === "number"
        ? Math.abs(params.currentTimestamp - last.timestamp)
        : undefined;
    const isDuplicateUser =
      last.role === "user" &&
      last.content.trim() === params.currentContent.trim() &&
      (timeDelta === undefined || timeDelta <= 5000);
    if (isDuplicateUser) {
      history.pop();
    }
  }

  return history;
}

function buildPatchFromDotPath(dotPath: string, value: unknown): Record<string, unknown> {
  const parts = dotPath.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const root: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next: Record<string, unknown> = {};
    cursor[key] = next;
    cursor = next;
  }
  cursor[parts[parts.length - 1]!] = value;
  return root;
}

function resolveWorkerHeartbeatPath(cfg: AntConfig): string {
  const raw = cfg.runtime.worker.heartbeatPath;
  return resolveWorkspaceOrStatePath(
    raw,
    cfg.resolved.workspaceDir,
    cfg.resolved.stateDir,
  );
}

async function startSupervised(cfg: AntConfig, options: StartOptions): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!cfg.runtime.supervisor.enabled) {
    out.warn("Supervisor disabled; starting single runtime.");
    return startSingle(cfg, options);
  }

  await ensureRuntimePaths(cfg);

  if (options.detached) {
    const args = ["run"];
    if (options.tui) args.push("--tui");
    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: "ignore",
      cwd: cfg.resolved.workspaceDir,
      env: {
        ...process.env,
        ANT_CONFIG: cfg.resolved.configPath,
      },
    });
    child.unref();
    out.success(`Supervisor started in background (PID: ${child.pid})`);
    return;
  }

  const { Supervisor } = await import("../../../supervisor.js");
  const supervisor = new Supervisor({
    stateDir: cfg.resolved.stateDir,
    command: process.execPath,
    gatewayArgs: [
      process.argv[1],
      "gateway",
      "-c",
      cfg.resolved.configPath,
      ...(options.tui ? ["--tui"] : []),
    ],
    workerArgs: [
      process.argv[1],
      "worker",
      "-c",
      cfg.resolved.configPath,
    ],
    cwd: cfg.resolved.workspaceDir,
    restartDelayMs: cfg.runtime.supervisor.restartDelayMs,
    maxRestarts: cfg.runtime.supervisor.maxRestarts,
    restartWindowMs: cfg.runtime.supervisor.restartWindowMs,
    workerHeartbeatPath: resolveWorkerHeartbeatPath(cfg),
    workerHeartbeatMaxAgeMs: cfg.runtime.worker.maxHeartbeatAgeMs,
    heartbeatCheckIntervalMs: Math.max(1000, cfg.runtime.worker.heartbeatIntervalMs),
  });

  await supervisor.start();
}

async function startGateway(cfg: AntConfig, options: StartOptions): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  let currentConfig: AntConfig = cfg;
  const gatewayHost = cfg.gateway?.host ?? cfg.ui.host;
  const gatewayPort = cfg.ui.enabled ? cfg.ui.port : (cfg.gateway?.port ?? cfg.ui.port);
  const uiUrl = cfg.ui.openUrl || `http://${gatewayHost}:${gatewayPort}`;

  await ensureRuntimePaths(cfg);

  if (typeof process.send !== "function") {
    throw new RuntimeError(
      "Gateway requires supervisor IPC",
      "Run `ant run` to start the split runtime with a supervisor."
    );
  }

  const existingPid = await readPidFile(cfg, "gateway");
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      throw new RuntimeError(
        `Gateway is already running (PID: ${existingPid})`,
        "Use 'ant stop' to stop it first, or 'ant restart' to restart."
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw err;
      }
    }
  }

  out.info("Starting gateway...");
  await writePidFile(cfg, "gateway");

  const { GatewayServer } = await import("../../../gateway/server.js");
  const { createLogger } = await import("../../../log.js");
  const { MessageRouter, WhatsAppAdapter, TestWhatsAppAdapter, TelegramAdapter, TestTelegramAdapter } = await import("../../../channels/index.js");
  const { createSkillRegistryManager } = await import("../../../agent/skill-registry.js");
  const { SessionManager } = await import("../../../gateway/session-manager.js");
  const { getEventStream } = await import("../../../monitor/event-stream.js");
  const { emitAgentEvent } = await import("../../../monitor/agent-events.js");

  const logger = createLogger(
    currentConfig.logging?.level || "info",
    currentConfig.resolved.logFilePath,
    currentConfig.resolved.logFileLevel
  );

  if (currentConfig.ui.enabled) {
    const resolvedUiDir = currentConfig.resolved.uiStaticDir;
    const resolvedUiIndex = path.join(resolvedUiDir, "index.html");
    if (!fsSync.existsSync(resolvedUiIndex)) {
      const fallbackFromCwd = findUiDist(process.cwd());
      const fallbackFromSource = findUiDist(path.dirname(fileURLToPath(import.meta.url)));
      const fallback = fallbackFromCwd ?? fallbackFromSource;
      if (fallback) {
        logger.warn({ from: resolvedUiDir, to: fallback }, "UI static dir not found; using fallback");
        currentConfig = {
          ...currentConfig,
          resolved: {
            ...currentConfig.resolved,
            uiStaticDir: fallback,
          },
        };
      } else {
        logger.warn({ path: resolvedUiDir }, "UI static dir not found; web UI will return 404. Set ui.staticDir or workspaceDir.");
      }
    }
  }

  const router = new MessageRouter({
    logger,
    sessionOrdering: {
      enabled: true,
      maxConcurrentSessions: 3,
      queueTimeoutMs: 300_000,
    },
  });
  router.start();

  const whatsappEnabled = (process.env.ANT_WHATSAPP_ENABLED || "true").trim().toLowerCase() !== "false";
  const whatsapp =
    process.env.NODE_ENV === "test"
      ? new TestWhatsAppAdapter({ cfg: currentConfig, logger })
      : new WhatsAppAdapter({ cfg: currentConfig, logger });

  if (whatsappEnabled) {
    try {
      await whatsapp.start();
      router.registerAdapter(whatsapp);
      logger.info({ mode: process.env.NODE_ENV === "test" ? "test" : "live" }, "WhatsApp adapter registered");
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to start WhatsApp adapter");
    }
  } else {
    logger.info("WhatsApp disabled via ANT_WHATSAPP_ENABLED=false");
  }

  const telegramEnabled = (process.env.ANT_TELEGRAM_ENABLED || "true").trim().toLowerCase() !== "false";
  const isTestEnv = process.env.NODE_ENV === "test";
  const telegramConfigured = Boolean(currentConfig.telegram?.botToken?.trim());
  if (telegramEnabled && currentConfig.telegram?.enabled) {
    if (!isTestEnv && !telegramConfigured) {
      logger.warn("Telegram enabled but botToken is missing");
    } else {
      try {
        const telegram = isTestEnv
          ? new TestTelegramAdapter({ cfg: currentConfig, logger })
          : new TelegramAdapter({ cfg: currentConfig, logger });
        await telegram.start();
        router.registerAdapter(telegram);
        logger.info("Telegram adapter registered");
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to start Telegram adapter");
      }
    }
  } else if (!telegramEnabled) {
    logger.info("Telegram disabled via ANT_TELEGRAM_ENABLED=false");
  }

  const sessionManager = new SessionManager({
    stateDir: currentConfig.resolved.stateDir,
    logger,
  });

  const bridgeSend = (envelope: BridgeEnvelope) => {
    if (typeof process.send === "function") {
      process.send(envelope);
    }
  };

  const bridgeClient = new BridgeClient({
    send: bridgeSend,
    timeoutMs: currentConfig.runtime.worker.requestTimeoutMs,
    target: "worker",
    onEvent: (event) => {
      if (event.type === "monitor_event") {
        const payload = event.payload as any;
        if (payload && payload.type) {
          void getEventStream().publish(payload.type, payload.data, {
            sessionKey: payload.sessionKey,
            channel: payload.channel,
          });
        }
        return;
      }
      if (event.type === "agent_event") {
        const payload = event.payload as any;
        if (payload && payload.runId) {
          emitAgentEvent({
            runId: payload.runId,
            stream: payload.stream,
            data: payload.data,
            sessionKey: payload.sessionKey,
          });
        }
      }
    },
  });

  const bridgeServer = new BridgeServer({ target: "gateway", send: bridgeSend });

  const notifyOwners = async (message: string): Promise<void> => {
    const ownerJids = currentConfig.whatsapp?.ownerJids || [];
    const startupRecipients = currentConfig.whatsapp?.startupRecipients || [];
    const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;
    if (recipients.length === 0) return;
    if (!whatsapp.isConnected()) return;
    for (const jid of recipients) {
      try {
        await whatsapp.sendText(jid, message);
      } catch (err) {
        logger.debug({ error: err instanceof Error ? err.message : String(err), jid }, "Failed to notify owner");
      }
    }
  };

  bridgeServer.register("notifyOwners", async (payload) => {
    const message = payload && typeof (payload as any).message === "string" ? (payload as any).message : "";
    if (message) await notifyOwners(message);
    return { ok: true };
  });

  bridgeServer.register("message.send", async (payload) => {
    const sessionKey = payload && typeof (payload as any).sessionKey === "string" ? (payload as any).sessionKey : "";
    const jid = payload && typeof (payload as any).jid === "string" ? (payload as any).jid : "";
    const message = payload && typeof (payload as any).message === "string" ? (payload as any).message : "";
    if (sessionKey && message) {
      await router.sendToSession(sessionKey, message);
    } else if (jid && message) {
      const type = jid.endsWith("@g.us") ? "group" : "dm";
      await router.sendToSession(`whatsapp:${type}:${jid}`, message);
    }
    return { ok: true };
  });

  if (typeof process.on === "function") {
    process.on("message", (message: BridgeEnvelope) => {
      if (!message || (message as any).channel !== "bridge") return;
      bridgeClient.handleEnvelope(message);
      bridgeServer.handleEnvelope(message);
    });
  }

  const { buildReloadPlanFromConfigs, stripResolved, diffConfigPaths, buildReloadPlan } = await import("../../../config/reload-rules.js");
  const { createConfigWatcher } = await import("../../../config/watcher.js");

  let configWatcher: ConfigWatcher | null = null;
  let configReloadInFlight = false;
  let shutdownGateway: ((exitCode: number, reason: string) => Promise<void>) | null = null;

  const applyConfigChange = async (
    nextCfg: AntConfig,
    plan: ReloadPlan,
    source: "watcher" | "api" | "whatsapp"
  ): Promise<Record<string, unknown>> => {
    if (plan.changedPaths.length === 0) {
      return { ok: true, applied: false, requiresRestart: false, plan };
    }

    const header = `🔧 Config updated (${source})`;
    const details = plan.summary || plan.changedPaths.join(", ");

    if (plan.requiresRestart) {
      await notifyOwners(`${header}

${details}

Restart required. Restarting...`);
      if (shutdownGateway) {
        await shutdownGateway(42, "config_change");
      } else {
        process.exit(42);
      }
      return { ok: true, applied: false, requiresRestart: true, plan };
    }

    currentConfig = nextCfg;
    configWatcher?.setCurrent(nextCfg);
    gatewayServerRef?.setAntConfig(nextCfg);

    try {
      await bridgeClient.request("config.apply", { configPath: nextCfg.resolved.configPath });
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Worker config reload failed");
    }

    await notifyOwners(`${header}

${details}

Applied hot reload.`);
    return { ok: true, applied: true, requiresRestart: false, plan };
  };

  const reloadConfig = async (params: {
    changes?: Record<string, unknown>;
    dryRun?: boolean;
    source: "watcher" | "api" | "whatsapp";
  }): Promise<Record<string, unknown>> => {
    if (configReloadInFlight) {
      return { ok: false, error: "Config reload already in progress" };
    }
    configReloadInFlight = true;
    try {
      if (params.changes && Object.keys(params.changes).length > 0) {
        const disk = await loadConfig(currentConfig.resolved.configPath);
        const baseRaw = stripResolved(disk) as unknown as Record<string, unknown>;
        const mergedRaw = deepMerge(baseRaw, params.changes);
        const changed = diffConfigPaths(baseRaw, mergedRaw).filter((p) => p !== "<root>");
        const patchPlan = buildReloadPlan(changed);

        if (params.dryRun) {
          return {
            ok: true,
            dryRun: true,
            requiresRestart: patchPlan.requiresRestart,
            actions: patchPlan.actions,
            changedPaths: patchPlan.changedPaths,
            plan: patchPlan,
          };
        }

        await saveConfig(mergedRaw, currentConfig.resolved.configPath);
      }

      const nextCfg = await loadConfig(currentConfig.resolved.configPath);
      const plan = buildReloadPlanFromConfigs(currentConfig, nextCfg);
      return await applyConfigChange(nextCfg, plan, params.source);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn({ error }, "Config reload failed");
      return { ok: false, error };
    } finally {
      configReloadInFlight = false;
    }
  };

  let gatewayServerRef: any = null;

  router.setDefaultHandler(async (message) => {
    const startedAt = Date.now();
    try {
      const trimmed = (message.content ?? "").trim();
      if (/^\/queen\s+pause$/i.test(trimmed)) {
        await bridgeClient.request("mainAgent.pause");
        gatewayServerRef?.setMainAgentRunning(false);
        await router.sendToSession(message.context.sessionKey, "👑 Queen paused.");
        return null;
      }

      if (/^\/queen\s+resume$/i.test(trimmed)) {
        await bridgeClient.request("mainAgent.resume");
        gatewayServerRef?.setMainAgentRunning(true);
        await router.sendToSession(message.context.sessionKey, "👑 Queen resumed.");
        return null;
      }

      const configReloadMatch = /^\/config\s+reload$/i.exec(trimmed);
      if (configReloadMatch) {
        const result = await reloadConfig({ source: "whatsapp" });
        if (result.ok) {
          const plan = result.plan as ReloadPlan | undefined;
          await router.sendToSession(
            message.context.sessionKey,
            plan && plan.changedPaths.length > 0
              ? `🔧 Reloaded config.

${plan.summary}`
              : "🔧 Reloaded config (no changes)."
          );
        } else {
          await router.sendToSession(message.context.sessionKey, `❌ Config reload failed: ${(result as any).error}`);
        }
        return null;
      }

      const configSetMatch = /^\/config\s+set\s+([a-zA-Z0-9_.-]+)\s+(.+)$/i.exec(trimmed);
      if (configSetMatch) {
        const dotPath = configSetMatch[1]!;
        const valueRaw = configSetMatch[2]!;
        const value = parseConfigValue(valueRaw);
        const patch = buildPatchFromDotPath(dotPath, value);
        const result = await reloadConfig({ changes: patch, source: "whatsapp" });
        if (result.ok) {
          const plan = result.plan as ReloadPlan | undefined;
          await router.sendToSession(
            message.context.sessionKey,
            plan && plan.changedPaths.length > 0
              ? `🔧 Updated config: ${dotPath}

${plan.summary}`
              : `🔧 Updated config: ${dotPath}`
          );
        } else {
          await router.sendToSession(message.context.sessionKey, `❌ Config update failed: ${(result as any).error}`);
        }
        return null;
      }

      let history: Message[] = [];
      try {
        history = await buildSessionHistory({
          sessionManager,
          sessionKey: message.context.sessionKey,
          currentContent: message.content,
          currentTimestamp: message.timestamp,
        });
      } catch (err) {
        logger.debug({ error: err instanceof Error ? err.message : String(err), sessionKey: message.context.sessionKey }, "Failed to load session history");
      }

      const result = await bridgeClient.request("agent.execute", {
        input: {
          sessionKey: message.context.sessionKey,
          query: message.content,
          chatId: message.context.chatId,
          channel: message.channel,
          history,
        },
      });

      try {
        const toolParts = await sessionManager.listToolParts(message.context.sessionKey);
        const outboundMessages = collectToolOutboundMessages({ toolParts, startedAt });
        for (const outbound of outboundMessages) {
          await router.sendToSession(outbound.sessionKey, outbound.content, {
            metadata: {
              toolOutbound: outbound,
            },
          });
        }

        const attachments = collectToolMediaAttachments({ toolParts, startedAt });
        for (const attachment of attachments) {
          await router.sendToSession(message.context.sessionKey, attachment.caption ?? "", {
            media: {
              type: attachment.mediaType ?? "file",
              data: attachment.path,
              filename: path.basename(attachment.path),
            },
            metadata: {
              toolMedia: attachment,
            },
          });
        }
      } catch (err) {
        logger.warn({ error: err instanceof Error ? err.message : String(err), sessionKey: message.context.sessionKey }, "Failed to send tool media attachments");
      }

      await router.sendToSession(message.context.sessionKey, (result as any).response, {
        metadata: {
          providerId: (result as any).providerId,
          model: (result as any).model,
          runId: (result as any).runId,
          iterations: (result as any).iterations,
          toolsUsed: (result as any).toolsUsed,
        },
      });

      return {
        id: message.id,
        channel: message.channel,
        sender: { id: "agent", name: "Agent", isAgent: true },
        content: (result as any).response,
        context: message.context,
        timestamp: Date.now(),
        priority: message.priority,
        metadata: {
          providerId: (result as any).providerId,
          model: (result as any).model,
          runId: (result as any).runId,
        },
      };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionKey: message.context.sessionKey }, "Agent execution failed");
      throw error;
    }
  });

  const skillRegistry = createSkillRegistryManager({
    logger,
    workspaceDir: currentConfig.resolved.workspaceDir,
  });
  await skillRegistry.initialize();

  const server = new GatewayServer({
    config: {
      port: gatewayPort,
      host: gatewayHost,
      stateDir: currentConfig.resolved.stateDir,
      staticDir: currentConfig.resolved.uiStaticDir,
      logFilePath: currentConfig.resolved.logFilePath,
      configPath: currentConfig.resolved.configPath,
    },
    logger,
    antConfig: currentConfig,
    router,
    skillRegistry,
    toolRegistry: undefined,
    bridge: bridgeClient,
  });

  gatewayServerRef = server;

  server.setConfigReloadHandler(async ({ changes, dryRun }) => {
    return reloadConfig({ changes, dryRun, source: "api" });
  });

  await server.start();

  let heartbeatTimer: NodeJS.Timeout | null = null;
  const heartbeatIntervalMs = Math.max(
    1000,
    parseInt((process.env.ANT_HEARTBEAT_INTERVAL_MS || "5000").trim(), 10) || 5000
  );
  const heartbeatPath = path.join(currentConfig.resolved.stateDir, "heartbeat");
  let heartbeatInFlight = false;
  heartbeatTimer = setInterval(async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      const payload = {
        pid: process.pid,
        ts: Date.now(),
        uptimeMs: Math.round(process.uptime() * 1000),
      };
      const tmp = `${heartbeatPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(payload) + "\n", "utf-8");
      await fs.rename(tmp, heartbeatPath);
    } catch (err) {
      logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Failed to write heartbeat");
    } finally {
      heartbeatInFlight = false;
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  let stopTui: (() => void) | null = null;
  if (options.tui) {
    const { startTui } = await import("../../../runtime/tui.js");
    stopTui = await startTui({
      baseUrl: uiUrl,
      onExit: () => process.kill(process.pid, "SIGINT"),
    });
  }

  const configWatchEnabled =
    process.env.NODE_ENV !== "test" && (process.env.ANT_DISABLE_CONFIG_WATCHER || "").trim() !== "1";
  if (configWatchEnabled) {
    configWatcher = createConfigWatcher({
      initial: currentConfig,
      configPath: currentConfig.resolved.configPath,
      logger,
      debounceMs: 300,
      onChange: async ({ next, plan }) => {
        await applyConfigChange(next, plan, "watcher");
      },
    });
    configWatcher.start();
  } else {
    logger.info("Config watcher disabled");
  }

  out.success("Gateway started");
  if (cfg.ui.enabled) {
    out.info(`Web UI available at: ${uiUrl}`);
  }

  let shuttingDown = false;
  const shutdown = async (exitCode: number, reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    out.info(`
Shutting down gateway (${reason})...`);
    const timeout = setTimeout(() => {
      console.error("Shutdown timed out, forcing exit...");
      process.exit(1);
    }, 8000);
    timeout.unref();

    try {
      configWatcher?.stop();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      stopTui?.();
      await router.stop();
      await server.stop();
    } catch (err) {
      out.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await removePidFile(currentConfig, "gateway");
      clearTimeout(timeout);
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => void shutdown(0, "SIGINT"));
  process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));
  shutdownGateway = shutdown;

  await new Promise<void>(() => {});
}

async function startWorker(cfg: AntConfig, options: StartOptions): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  let currentConfig: AntConfig = cfg;

  await ensureRuntimePaths(cfg);

  if (typeof process.send !== "function") {
    throw new RuntimeError(
      "Worker requires supervisor IPC",
      "Run `ant run` to start the split runtime with a supervisor."
    );
  }

  const existingPid = await readPidFile(cfg, "worker");
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      throw new RuntimeError(
        `Worker is already running (PID: ${existingPid})`,
        "Use 'ant stop' to stop it first, or 'ant restart' to restart."
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw err;
      }
    }
  }

  out.info("Starting worker...");
  await writePidFile(cfg, "worker");

  const { createLogger } = await import("../../../log.js");
  const { createAgentEngine } = await import("../../../agent/engine.js");
  const { Scheduler } = await import("../../../scheduler/scheduler.js");
  const { SessionManager } = await import("../../../gateway/session-manager.js");
  const { MainAgent } = await import("../../../agent/main-agent.js");
  const { getEventStream } = await import("../../../monitor/event-stream.js");
  const { onAgentEvent } = await import("../../../monitor/agent-events.js");
  const { listActiveRuns } = await import("../../../agent/active-runs.js");
  const { buildReloadPlanFromConfigs } = await import("../../../config/reload-rules.js");

  const logger = createLogger(
    currentConfig.logging?.level || "info",
    currentConfig.resolved.logFilePath,
    currentConfig.resolved.logFileLevel
  );

  let heartbeatTimer: NodeJS.Timeout | null = null;
  const heartbeatIntervalMs = Math.max(1000, currentConfig.runtime.worker.heartbeatIntervalMs);
  let heartbeatInFlight = false;
  const writeWorkerHeartbeat = async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      const heartbeatPath = resolveWorkerHeartbeatPath(currentConfig);
      const payload = {
        pid: process.pid,
        ts: Date.now(),
        uptimeMs: Math.round(process.uptime() * 1000),
      };
      const tmp = `${heartbeatPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(payload) + "\n", "utf-8");
      await fs.rename(tmp, heartbeatPath);
    } catch (err) {
      logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to write worker heartbeat"
      );
    } finally {
      heartbeatInFlight = false;
    }
  };
  await writeWorkerHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeWorkerHeartbeat();
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  const sessionManager = new SessionManager({
    stateDir: currentConfig.resolved.stateDir,
    logger,
  });

  const bridgeSend = (envelope: BridgeEnvelope) => {
    if (typeof process.send === "function") {
      process.send(envelope);
    }
  };

  const gatewayClient = new BridgeClient({
    send: bridgeSend,
    timeoutMs: currentConfig.runtime.worker.requestTimeoutMs,
    target: "gateway",
  });

  const notifyOwners = async (message: string): Promise<void> => {
    if (!message) return;
    try {
      await gatewayClient.request("notifyOwners", { message });
    } catch {
      // ignore
    }
  };

  const memoryManager = currentConfig.memory.enabled
    ? new (await import("../../../memory/manager.js")).MemoryManager(currentConfig)
    : undefined;
  if (memoryManager) {
    await memoryManager.start();
    logger.info("Memory manager started");
  } else {
    logger.info("Memory manager disabled");
  }

  const agentEngine = await createAgentEngine({
    config: {
      maxHistoryTokens: currentConfig.agent.maxHistoryTokens,
      temperature: currentConfig.agent.temperature,
      maxToolIterations: currentConfig.agent.maxToolIterations,
      toolLoop: currentConfig.agent.toolLoop,
      compaction: currentConfig.agent.compaction,
      thinking: currentConfig.agent.thinking,
      toolPolicy: currentConfig.agent.toolPolicy,
      toolResultGuard: currentConfig.agent.toolResultGuard,
    },
    antConfig: currentConfig,
    providerConfig: {
      providers: currentConfig.resolved.providers.items as any,
      defaultProvider: currentConfig.resolved.providers.default,
      routing: currentConfig.resolved.routing,
      fallbackChain: currentConfig.resolved.providers.fallbackChain,
      allowCliToolCalls: currentConfig.cliTools.allowToolCalls,
    },
    logger,
    workspaceDir: currentConfig.resolved.workspaceDir,
    stateDir: currentConfig.resolved.stateDir,
    memorySearch: memoryManager ? async (query, max) => {
      const results = await memoryManager.search(query, { maxResults: max });
      return results.map((r) => r.snippet);
    } : undefined,
    memoryManager,
    toolPolicies: currentConfig.toolPolicies,
    sessionManager,
    notifyOwners,
  });

  const scheduler = (currentConfig.scheduler?.enabled ?? false)
    ? new Scheduler({
        stateDir: currentConfig.resolved.stateDir,
        logger,
        agentExecutor: createSchedulerAgentExecutor(agentEngine),
      })
    : undefined;

  if (scheduler) {
    await scheduler.start();
    logger.info("Scheduler started");
    const { initializeDroneFlights } = await import("../../../scheduler/drone-flights-init.js");
    await initializeDroneFlights(scheduler, logger, { emitEvents: true });
  } else {
    logger.info("Scheduler disabled");
  }

  const bridgeServer = new BridgeServer({ target: "worker", send: bridgeSend });

  // Register placeholders before wiring IPC so early gateway polls don't fail
  // while worker services are still initializing.
  bridgeServer.register("mainAgent.tasks", async () => []);
  bridgeServer.register("mainAgent.task", async () => null);
  bridgeServer.register("mainAgent.assign", async () => null);
  bridgeServer.register("mainAgent.pause", async () => ({ ok: true }));
  bridgeServer.register("mainAgent.resume", async () => ({ ok: true }));
  bridgeServer.register("mainAgent.status", async () => ({
    enabled: currentConfig.mainAgent?.enabled ?? true,
    running: false,
  }));
  bridgeServer.register("activeRuns.list", async () => []);

  if (typeof process.on === "function") {
    process.on("message", (message: BridgeEnvelope) => {
      if (!message || (message as any).channel !== "bridge") return;
      gatewayClient.handleEnvelope(message);
      bridgeServer.handleEnvelope(message);
    });
  }

  bridgeServer.register("agent.execute", async (payload) => {
    const input = payload && typeof payload === "object" && (payload as any).input ? (payload as any).input : payload;
    return agentEngine.execute(input as any);
  });

  bridgeServer.register("agent.hasHealthyProvider", async () => {
    return agentEngine.hasHealthyProvider();
  });

  bridgeServer.register("memory.search", async (payload) => {
    if (!memoryManager) return [];
    const query = payload && typeof (payload as any).query === "string" ? (payload as any).query : "";
    const options = (payload as any)?.options;
    return memoryManager.search(query, options);
  });

  bridgeServer.register("memory.stats", async () => {
    if (!memoryManager) {
      return { enabled: false, fileCount: 0, chunkCount: 0, lastRunAt: 0, categories: {}, totalSize: 0 };
    }
    const rawStats = memoryManager.getMemoryStats();
    return {
      enabled: rawStats.enabled,
      lastRunAt: Date.now(),
      fileCount: rawStats.fileCount,
      chunkCount: rawStats.chunkCount,
      totalSize: rawStats.totalTextBytes,
      categories: rawStats.categories,
    };
  });

  bridgeServer.register("memory.chunks", async (payload) => {
    if (!memoryManager) return [];
    const { limit, offset, category, source } = (payload as any) || {};
    return memoryManager.listMemoryChunks({ limit, offset, category, source });
  });

  bridgeServer.register("memory.countChunks", async (payload) => {
    if (!memoryManager) return 0;
    const { category, source } = (payload as any) || {};
    return memoryManager.countMemoryChunks({ category, source });
  });

  bridgeServer.register("memory.update", async (payload) => {
    if (!memoryManager) return { ok: false };
    const content = payload && typeof (payload as any).content === "string" ? (payload as any).content : "";
    if (content) {
      await memoryManager.update(content);
    }
    return { ok: true };
  });

  bridgeServer.register("memory.ready", async () => {
    return memoryManager ? memoryManager.isReady?.() ?? true : true;
  });

  bridgeServer.register("scheduler.list", async () => {
    return scheduler ? scheduler.listJobs() : [];
  });

  bridgeServer.register("scheduler.get", async (payload) => {
    if (!scheduler) return null;
    const id = payload && typeof (payload as any).id === "string" ? (payload as any).id : "";
    return scheduler.getJob(id);
  });

  bridgeServer.register("scheduler.toggle", async (payload) => {
    if (!scheduler) return null;
    const id = payload && typeof (payload as any).id === "string" ? (payload as any).id : "";
    const job = scheduler.getJob(id);
    if (!job) return null;
    if (job.enabled) {
      await scheduler.disableJob(id);
    } else {
      await scheduler.enableJob(id);
    }
    return scheduler.getJob(id);
  });

  bridgeServer.register("scheduler.run", async (payload) => {
    if (!scheduler) return null;
    const id = payload && typeof (payload as any).id === "string" ? (payload as any).id : "";
    return scheduler.runJob(id);
  });

  bridgeServer.register("scheduler.add", async (payload) => {
    if (!scheduler) return null;
    return scheduler.addJob(payload as any);
  });

  bridgeServer.register("scheduler.remove", async (payload) => {
    if (!scheduler) return false;
    const id = payload && typeof (payload as any).id === "string" ? (payload as any).id : "";
    return scheduler.removeJob(id);
  });

  const sendMessage = async (to: string, message: string) => {
    const target = (to || "").trim();
    if (!target || !message) return;
    try {
      if (target.includes(":")) {
        await gatewayClient.request("message.send", { sessionKey: target, message });
      } else {
        await gatewayClient.request("message.send", { jid: target, message });
      }
    } catch {
      // ignore
    }
  };

  const mainAgent = new MainAgent({
    config: currentConfig,
    agentEngine,
    logger,
    sendMessage,
    sessionManager,
  });

  const mainAgentEnabled = currentConfig.mainAgent?.enabled ?? true;
  if (mainAgentEnabled) {
    await mainAgent.start();
  }

  bridgeServer.register("mainAgent.tasks", async () => {
    return mainAgent.getAllTasks();
  });

  bridgeServer.register("mainAgent.task", async (payload) => {
    const id = payload && typeof (payload as any).id === "string" ? (payload as any).id : "";
    return mainAgent.getTask(id);
  });

  bridgeServer.register("mainAgent.assign", async (payload) => {
    const description = payload && typeof (payload as any).description === "string" ? (payload as any).description : "";
    if (!description) return null;
    return mainAgent.assignTask(description);
  });

  bridgeServer.register("mainAgent.pause", async () => {
    mainAgent.pause();
    return { ok: true };
  });

  bridgeServer.register("mainAgent.resume", async () => {
    mainAgent.resume();
    return { ok: true };
  });

  bridgeServer.register("mainAgent.status", async () => {
    return { enabled: currentConfig.mainAgent?.enabled ?? true, running: !mainAgent.isPaused() };
  });

  bridgeServer.register("activeRuns.list", async () => {
    return listActiveRuns();
  });

  bridgeServer.register("worker.health", async () => {
    const providersReady = await agentEngine.hasHealthyProvider().catch(() => false);
    return {
      ok: providersReady,
      providersReady,
      memoryReady: memoryManager ? memoryManager.isReady?.() ?? true : true,
      uptimeMs: Math.round(process.uptime() * 1000),
    };
  });

  bridgeServer.register("config.apply", async (payload) => {
    const configPath = payload && typeof (payload as any).configPath === "string" ? (payload as any).configPath : currentConfig.resolved.configPath;
    const nextCfg = await loadConfig(configPath);
    const plan = buildReloadPlanFromConfigs(currentConfig, nextCfg);
    if (plan.requiresRestart) {
      return { ok: false, requiresRestart: true, plan };
    }

    agentEngine.applyHotReload({
      maxHistoryTokens: nextCfg.agent.maxHistoryTokens,
      temperature: nextCfg.agent.temperature,
      maxToolIterations: nextCfg.agent.maxToolIterations,
      toolLoop: nextCfg.agent.toolLoop,
      compaction: nextCfg.agent.compaction,
      thinking: nextCfg.agent.thinking,
      toolPolicy: nextCfg.agent.toolPolicy,
      toolResultGuard: nextCfg.agent.toolResultGuard,
    });
    agentEngine.applyProviderRoutingHotReload(nextCfg.resolved.routing as any);
    agentEngine.applyProviderFallbackChainHotReload(nextCfg.resolved.providers.fallbackChain);
    agentEngine.applyToolPoliciesHotReload(nextCfg.toolPolicies);
    memoryManager?.applyQueryHotReload(nextCfg.memory.query);
    mainAgent.config = nextCfg;
    currentConfig = nextCfg;

    return { ok: true, plan };
  });

  const eventStream = getEventStream();
  const eventUnsub = eventStream.subscribeAll((event) => {
    bridgeServer.sendEvent("monitor_event", event);
  });
  const agentUnsub = onAgentEvent((event) => {
    bridgeServer.sendEvent("agent_event", event);
  });

  out.success("Worker started");

  let shuttingDown = false;
  const shutdown = async (exitCode: number, reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    out.info(`
Shutting down worker (${reason})...`);

    const timeout = setTimeout(() => {
      console.error("Shutdown timed out, forcing exit...");
      process.exit(1);
    }, 8000);
    timeout.unref();

    try {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      eventUnsub?.();
      agentUnsub?.();
      mainAgent.stop();
      await scheduler?.stop();
      memoryManager?.stop();
    } catch (err) {
      out.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await removePidFile(currentConfig, "worker");
      clearTimeout(timeout);
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => void shutdown(0, "SIGINT"));
  process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));

  await new Promise<void>(() => {});
}

export async function start(cfg: AntConfig, options: StartOptions = {}): Promise<void> {
  if (options.role === "gateway") {
    return startGateway(cfg, options);
  }
  if (options.role === "worker") {
    return startWorker(cfg, options);
  }
  if (cfg.runtime.mode === "split") {
    return startSupervised(cfg, options);
  }
  return startSingle(cfg, options);
}

/**
 * Start the agent runtime
 */
async function startSingle(cfg: AntConfig, options: StartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  let currentConfig: AntConfig = cfg;
  const gatewayHost = cfg.gateway?.host ?? cfg.ui.host;
  const gatewayPort = cfg.ui.enabled ? cfg.ui.port : (cfg.gateway?.port ?? cfg.ui.port);
  const uiUrl = cfg.ui.openUrl || `http://${gatewayHost}:${gatewayPort}`;

  // Ensure directories exist
  await ensureRuntimePaths(cfg);

  // Check if already running
  const existingPid = await readPidFile(cfg);
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      throw new RuntimeError(`Agent is already running (PID: ${existingPid})`, "Use 'ant stop' to stop it first, or 'ant restart' to restart.");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw err;
      }
      // Process doesn't exist, stale PID file
    }
  }

  out.info("Starting agent runtime...");

  if (options.detached) {
    // Start in background
    const args = ["start"];
    if (options.tui) args.push("--tui");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: "ignore",
      cwd: cfg.resolved.workspaceDir,
      env: {
        ...process.env,
        ANT_CONFIG: cfg.resolved.configPath,
      },
    });

    child.unref();
    out.success(`Agent started in background (PID: ${child.pid})`);

    if (cfg.ui.enabled) {
      out.info(`Web UI will be available at: ${uiUrl}`);
    }
  } else {
    // Start in foreground
    out.info("Starting in foreground mode...");

    // Write PID file
    await writePidFile(cfg);

    // Start the gateway server
    const { GatewayServer } = await import("../../../gateway/server.js");
    const { createLogger } = await import("../../../log.js");
    const { createAgentEngine } = await import("../../../agent/engine.js");
    const { MessageRouter, WhatsAppAdapter, TestWhatsAppAdapter, TelegramAdapter, TestTelegramAdapter } = await import("../../../channels/index.js");
    const { Scheduler } = await import("../../../scheduler/scheduler.js");
    const { createSkillRegistryManager } = await import("../../../agent/skill-registry.js");
    const { SessionManager } = await import("../../../gateway/session-manager.js");

    const logLevel = cfg.logging?.level || "info";
    const logger = createLogger(
      logLevel,
      cfg.resolved.logFilePath,
      cfg.resolved.logFileLevel
    );

    if (currentConfig.ui.enabled) {
      const resolvedUiDir = currentConfig.resolved.uiStaticDir;
      const resolvedUiIndex = path.join(resolvedUiDir, "index.html");
      if (!fsSync.existsSync(resolvedUiIndex)) {
        const fallbackFromCwd = findUiDist(process.cwd());
        const fallbackFromSource = findUiDist(path.dirname(fileURLToPath(import.meta.url)));
        const fallback = fallbackFromCwd ?? fallbackFromSource;
        if (fallback) {
          logger.warn({ from: resolvedUiDir, to: fallback }, "UI static dir not found; using fallback");
          currentConfig = {
            ...currentConfig,
            resolved: {
              ...currentConfig.resolved,
              uiStaticDir: fallback,
            },
          };
        } else {
          logger.warn(
            { path: resolvedUiDir },
            "UI static dir not found; web UI will return 404. Set ui.staticDir or workspaceDir."
          );
        }
      }
    }

    // Initialize Router
    const router = new MessageRouter({
      logger,
      sessionOrdering: {
        enabled: true,
        maxConcurrentSessions: 3,
        queueTimeoutMs: 300_000,
      },
    });
    router.start();

    // Initialize WhatsApp Adapter
    const whatsappEnabled =
      (process.env.ANT_WHATSAPP_ENABLED || "true").trim().toLowerCase() !== "false";
    const whatsapp =
      process.env.NODE_ENV === "test"
        ? new TestWhatsAppAdapter({ cfg, logger })
        : new WhatsAppAdapter({
            cfg,
            logger,
            // onStatusUpdate handled by adapter events/router
          });

    if (whatsappEnabled) {
      try {
        await whatsapp.start();
        router.registerAdapter(whatsapp);
        logger.info(
          { mode: process.env.NODE_ENV === "test" ? "test" : "live" },
          "WhatsApp adapter registered"
        );
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to start WhatsApp adapter"
        );
      }
    } else {
      logger.info("WhatsApp disabled via ANT_WHATSAPP_ENABLED=false");
    }

    // Initialize Telegram Adapter
    const telegramEnabled =
      (process.env.ANT_TELEGRAM_ENABLED || "true").trim().toLowerCase() !== "false";
    const isTestEnv = process.env.NODE_ENV === "test";
    const telegramConfigured = Boolean(currentConfig.telegram?.botToken?.trim());
    if (telegramEnabled && currentConfig.telegram?.enabled) {
      if (!isTestEnv && !telegramConfigured) {
        logger.warn("Telegram enabled but botToken is missing");
      } else {
        try {
          const telegram = isTestEnv
            ? new TestTelegramAdapter({ cfg: currentConfig, logger })
            : new TelegramAdapter({ cfg: currentConfig, logger });
          await telegram.start();
          router.registerAdapter(telegram);
          logger.info("Telegram adapter registered");
        } catch (err) {
          logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            "Failed to start Telegram adapter"
          );
        }
      }
    } else if (!telegramEnabled) {
      logger.info("Telegram disabled via ANT_TELEGRAM_ENABLED=false");
    }

    const sessionManager = new SessionManager({
      stateDir: cfg.resolved.stateDir,
      logger,
    });

    let memoryManager: any = null;

    const notifyOwners = async (message: string): Promise<void> => {
      const ownerJids = currentConfig.whatsapp?.ownerJids || [];
      const startupRecipients = currentConfig.whatsapp?.startupRecipients || [];
      const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;
      if (recipients.length === 0) return;
      if (!whatsapp.isConnected()) return;
      for (const jid of recipients) {
        try {
          await whatsapp.sendText(jid, message);
        } catch (err) {
          logger.debug(
            { error: err instanceof Error ? err.message : String(err), jid },
            "Failed to notify owner about config change"
          );
        }
      }
    };

    memoryManager = currentConfig.memory.enabled
      ? new (await import("../../../memory/manager.js")).MemoryManager(currentConfig)
      : undefined;
    if (!memoryManager) {
      logger.info("Memory manager disabled");
    } else {
      await memoryManager.start();
      logger.info("Memory manager started");
    }

    // Initialize Agent Engine
    const agentEngine = await createAgentEngine({
      config: {
        maxHistoryTokens: cfg.agent.maxHistoryTokens,
        temperature: cfg.agent.temperature,
        maxToolIterations: cfg.agent.maxToolIterations,
        toolLoop: cfg.agent.toolLoop,
        compaction: cfg.agent.compaction,
        thinking: cfg.agent.thinking,
        toolPolicy: cfg.agent.toolPolicy,
        toolResultGuard: cfg.agent.toolResultGuard,
      },
      antConfig: currentConfig,
      providerConfig: {
        providers: cfg.resolved.providers.items as any,
        defaultProvider: cfg.resolved.providers.default,
        routing: cfg.resolved.routing,
        fallbackChain: cfg.resolved.providers.fallbackChain,
        allowCliToolCalls: cfg.cliTools.allowToolCalls,
      },

      logger,
      workspaceDir: cfg.resolved.workspaceDir,
      stateDir: cfg.resolved.stateDir,
      memorySearch: memoryManager ? async (query, max) => {
        const results = await memoryManager.search(query, { maxResults: max });
        return results.map((r: any) => r.snippet);
      } : undefined,
      memoryManager,
      toolPolicies: cfg.toolPolicies,
      sessionManager,
      onProviderError: async (params) => {
        const errorMsg = params.retryingProvider
          ? `❌ ${params.failedProvider} failed: ${params.error}\n\n⏳ Trying ${params.retryingProvider}...`
          : `❌ ${params.failedProvider} failed: ${params.error}`;
        
        try {
          await router.sendToSession(params.sessionKey, errorMsg);
        } catch (err) {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err), sessionKey: params.sessionKey },
            "Failed to send provider error notification"
          );
        }
      },
      notifyOwners,
    });

    const { buildReloadPlanFromConfigs, stripResolved, diffConfigPaths, buildReloadPlan } = await import("../../../config/reload-rules.js");
    const { createConfigWatcher } = await import("../../../config/watcher.js");

    let configWatcher: ConfigWatcher | null = null;
    let configReloadInFlight = false;
    let shutdownRuntime: ((exitCode: number, reason: string) => Promise<void>) | null = null;

    const applyConfigChange = async (
      nextCfg: AntConfig,
      plan: ReloadPlan,
      source: "watcher" | "api" | "whatsapp"
    ): Promise<Record<string, unknown>> => {
      if (plan.changedPaths.length === 0) {
        return { ok: true, applied: false, requiresRestart: false, plan };
      }

      const header = `🔧 Config updated (${source})`;
      const details = plan.summary || plan.changedPaths.join(", ");

      if (plan.requiresRestart) {
        await notifyOwners(`${header}\n\n${details}\n\nRestart required. Restarting...`);
        const isSupervised = (process.env.ANT_SUPERVISED || "").trim() === "1";
        if (isSupervised) {
          if (shutdownRuntime) {
            await shutdownRuntime(42, "config_change");
          } else {
            process.exit(42);
          }
        } else {
          logger.warn(
            { changedPaths: plan.changedPaths },
            "Config change requires restart, but runtime is not supervised. Continuing until manual restart."
          );
        }
        return { ok: true, applied: false, requiresRestart: true, plan };
      }

      agentEngine.applyHotReload({
        maxHistoryTokens: nextCfg.agent.maxHistoryTokens,
        temperature: nextCfg.agent.temperature,
        maxToolIterations: nextCfg.agent.maxToolIterations,
        toolLoop: nextCfg.agent.toolLoop,
        compaction: nextCfg.agent.compaction,
        thinking: nextCfg.agent.thinking,
        toolPolicy: nextCfg.agent.toolPolicy,
        toolResultGuard: nextCfg.agent.toolResultGuard,
      });
      agentEngine.applyProviderRoutingHotReload(nextCfg.resolved.routing as any);
      agentEngine.applyProviderFallbackChainHotReload(nextCfg.resolved.providers.fallbackChain);
      agentEngine.applyToolPoliciesHotReload(nextCfg.toolPolicies);
      memoryManager?.applyQueryHotReload(nextCfg.memory.query);
      if (mainAgentRef) mainAgentRef.config = nextCfg;

      currentConfig = nextCfg;
      configWatcher?.setCurrent(nextCfg);
      gatewayServerRef?.setAntConfig(nextCfg);

      await notifyOwners(`${header}\n\n${details}\n\nApplied hot reload.`);
      return { ok: true, applied: true, requiresRestart: false, plan };
    };

    const reloadConfig = async (params: {
      changes?: Record<string, unknown>;
      dryRun?: boolean;
      source: "watcher" | "api" | "whatsapp";
    }): Promise<Record<string, unknown>> => {
      if (configReloadInFlight) {
        return { ok: false, error: "Config reload already in progress" };
      }
      configReloadInFlight = true;
      try {
        if (params.changes && Object.keys(params.changes).length > 0) {
          const disk = await loadConfig(currentConfig.resolved.configPath);
          const baseRaw = stripResolved(disk) as unknown as Record<string, unknown>;
          const mergedRaw = deepMerge(baseRaw, params.changes);
          const changed = diffConfigPaths(baseRaw, mergedRaw).filter((p) => p !== "<root>");
          const patchPlan = buildReloadPlan(changed);

          if (params.dryRun) {
            return {
              ok: true,
              dryRun: true,
              requiresRestart: patchPlan.requiresRestart,
              actions: patchPlan.actions,
              changedPaths: patchPlan.changedPaths,
              plan: patchPlan,
            };
          }

          await saveConfig(mergedRaw, currentConfig.resolved.configPath);
        }

        const nextCfg = await loadConfig(currentConfig.resolved.configPath);
        const plan = buildReloadPlanFromConfigs(currentConfig, nextCfg);
        return await applyConfigChange(nextCfg, plan, params.source);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.warn({ error }, "Config reload failed");
        return { ok: false, error };
      } finally {
        configReloadInFlight = false;
      }
    };

    let mainAgentRef: any = null;
    let gatewayServerRef: any = null;

    // Set up message routing from router to agent engine
    router.setDefaultHandler(async (message) => {
      const startedAt = Date.now();
      try {
        const trimmed = (message.content ?? "").trim();
        if (/^\/queen\s+pause$/i.test(trimmed)) {
          if (mainAgentRef) {
            mainAgentRef.pause();
            gatewayServerRef?.setMainAgentRunning(false);
            await router.sendToSession(message.context.sessionKey, "👑 Queen paused.");
            return null;
          }
          await router.sendToSession(message.context.sessionKey, "Queen is not running.");
          return null;
        }

        if (/^\/queen\s+resume$/i.test(trimmed)) {
          if (mainAgentRef) {
            mainAgentRef.resume();
            gatewayServerRef?.setMainAgentRunning(true);
            await router.sendToSession(message.context.sessionKey, "👑 Queen resumed.");
            return null;
          }
          await router.sendToSession(message.context.sessionKey, "Queen is not running.");
          return null;
        }

        const configReloadMatch = /^\/config\s+reload$/i.exec(trimmed);
        if (configReloadMatch) {
          const result = await reloadConfig({ source: "whatsapp" });
          if (result.ok) {
            const plan = result.plan as ReloadPlan | undefined;
            await router.sendToSession(
              message.context.sessionKey,
              plan && plan.changedPaths.length > 0
                ? `🔧 Reloaded config.\n\n${plan.summary}`
                : "🔧 Reloaded config (no changes)."
            );
          } else {
            await router.sendToSession(message.context.sessionKey, `❌ Config reload failed: ${(result as any).error}`);
          }
          return null;
        }

        const configSetMatch = /^\/config\s+set\s+([a-zA-Z0-9_.-]+)\s+(.+)$/i.exec(trimmed);
        if (configSetMatch) {
          const dotPath = configSetMatch[1]!;
          const valueRaw = configSetMatch[2]!;
          const value = parseConfigValue(valueRaw);
          const patch = buildPatchFromDotPath(dotPath, value);
          const result = await reloadConfig({ changes: patch, source: "whatsapp" });
          if (result.ok) {
            const plan = result.plan as ReloadPlan | undefined;
            await router.sendToSession(
              message.context.sessionKey,
              plan && plan.changedPaths.length > 0
                ? `🔧 Updated config: ${dotPath}\n\n${plan.summary}`
                : `🔧 Updated config: ${dotPath}`
            );
          } else {
            await router.sendToSession(message.context.sessionKey, `❌ Config update failed: ${(result as any).error}`);
          }
          return null;
        }

        let history: Message[] = [];
        try {
          history = await buildSessionHistory({
            sessionManager,
            sessionKey: message.context.sessionKey,
            currentContent: message.content,
            currentTimestamp: message.timestamp,
          });
        } catch (err) {
          logger.debug(
            { error: err instanceof Error ? err.message : String(err), sessionKey: message.context.sessionKey },
            "Failed to load session history"
          );
        }

        const result = await agentEngine.execute({
          sessionKey: message.context.sessionKey,
          query: message.content,
          chatId: message.context.chatId,
          channel: message.channel,
          history,
        });

        try {
          const toolParts = await sessionManager.listToolParts(message.context.sessionKey);
          const outboundMessages = collectToolOutboundMessages({ toolParts, startedAt });
          for (const outbound of outboundMessages) {
            await router.sendToSession(outbound.sessionKey, outbound.content, {
              metadata: {
                toolOutbound: outbound,
              },
            });
          }

          const attachments = collectToolMediaAttachments({ toolParts, startedAt });
          for (const attachment of attachments) {
            await router.sendToSession(message.context.sessionKey, attachment.caption ?? "", {
              media: {
                type: attachment.mediaType ?? "file",
                data: attachment.path,
                filename: path.basename(attachment.path),
              },
              metadata: {
                toolMedia: attachment,
              },
            });
          }
        } catch (err) {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err), sessionKey: message.context.sessionKey },
            "Failed to send tool media attachments"
          );
        }

        // Send response back through the router
        logger.info({
          sessionKey: message.context.sessionKey,
          responseLength: result.response?.length || 0,
          responsePreview: result.response?.slice(0, 200) || "(empty)",
          providerId: result.providerId,
          model: result.model,
          iterations: result.iterations,
          toolsUsed: result.toolsUsed,
        }, "Sending response to session");
        await router.sendToSession(message.context.sessionKey, result.response, {
          metadata: {
            providerId: result.providerId,
            model: result.model,
            runId: result.runId,
            iterations: result.iterations,
            toolsUsed: result.toolsUsed,
          },
        });

        return {
          id: message.id,
          channel: message.channel,
          sender: { id: "agent", name: "Agent", isAgent: true },
          content: result.response,
          context: message.context,
          timestamp: Date.now(),
          priority: message.priority,
          metadata: {
            providerId: result.providerId,
            model: result.model,
            runId: result.runId,
          },
        };
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), sessionKey: message.context.sessionKey },
          "Agent execution failed"
        );
        throw error;
      }
    });

    logger.info("Agent handler registered with message router");

    // Initialize Scheduler
    const scheduler = (currentConfig.scheduler?.enabled ?? false)
      ? new Scheduler({
          stateDir: currentConfig.resolved.stateDir,
          logger,
          agentExecutor: createSchedulerAgentExecutor(agentEngine),
        })
      : undefined;
    if (!scheduler) {
      logger.info("Scheduler disabled");
    } else {
      await scheduler.start();
      logger.info("Scheduler started");
    }

    // Initialize Skill Registry
    const skillRegistry = createSkillRegistryManager({
      logger,
      workspaceDir: currentConfig.resolved.workspaceDir,
    });
    await skillRegistry.initialize();
    logger.info("Skill registry initialized");

    // Initialize Gateway Server first (so UI is available immediately)
    const { MainAgent } = await import("../../../agent/main-agent.js");
    
	    const server = new GatewayServer({
      config: {
        port: gatewayPort,
        host: gatewayHost,
        stateDir: currentConfig.resolved.stateDir,
        staticDir: currentConfig.resolved.uiStaticDir,
        logFilePath: currentConfig.resolved.logFilePath,
        configPath: currentConfig.resolved.configPath,
      },
      logger,
      antConfig: currentConfig,
      agentEngine,
      router,
	      memoryManager,
	      scheduler,
      skillRegistry,
      toolRegistry: agentEngine.getToolRegistry(),
    });

    server.setConfigReloadHandler(async ({ changes, dryRun }) => {
      return reloadConfig({ changes, dryRun, source: "api" });
    });

    const mainAgent = new MainAgent({
      config: currentConfig,
      agentEngine,
      logger,
      sendMessage: async (jid: string, message: string) => {
        // Send message via WhatsApp adapter
        if (whatsapp.isConnected()) {
          await whatsapp.sendText(jid, message);
        }
      },
      sessionManager: server.getSessionManager(),
    });

    mainAgentRef = mainAgent;
    gatewayServerRef = server;

    // Set mainAgent on server after creation
    server.setMainAgent(mainAgent);

    await server.start();

    let heartbeatTimer: NodeJS.Timeout | null = null;
    const heartbeatIntervalMs = Math.max(
      1000,
      parseInt((process.env.ANT_HEARTBEAT_INTERVAL_MS || "5000").trim(), 10) || 5000
    );
    const heartbeatPath = path.join(currentConfig.resolved.stateDir, "heartbeat");
    let heartbeatInFlight = false;
    heartbeatTimer = setInterval(async () => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      try {
        const payload = {
          pid: process.pid,
          ts: Date.now(),
          uptimeMs: Math.round(process.uptime() * 1000),
        };
        const tmp = `${heartbeatPath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(payload) + "\n", "utf-8");
        await fs.rename(tmp, heartbeatPath);
      } catch (err) {
        logger.debug(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to write heartbeat"
        );
      } finally {
        heartbeatInFlight = false;
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();

    let stopTui: (() => void) | null = null;
    if (options.tui) {
      const { startTui } = await import("../../../runtime/tui.js");
      stopTui = await startTui({
        baseUrl: uiUrl,
        onExit: () => process.kill(process.pid, "SIGINT"),
      });
    }

    const mainAgentEnabled = cfg.mainAgent?.enabled ?? true;
    server.setMainAgentRunning(mainAgentEnabled);

    // Start the Main Agent autonomous loop
    if (mainAgentEnabled) {
      await mainAgent.start();
    }

    configWatcher = createConfigWatcher({
      initial: currentConfig,
      configPath: currentConfig.resolved.configPath,
      logger,
      debounceMs: 300,
      onChange: async ({ next, plan }) => {
        await applyConfigChange(next, plan, "watcher");
      },
    });

    out.success("Agent runtime started");
    if (cfg.ui.enabled) {
      out.info(`Web UI available at: ${uiUrl}`);
    }

    let shuttingDown = false;
    const shutdown = async (exitCode: number, reason: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      out.info(`\nShutting down (${reason})...`);

      // Safety timeout - force exit after 8s if cleanup hangs
      const timeout = setTimeout(() => {
        console.error("Shutdown timed out, forcing exit...");
        process.exit(1);
      }, 8000);
      timeout.unref();

      try {
        configWatcher?.stop();
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        stopTui?.();
        mainAgent.stop();
        server.setMainAgentRunning(false);
        await router.stop();
        await server.stop();
        await scheduler?.stop();
        memoryManager?.stop();
      } catch (err) {
        out.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await removePidFile(currentConfig);
        clearTimeout(timeout);
        process.exit(exitCode);
      }
    };

    shutdownRuntime = shutdown;

    const configWatchEnabled =
      process.env.NODE_ENV !== "test" && (process.env.ANT_DISABLE_CONFIG_WATCHER || "").trim() !== "1";
    if (configWatchEnabled) {
      configWatcher.start();
    } else {
      logger.info("Config watcher disabled");
    }

    process.on("SIGINT", () => void shutdown(0, "SIGINT"));
    process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));

    // Keep running until interrupted
    await new Promise<void>(() => {});

  }
}

export default start;
