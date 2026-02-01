import fs from "node:fs/promises";
import path from "node:path";
import { type AntConfig } from "../config.js";
import { type AgentEngine } from "./engine.js";
import { type Logger } from "../log.js";

export class MainAgent {
  private config: AntConfig;
  private agentEngine: AgentEngine;
  private logger: Logger;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  
  constructor(params: {
    config: AntConfig;
    agentEngine: AgentEngine;
    logger: Logger;
  }) {
    this.config = params.config;
    this.agentEngine = params.agentEngine;
    this.logger = params.logger.child({ component: "main-agent" });
  }

  async start() {
    // Check if mainAgent is enabled (Zod supplies default true based on schema change)
    if (!this.config.mainAgent?.enabled) {
      this.logger.info("Main Agent disabled");
      return;
    }

    this.running = true;
    this.logger.info("Main Agent loop started");
    // Run immediately
    this.runCycle();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.logger.info("Main Agent loop stopped");
  }

  private async runCycle() {
    if (!this.running) return;

    try {
      this.logger.debug("Starting Main Agent duty cycle");
      
      const dutiesFile = this.config.mainAgent.dutiesFile || "AGENT_DUTIES.md";
      const dutiesPath = path.join(this.config.resolved.workspaceDir, dutiesFile);
      
      let duties = "";
      try {
        duties = await fs.readFile(dutiesPath, "utf-8");
      } catch {
        // Fallback: try relative to config file (project root usually)
        const configDir = path.dirname(this.config.resolved.configPath);
        const fallbackPath = path.join(configDir, dutiesFile);
        try {
            duties = await fs.readFile(fallbackPath, "utf-8");
            this.logger.debug({ path: fallbackPath }, "Found duties in config dir");
        } catch {
            this.logger.warn({ path: dutiesPath }, "Duties file not found, skipping cycle");
            this.scheduleNext_();
            return;
        }
      }

      await this.agentEngine.execute({

        query: `Execute your duties as the Main Agent.
        
Current Duties:
${duties}

Perform necessary checks and actions. If no actions are needed, simply report status.
Output <promise>DUTY_CYCLE_COMPLETE</promise> when finished.
`,
        sessionKey: "main-agent:system",
        chatId: "system",
        channel: "cli",
      });



      this.logger.info("Main Agent duty cycle complete");

    } catch (err) {
      this.logger.error({ error: err }, "Main Agent cycle failed");
    }
    
    this.scheduleNext_();
  }

  private scheduleNext_() {
    if (this.running) {
      const interval = this.config.mainAgent.intervalMs || 60000;
      this.timer = setTimeout(() => this.runCycle(), interval);
    }
  }
}
