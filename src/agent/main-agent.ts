/**
 * Main Agent - Autonomous Supervisor
 *
 * Features:
 * - Self-directed investigation and problem-solving
 * - Automatic testing and verification
 * - Self-improvement through code analysis
 * - Continuous monitoring and maintenance
 * - Startup health checks with WhatsApp reporting
 */

import fs from "node:fs/promises";
import path from "node:path";
import { type AntConfig } from "../config.js";
import { type AgentEngine } from "./engine.js";
import { type Logger } from "../log.js";
import { type SessionManager } from "../gateway/session-manager.js";

export interface MainAgentTask {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
  result?: string;
}

export interface MainAgentSendMessage {
  (jid: string, message: string): Promise<void>;
}

export class MainAgent {
  private config: AntConfig;
  private agentEngine: AgentEngine;
  private logger: Logger;
  private sendMessage?: MainAgentSendMessage;
  private sessionManager?: SessionManager;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private tasks: Map<string, MainAgentTask> = new Map();
  private currentTask: MainAgentTask | null = null;
  private startupHealthCheckDone = false;
  
  constructor(params: {
    config: AntConfig;
    agentEngine: AgentEngine;
    logger: Logger;
    sendMessage?: MainAgentSendMessage;
    sessionManager?: SessionManager;
  }) {
    this.config = params.config;
    this.agentEngine = params.agentEngine;
    this.sendMessage = params.sendMessage;
    this.sessionManager = params.sessionManager;
    this.logger = params.logger.child({ component: "main-agent" });
  }

  async start() {
    if (!this.config.mainAgent?.enabled) {
      this.logger.info("Main Agent disabled");
      return;
    }

    this.running = true;
    this.logger.info("Main Agent loop started - Autonomous mode enabled");
    
    // Send startup message to WhatsApp
    await this.sendStartupMessage();
    
    // Run startup health check first, then start the regular cycle
    await this.runStartupHealthCheck();
    
    // Run regular cycle
    this.runCycle();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.logger.info("Main Agent loop stopped");
  }

  /**
   * Send startup notification to WhatsApp owner
   */
  private async sendStartupMessage(): Promise<void> {
    const ownerJids = this.config.whatsapp?.ownerJids || [];
    const startupRecipients = this.config.whatsapp?.startupRecipients || [];
    const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;

    if (recipients.length === 0 || !this.sendMessage) {
      this.logger.debug("No WhatsApp recipients configured for startup message");
      return;
    }

    const message = "🤖 *Queen Ant Started*\n\nAutonomous work mode is now active!";

    for (const jid of recipients) {
      try {
        await this.sendMessage(jid, message);
        this.logger.info({ jid }, "Startup message sent to owner");
      } catch (err) {
        this.logger.warn({ error: err, jid }, "Failed to send startup message to owner");
      }
    }
  }
  private async runStartupHealthCheck(): Promise<void> {
    if (this.startupHealthCheckDone) return;
    
    this.logger.info("Running startup health check...");
    
    const ownerJids = this.config.whatsapp?.ownerJids || [];
    const startupRecipients = this.config.whatsapp?.startupRecipients || [];
    const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;
    
    try {
      const duties = await this.loadDuties();
      
      const result = await this.agentEngine.execute({
        query: `You are the Main Agent running a STARTUP HEALTH CHECK.

Perform a comprehensive system health check and report the status:

HEALTH CHECK ITEMS:
1. **System Status**: Check if all components are running
   - Gateway server
   - WhatsApp connection  
   - Agent engine
   - Memory system

2. **Diagnostics**: Run system diagnostics
   - Check disk usage in .ant/ directory
   - Review recent logs for errors
   - Verify provider connectivity

3. **Test Basic Operations**:
   - Try a simple memory search to verify embeddings
   - Check if tools are accessible

4. **Summary Report**: Provide a concise health report with:
   - ✅ Working components
   - ⚠️ Warnings (if any)
   - ❌ Issues found (if any)

FORMAT YOUR RESPONSE FOR WHATSAPP:
Keep it concise and readable. Use emoji indicators.
Example:
🤖 *Startup Health Check*

✅ Gateway: Running
✅ WhatsApp: Connected
✅ Agent Engine: Ready
⚠️ Memory: 234 MB (12% usage)

System is healthy and ready!`,
        sessionKey: "main-agent:startup-health",
        chatId: "system",
        channel: "cli",
      });

      // Persist the health check response
      await this.persistMessage("main-agent:startup-health", "assistant", result.response, result.providerId, result.model);

      this.startupHealthCheckDone = true;
      
      // Send results to WhatsApp owner if configured
      if (recipients.length > 0 && this.sendMessage) {
        const message = result.response || "🤖 Startup health check completed.";
        
        for (const jid of recipients) {
          try {
            await this.sendMessage(jid, message);
            this.logger.info({ jid }, "Startup health check sent to owner");
          } catch (err) {
            this.logger.warn({ error: err, jid }, "Failed to send health check to owner");
          }
        }
      } else {
        this.logger.info("No WhatsApp recipients configured for startup health check");
      }
      
    } catch (err) {
      this.logger.error({ error: err }, "Startup health check failed");
      
      // Send error notification to owner
      if (recipients.length > 0 && this.sendMessage) {
        const errorMessage = `🤖 *Startup Health Check*\n\n❌ Health check failed:\n${err instanceof Error ? err.message : String(err)}`;
        
        for (const jid of recipients) {
          try {
            await this.sendMessage(jid, errorMessage);
          } catch {
            // Ignore send errors
          }
        }
      }
    }
  }

  /**
   * Assign a new task to the Main Agent
   */
  async assignTask(description: string): Promise<string> {
    const taskId = `task-${Date.now()}`;
    const task: MainAgentTask = {
      id: taskId,
      description,
      status: "pending",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.logger.info({ taskId, description }, "New task assigned to Main Agent");
    
    // Trigger immediate cycle if not busy
    if (!this.currentTask) {
      this.runCycle();
    }
    
    return taskId;
  }

  /**
   * Get task status
   */
  getTask(taskId: string): MainAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): MainAgentTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Persist a message to session storage
   */
  private async persistMessage(sessionKey: string, role: "user" | "assistant", content: string, providerId?: string, model?: string): Promise<void> {
    if (!this.sessionManager) return;
    
    try {
      await this.sessionManager.appendMessage(sessionKey, {
        role,
        content,
        timestamp: Date.now(),
        providerId,
        model,
      });
    } catch (err) {
      this.logger.warn({ error: err, sessionKey }, "Failed to persist Main Agent message");
    }
  }

  private async runCycle() {
    if (!this.running) return;

    try {
      this.logger.debug("Starting Main Agent duty cycle");
      
      // Check for pending tasks first
      const pendingTask = this.getNextPendingTask();
      
      if (pendingTask) {
        await this.executeTask(pendingTask);
      } else {
        // Run autonomous duties
        await this.runAutonomousDuties();
      }

    } catch (err) {
      this.logger.error({ error: err }, "Main Agent cycle failed");
    }
    
    this.scheduleNext_();
  }

  private getNextPendingTask(): MainAgentTask | null {
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        return task;
      }
    }
    return null;
  }

  private async executeTask(task: MainAgentTask) {
    this.currentTask = task;
    task.status = "in_progress";
    
    this.logger.info({ taskId: task.id }, "Executing task");

    try {
      const duties = await this.loadDuties();
      
      const result = await this.agentEngine.execute({
        query: `You are the Main Agent. Execute this assigned task autonomously:

TASK: ${task.description}

Follow this approach:
1. INVESTIGATE: Analyze the problem thoroughly
2. PLAN: Determine the best solution approach
3. EXECUTE: Implement the fix or solution
4. TEST: Verify the solution works
5. REPORT: Document what was done

Available tools:
- read: Read files to understand code
- write: Write or modify files
- exec: Run commands (tests, builds, etc.)
- ls: List directory contents
- memory_search: Search for relevant context

Current Duties Context:
${duties}

Work autonomously. If you need to make changes:
- Read relevant files first
- Make minimal, focused changes
- Test your changes
- Report results

Output <promise>TASK_COMPLETE</promise> when finished.
Output <promise>NEEDS_HELP</promise> if you need human assistance.`,
        sessionKey: `main-agent:task:${task.id}`,
        chatId: "system",
        channel: "cli",
      });

      // Persist the task result
      const sessionKey = `main-agent:task:${task.id}`;
      await this.persistMessage(sessionKey, "assistant", result.response, result.providerId, result.model);

      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result.response;
      
      this.logger.info({ taskId: task.id }, "Task completed");

    } catch (err) {
      task.status = "failed";
      task.completedAt = Date.now();
      task.result = err instanceof Error ? err.message : String(err);
      
      this.logger.error({ taskId: task.id, error: err }, "Task failed");
    } finally {
      this.currentTask = null;
    }
  }

  private async runAutonomousDuties() {
    const duties = await this.loadDuties();
    
    const result = await this.agentEngine.execute({
      query: `Execute your duties as the Autonomous Main Agent.

PHILOSOPHY: Work like an expert software engineer - investigate, fix, test, iterate.

Current Duties:
${duties}

AUTONOMOUS WORKFLOW:
1. CHECK: Run diagnostics to find issues
   - Check logs for errors
   - Test endpoints
   - Verify WhatsApp connectivity

2. INVESTIGATE: If issues found
   - Read relevant code
   - Analyze root cause
   - Search memory for context

3. FIX: Implement solution
   - Make minimal changes
   - Follow existing patterns
   - Update tests if needed

4. TEST: Verify the fix
   - Run tests
   - Check functionality
   - Confirm resolution

5. IMPROVE: Look for enhancements
   - Code quality improvements
   - Performance optimizations
   - Better error handling

6. REPORT: Log actions taken
   - What was checked
   - What was found
   - What was done
   - Results

You have full autonomy. Use tools to:
- Read/write files
- Execute commands (npm run build, npm test, etc.)
- Search memory
- Run diagnostics

Output <promise>DUTY_CYCLE_COMPLETE</promise> when finished.
Output <promise>ISSUES_FOUND</promise> if you found and fixed issues.`,
      sessionKey: "main-agent:system",
      chatId: "system",
      channel: "cli",
    });

    // Persist the autonomous duty cycle result
    await this.persistMessage("main-agent:system", "assistant", result.response, result.providerId, result.model);

    this.logger.info("Main Agent duty cycle complete");
  }

  private async loadDuties(): Promise<string> {
    const dutiesFile = this.config.mainAgent.dutiesFile || "AGENT_DUTIES.md";
    const dutiesPath = path.join(this.config.resolved.workspaceDir, dutiesFile);
    
    try {
      return await fs.readFile(dutiesPath, "utf-8");
    } catch {
      // Fallback: try relative to config file
      const configDir = path.dirname(this.config.resolved.configPath);
      const fallbackPath = path.join(configDir, dutiesFile);
      try {
        return await fs.readFile(fallbackPath, "utf-8");
      } catch {
        this.logger.debug("Using default duties");
        return this.getDefaultDuties();
      }
    }
  }

  private scheduleNext_() {
    if (this.running) {
      const interval = this.config.mainAgent.intervalMs || 60000;
      this.timer = setTimeout(() => this.runCycle(), interval);
    }
  }

  /**
   * Get default duties when AGENT_DUTIES.md is not found
   */
  private getDefaultDuties(): string {
    return `# Autonomous Main Agent Duties

## System Health Monitoring

1. Run diagnostics: \`ant diagnostics test-all\`
2. Check logs for errors and warnings
3. Verify all services are running:
   - Gateway HTTP API
   - WhatsApp connection
   - Agent engine
4. Monitor resource usage (memory, CPU)

## Self-Improvement Loop

1. Review recent error patterns in logs
2. Identify flaky tests or failures
3. Look for code quality issues
4. Check for outdated dependencies
5. Optimize slow operations

## Proactive Maintenance

1. Clean up old session data (>30 days)
2. Archive completed tasks
3. Update memory indexes
4. Verify backup systems
5. Check disk space

## Investigation Protocol

When issues are found:
1. Read relevant source files
2. Check test coverage
3. Analyze error patterns
4. Search memory for similar issues
5. Propose and implement fixes
6. Test the solution
7. Document the resolution

## Autonomous Actions

You are empowered to:
- Read any file in the project
- Write fixes to source files
- Run tests and builds
- Execute diagnostics
- Search memory and logs
- Create new tasks for complex issues

Always:
- Make minimal, focused changes
- Follow existing code patterns
- Test before declaring success
- Report what you did and why
`;
  }
}
