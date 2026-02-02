import type { TaskPhase } from "../task/types.js";

export interface PhaseDefinition {
  name: TaskPhase;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
}

export const DEFAULT_SUBAGENT_PHASES: PhaseDefinition[] = [
  {
    name: "planning",
    systemPrompt: "You are a planning subagent. Produce a concise, ordered plan.",
    tools: ["memory_search"],
    maxIterations: 2,
  },
  {
    name: "executing",
    systemPrompt: "You are an execution subagent. Follow the plan and use tools as needed.",
    tools: ["file", "system", "memory_search"],
    maxIterations: 6,
  },
  {
    name: "verifying",
    systemPrompt: "You are a verification subagent. Verify results and summarize outcomes.",
    tools: ["file", "system"],
    maxIterations: 2,
  },
];
