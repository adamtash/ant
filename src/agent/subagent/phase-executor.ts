import type { AgentEngine } from "../engine.js";
import type { Logger } from "../../log.js";
import type { TaskEntry, TaskResult, TaskPhase } from "../task/types.js";
import type { PhaseDefinition } from "./execution-phases.js";
import { TaskStore } from "../task/task-store.js";

interface PhaseExecutionResult {
  phase: TaskPhase;
  output: string;
  toolsUsed: string[];
  iterations: number;
  providerId?: string;
  model?: string;
}

export class PhaseExecutor {
  private readonly agentEngine: AgentEngine;
  private readonly logger: Logger;
  private readonly taskStore: TaskStore;

  constructor(params: { agentEngine: AgentEngine; logger: Logger; taskStore: TaskStore }) {
    this.agentEngine = params.agentEngine;
    this.logger = params.logger.child({ component: "phase-executor" });
    this.taskStore = params.taskStore;
  }

  async execute(task: TaskEntry, phases: PhaseDefinition[]): Promise<TaskResult> {
    let planText = "";
    let lastOutput = "";
    let toolsUsed: string[] = [];
    let iterations = 0;
    let providerId: string | undefined;
    let model: string | undefined;

    for (const phase of phases) {
      await this.taskStore.updatePhase(task.taskId, phase.name);
      await this.taskStore.updateProgress(task.taskId, {
        completed: phases.indexOf(phase),
        total: phases.length,
        lastUpdate: Date.now(),
      });

      const prompt = this.buildPhasePrompt(task.description, phase, planText, lastOutput);
      this.logger.info(
        {
          taskId: task.taskId,
          phase: phase.name,
          promptPreview: prompt.slice(0, 300),
        },
        "Executing subagent phase"
      );

      const result = await this.agentEngine.execute({
        sessionKey: task.sessionKey,
        query: prompt,
        channel: task.metadata.channel,
        chatId: task.sessionKey,
        isSubagent: true,
        toolPolicy: task.lane === "maintenance" ? "investigation" : undefined,
      });

      lastOutput = result.response;
      toolsUsed = [...new Set([...toolsUsed, ...result.toolsUsed])];
      iterations += result.iterations;
      providerId = result.providerId;
      model = result.model;

      if (phase.name === "planning") {
        planText = result.response;
      }
    }

    await this.taskStore.updateProgress(task.taskId, {
      completed: phases.length,
      total: phases.length,
      lastUpdate: Date.now(),
      message: "completed",
    });

    return {
      content: lastOutput,
      toolsUsed,
      iterations,
      providerId,
      model,
    };
  }

  private buildPhasePrompt(
    description: string,
    phase: PhaseDefinition,
    planText: string,
    lastOutput: string
  ): string {
    const planSection = planText ? `\n\nPLAN FROM PREVIOUS PHASE:\n${planText}\n` : "";
    const lastSection = lastOutput ? `\n\nPREVIOUS OUTPUT:\n${lastOutput}\n` : "";

    return `${phase.systemPrompt}\n\nTASK: ${description}${planSection}${lastSection}\n\nPHASE: ${phase.name.toUpperCase()}`;
  }
}
