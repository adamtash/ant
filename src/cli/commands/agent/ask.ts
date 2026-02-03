/**
 * Agent Ask Command - Ask the agent a one-off question
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError } from "../../error-handler.js";

export interface AskOptions {
  config?: string;
  session?: string;
  json?: boolean;
  quiet?: boolean;
}

interface AskResponse {
  response: string;
  toolsUsed: string[];
  duration: number;
}

/**
 * Ask the agent a one-off question
 */
export async function ask(cfg: AntConfig, prompt: string, options: AskOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!prompt?.trim()) {
    throw new ValidationError("Prompt cannot be empty", 'Provide a prompt: ant ask "your question"');
  }

  // Check if runtime is available
  if (!cfg.ui.enabled) {
    // Use direct agent call if UI is disabled
    return askDirect(cfg, prompt, options);
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
  const sessionKey = options.session || "cli-ask";

  const stopProgress = out.progress("Thinking...");

  try {
    const startTime = Date.now();

    const res = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.trim(),
        sessionKey,
      }),
    });

    stopProgress();

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Agent request failed: ${error}`);
    }

    const data = (await res.json()) as AskResponse;
    const duration = Date.now() - startTime;

    if (options.json) {
      out.json({
        response: data.response,
        toolsUsed: data.toolsUsed || [],
        duration,
      });
      return;
    }

    out.newline();
    out.box(data.response, "Response");

    if (data.toolsUsed?.length > 0) {
      out.section("Tools Used");
      for (const tool of data.toolsUsed) {
        out.listItem(tool);
      }
    }

    out.newline();
    out.info(`Completed in ${out.formatDuration(duration)}`);
  } catch (err) {
    stopProgress();

    if (err instanceof RuntimeError) throw err;

    // Connection refused - runtime not running
    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

/**
 * Ask directly without runtime (for debug mode)
 */
async function askDirect(cfg: AntConfig, prompt: string, options: AskOptions): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  out.info("Runtime not available, using direct agent call...");

  const stopProgress = out.progress("Thinking...");

  try {
    const startTime = Date.now();

    // Create an agent engine directly
    const { createAgentEngine } = await import("../../../agent/engine.js");
    const { createLogger } = await import("../../../log.js");
    const { SessionManager } = await import("../../../gateway/session-manager.js");

    const logger = createLogger("info");

    // Convert provider config to the format expected by createAgentEngine
    const providerConfig = {
      providers: cfg.resolved.providers.items as Record<string, {
        type: "openai" | "cli" | "ollama";
        cliProvider?: "codex" | "copilot" | "claude";
        baseUrl?: string;
        apiKey?: string;
        model: string;
        authProfiles?: Array<{ apiKey: string; label?: string; cooldownMinutes?: number }>;
        healthCheckTimeoutMs?: number;
        healthCheckCacheTtlMinutes?: number;
      }>,
      defaultProvider: cfg.resolved.providers.default,
      routing: cfg.resolved.routing,
      fallbackChain: cfg.resolved.providers.fallbackChain,
      allowCliToolCalls: cfg.cliTools.allowToolCalls,
    };

    const sessionManager = new SessionManager({
      stateDir: cfg.resolved.stateDir,
      logger,
    });

    const engine = await createAgentEngine({
      config: {
        temperature: 0.7,
        maxToolIterations: 6,
        maxHistoryTokens: 8192,
        toolLoop: cfg.agent.toolLoop,
        compaction: cfg.agent.compaction,
        thinking: cfg.agent.thinking,
        toolPolicy: cfg.agent.toolPolicy,
        toolResultGuard: cfg.agent.toolResultGuard,
      },
      providerConfig,
      logger,
      workspaceDir: cfg.resolved.workspaceDir,
      stateDir: cfg.resolved.stateDir,
      toolPolicies: cfg.toolPolicies,
      sessionManager,
      onProviderError: async (params) => {
        const errorMsg = params.retryingProvider
          ? `\n⚠️  ${params.failedProvider} failed: ${params.error}\n→ Trying ${params.retryingProvider}...\n`
          : `\n⚠️  ${params.failedProvider} failed: ${params.error}\n`;
        process.stderr.write(errorMsg);
      },
    });

    const result = await engine.execute({
      query: prompt,
      sessionKey: "cli-direct",
      channel: "cli",
    });

    stopProgress();

    const duration = Date.now() - startTime;

    if (options.json) {
      out.json({
        response: result.response,
        toolsUsed: result.toolsUsed || [],
        duration,
      });
      return;
    }

    out.newline();
    out.box(result.response, "Response");

    if (result.toolsUsed?.length > 0) {
      out.section("Tools Used");
      for (const tool of result.toolsUsed) {
        out.listItem(tool);
      }
    }

    out.newline();
    out.info(`Completed in ${out.formatDuration(duration)}`);
  } catch (err) {
    stopProgress();
    throw err;
  }
}

export default ask;
