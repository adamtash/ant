/**
 * CLI Channel Adapter
 *
 * Provides a terminal interface for interacting with the agent.
 * Supports interactive REPL mode and single-command execution.
 */

import * as readline from "node:readline";
import { stdin, stdout } from "node:process";

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";
import { CLISessionManager, type CLISession } from "./session-manager.js";

// ============================================================================
// Configuration
// ============================================================================

export interface CLIAdapterConfig extends BaseAdapterConfig {
  /** Session persistence directory */
  sessionPersistDir?: string;

  /** Prompt string */
  prompt?: string;

  /** Whether to run in interactive mode */
  interactive?: boolean;

  /** User info */
  user?: {
    id: string;
    name: string;
  };

  /** Callback for agent responses */
  onAgentResponse?: (response: NormalizedMessage) => void;
}

// ============================================================================
// CLI Adapter
// ============================================================================

export class CLIAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "cli";

  private readonly sessionManager: CLISessionManager;
  private readonly prompt: string;
  private readonly interactive: boolean;
  private readonly user: { id: string; name: string };
  private readonly onAgentResponse?: (response: NormalizedMessage) => void;

  private rl: readline.Interface | null = null;
  private currentSession: CLISession | null = null;

  constructor(config: CLIAdapterConfig) {
    super(config);

    this.sessionManager = new CLISessionManager({
      logger: this.logger,
      persistDir: config.sessionPersistDir,
    });

    this.prompt = config.prompt ?? "> ";
    this.interactive = config.interactive ?? true;
    this.user = config.user ?? {
      id: process.env.USER ?? "cli-user",
      name: process.env.USER ?? "CLI User",
    };
    this.onAgentResponse = config.onAgentResponse;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    this.logger.info("Starting CLI adapter...");

    // Load persisted sessions
    await this.sessionManager.loadSessions();

    // Create or restore session
    this.currentSession = this.sessionManager.getOrCreateSession(undefined, this.user);

    if (this.interactive) {
      this.startInteractiveMode();
    }

    this.setConnected(true);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping CLI adapter...");

    // Save sessions
    await this.sessionManager.saveAllSessions();

    // Close readline interface
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.setConnected(false, "stopped");
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  async sendMessage(
    message: NormalizedMessage,
    _options?: SendMessageOptions
  ): Promise<SendResult> {
    try {
      // Format and output the message
      const output = this.formatOutputMessage(message);
      console.log(output);

      // Call response callback if set
      this.onAgentResponse?.(message);

      return {
        ok: true,
        messageId: this.generateMessageId(),
        timestamp: Date.now(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const input = rawMessage as { text: string; sessionKey?: string };

    if (!input.text || typeof input.text !== "string") {
      return null;
    }

    const text = input.text.trim();
    if (!text) return null;

    const sessionKey = input.sessionKey ?? this.currentSession?.sessionKey ?? "cli:default";

    return this.createNormalizedMessage({
      content: text,
      sender: {
        id: this.user.id,
        name: this.user.name,
        isAgent: false,
      },
      context: {
        sessionKey,
      },
      priority: "normal",
      rawMessage: input,
    });
  }

  protected formatOutgoing(message: NormalizedMessage): string {
    return message.content;
  }

  // ==========================================================================
  // Interactive Mode
  // ==========================================================================

  private startInteractiveMode(): void {
    this.rl = readline.createInterface({
      input: stdin,
      output: stdout,
      prompt: this.prompt,
    });

    // Handle line input
    this.rl.on("line", (line) => {
      const text = line.trim();

      if (!text) {
        this.rl?.prompt();
        return;
      }

      // Handle special commands
      if (this.handleSpecialCommand(text)) {
        this.rl?.prompt();
        return;
      }

      // Add to history
      if (this.currentSession) {
        this.sessionManager.addToHistory(this.currentSession.sessionKey, text);
      }

      // Process the input as a message
      this.handleIncomingMessage({ text, sessionKey: this.currentSession?.sessionKey });
    });

    // Handle close
    this.rl.on("close", () => {
      this.logger.info("CLI session closed");
      this.emitEvent({ type: "disconnected", reason: "user_exit" });
    });

    // Show initial prompt
    console.log("ANT CLI - Type your message or /help for commands");
    this.rl.prompt();
  }

  /**
   * Handle special CLI commands
   */
  private handleSpecialCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const [cmd, ...args] = text.slice(1).split(/\s+/);

    switch (cmd.toLowerCase()) {
      case "help":
        this.showHelp();
        return true;

      case "clear":
        console.clear();
        return true;

      case "history":
        this.showHistory();
        return true;

      case "session":
        this.showSessionInfo();
        return true;

      case "new":
        this.startNewSession();
        return true;

      case "exit":
      case "quit":
        this.rl?.close();
        return true;

      default:
        console.log(`Unknown command: /${cmd}. Type /help for available commands.`);
        return true;
    }
  }

  private showHelp(): void {
    console.log(`
Available commands:
  /help     - Show this help message
  /clear    - Clear the screen
  /history  - Show input history
  /session  - Show current session info
  /new      - Start a new session
  /exit     - Exit the CLI
`);
  }

  private showHistory(): void {
    if (!this.currentSession) {
      console.log("No active session");
      return;
    }

    const history = this.sessionManager.getHistory(this.currentSession.sessionKey);
    if (history.length === 0) {
      console.log("No history");
      return;
    }

    console.log("Input history:");
    history.slice(-20).forEach((entry, i) => {
      console.log(`  ${i + 1}. ${entry}`);
    });
  }

  private showSessionInfo(): void {
    if (!this.currentSession) {
      console.log("No active session");
      return;
    }

    const session = this.currentSession;
    console.log(`
Session Info:
  Key: ${session.sessionKey}
  Created: ${new Date(session.createdAt).toISOString()}
  Last Activity: ${new Date(session.lastActivity).toISOString()}
  Messages: ${session.messageCount}
  History: ${session.inputHistory.length} entries
`);
  }

  private startNewSession(): void {
    this.currentSession = this.sessionManager.getOrCreateSession(undefined, this.user);
    console.log(`New session started: ${this.currentSession.sessionKey}`);
  }

  // ==========================================================================
  // Non-Interactive Mode
  // ==========================================================================

  /**
   * Process a single input (for non-interactive use)
   */
  async processInput(text: string, sessionKey?: string): Promise<void> {
    const session =
      this.sessionManager.getSession(sessionKey ?? "") ??
      this.sessionManager.getOrCreateSession(sessionKey, this.user);

    this.sessionManager.addToHistory(session.sessionKey, text);

    this.handleIncomingMessage({ text, sessionKey: session.sessionKey });
  }

  /**
   * Get the current session
   */
  getCurrentSession(): CLISession | null {
    return this.currentSession;
  }

  /**
   * Get the session manager
   */
  getSessionManager(): CLISessionManager {
    return this.sessionManager;
  }

  // ==========================================================================
  // Output Formatting
  // ==========================================================================

  private formatOutputMessage(message: NormalizedMessage): string {
    const lines: string[] = [];

    // Add sender info if not agent
    if (!message.sender.isAgent) {
      lines.push(`[${message.sender.name}]`);
    }

    // Add content
    lines.push(message.content);

    // Add media info if present
    if (message.media) {
      lines.push(`[Media: ${message.media.type}${message.media.filename ? ` - ${message.media.filename}` : ""}]`);
    }

    return lines.join("\n");
  }

  /**
   * Show the prompt (for external use after async operations)
   */
  showPrompt(): void {
    this.rl?.prompt();
  }
}
