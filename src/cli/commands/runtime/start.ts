/**
 * Runtime Start Command - Start the agent runtime
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, saveConfig, type AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, writePidFile, removePidFile, ensureRuntimePaths } from "../../../gateway/process-control.js";
import type { AgentEngine } from "../../../agent/engine.js";
import type { AgentExecutor } from "../../../scheduler/types.js";
import { collectToolMediaAttachments } from "../../../utils/tool-media.js";
import { collectToolOutboundMessages } from "../../../utils/tool-outbound.js";
import type { ReloadPlan } from "../../../config/reload-rules.js";
import type { ConfigWatcher } from "../../../config/watcher.js";

export interface StartOptions {
  config?: string;
  tui?: boolean;
  detached?: boolean;
  quiet?: boolean;
}

export function createSchedulerAgentExecutor(agentEngine: AgentEngine): AgentExecutor {
  return async (params) => {
    const result = await agentEngine.execute({
      sessionKey: params.sessionKey,
      query: params.query,
      channel: "web",
      cronContext: params.cronContext,
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

/**
 * Start the agent runtime
 */
export async function start(cfg: AntConfig, options: StartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  let currentConfig: AntConfig = cfg;
  const gatewayHost = cfg.gateway?.host ?? cfg.ui.host;
  const gatewayPort = cfg.gateway?.port ?? cfg.ui.port;
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
    const { MessageRouter, WhatsAppAdapter, TestWhatsAppAdapter } = await import("../../../channels/index.js");
    const { Scheduler } = await import("../../../scheduler/scheduler.js");
    const { createSkillRegistryManager } = await import("../../../agent/skill-registry.js");
    const { SessionManager } = await import("../../../gateway/session-manager.js");

    const logLevel = cfg.logging?.level || "info";
    const logger = createLogger(
      logLevel,
      cfg.resolved.logFilePath,
      cfg.resolved.logFileLevel
    );

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

    const sessionManager = new SessionManager({
      stateDir: cfg.resolved.stateDir,
      logger,
    });

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
    });

    const { buildReloadPlanFromConfigs, stripResolved, diffConfigPaths, buildReloadPlan } = await import("../../../config/reload-rules.js");
    const { createConfigWatcher } = await import("../../../config/watcher.js");

    let configWatcher: ConfigWatcher | null = null;
    let configReloadInFlight = false;
    let shutdownRuntime: ((exitCode: number, reason: string) => Promise<void>) | null = null;

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
        if (shutdownRuntime) {
          await shutdownRuntime(42, "config_change");
        } else {
          process.exit(42);
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
    let memoryManager: any = null;

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

        const result = await agentEngine.execute({
          sessionKey: message.context.sessionKey,
          query: message.content,
          chatId: message.context.chatId,
          channel: message.channel,
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
                type: "file",
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

    // Initialize Memory Manager
    memoryManager = currentConfig.memory.enabled
      ? new (await import("../../../memory/manager.js")).MemoryManager(currentConfig)
      : undefined;
    if (!memoryManager) {
      logger.info("Memory manager disabled");
    } else {
      await memoryManager.start();
      logger.info("Memory manager started");
    }

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
