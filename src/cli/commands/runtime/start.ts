/**
 * Runtime Start Command - Start the agent runtime
 */

import { spawn } from "node:child_process";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, writePidFile, removePidFile, ensureRuntimePaths } from "../../../gateway/process-control.js";

export interface StartOptions {
  config?: string;
  tui?: boolean;
  detached?: boolean;
  quiet?: boolean;
}

/**
 * Start the agent runtime
 */
export async function start(cfg: AntConfig, options: StartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
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
    const { MessageRouter, WhatsAppAdapter } = await import("../../../channels/index.js");
    const { MemoryManager } = await import("../../../memory/manager.js");
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
    const whatsapp = new WhatsAppAdapter({
      cfg,
      logger,
      // onStatusUpdate handled by adapter events/router
    });

    if (process.env.NODE_ENV === "test") {
      router.registerAdapter(whatsapp);
      logger.info("WhatsApp adapter registered (test mode)");
    } else {
      try {
        await whatsapp.start();
        router.registerAdapter(whatsapp);
        logger.info("WhatsApp adapter registered");
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to start WhatsApp adapter"
        );
      }
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

    // Set up message routing from router to agent engine
    router.setDefaultHandler(async (message) => {
      try {
        const result = await agentEngine.execute({
          sessionKey: message.context.sessionKey,
          query: message.content,
          chatId: message.context.chatId,
          channel: message.channel,
        });

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
        await router.sendToSession(message.context.sessionKey, result.response);

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
    const memoryManager = new MemoryManager(cfg);
    if (process.env.NODE_ENV === "test" && !cfg.memory.enabled) {
      logger.info("Memory manager skipped (test mode)");
    } else {
      await memoryManager.start();
      logger.info("Memory manager started");
    }

    // Initialize Scheduler
    const scheduler = new Scheduler({
      stateDir: cfg.resolved.stateDir,
      logger,
      agentExecutor: async (params) => {
        const result = await agentEngine.execute({
          sessionKey: params.sessionKey,
          query: params.cronContext.jobName,
          channel: "web",
          cronContext: params.cronContext,
        });
        return { response: result.response, error: result.error };
      },
    });
    await scheduler.start();
    logger.info("Scheduler started");

    // Initialize Skill Registry
    const skillRegistry = createSkillRegistryManager({
      logger,
      workspaceDir: cfg.resolved.workspaceDir,
    });
    await skillRegistry.initialize();
    logger.info("Skill registry initialized");

    // Initialize Gateway Server first (so UI is available immediately)
    const { MainAgent } = await import("../../../agent/main-agent.js");
    
    const server = new GatewayServer({
      config: {
        port: gatewayPort,
        host: gatewayHost,
        stateDir: cfg.resolved.stateDir,
        staticDir: cfg.resolved.uiStaticDir,
        logFilePath: cfg.resolved.logFilePath,
        configPath: cfg.resolved.configPath,
      },
      logger,
      agentEngine,
      router,
      memoryManager,
      scheduler,
      skillRegistry,
      toolRegistry: agentEngine.getToolRegistry(),
    });

    const mainAgent = new MainAgent({
      config: cfg,
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

    // Set mainAgent on server after creation
    server.setMainAgent(mainAgent);

    await server.start();

    const mainAgentEnabled = cfg.mainAgent?.enabled ?? true;
    server.setMainAgentRunning(mainAgentEnabled);

    // Start the Main Agent autonomous loop
    if (mainAgentEnabled) {
      await mainAgent.start();
    }

    out.success("Agent runtime started");
    if (cfg.ui.enabled) {
      out.info(`Web UI available at: ${uiUrl}`);
    }

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        out.info("\nShutting down...");
        
        // Safety timeout - force exit after 5s if cleanup hangs
        const timeout = setTimeout(() => {
          console.error("Shutdown timed out, forcing exit...");
          process.exit(1);
        }, 5000);
        timeout.unref();

        try {
          mainAgent.stop();
          server.setMainAgentRunning(false);
          await router.stop();
          await server.stop();
          scheduler.stop();
          memoryManager.stop();
        } catch (err) {
          out.error(`Error during shutdown: ${err}`);
        } finally {
          await removePidFile(cfg);
          clearTimeout(timeout);
          process.exit(0);
        }
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  }
}

export default start;
