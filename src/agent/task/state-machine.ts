import type { TaskState } from "./types.js";

const LEGAL_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ["queued", "canceled"],
  queued: ["running", "failed", "canceled"],
  running: ["succeeded", "failed", "canceled", "retrying"],
  retrying: ["queued", "failed", "canceled"],
  failed: ["retrying", "failed", "canceled"],
  succeeded: [],
  canceled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}
