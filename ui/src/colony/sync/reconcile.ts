import { useColonyStore } from "../../stores/colonyStore";
import type { StatusResponse, SystemEvent } from "../../api/types";
import type { ChamberType } from "../../utils/biology";
import type { Vector2D } from "../../utils/vector";
import type { Ant } from "../entities/Ant";

const ENTITY_GRACE_MS = 15_000;
const ERROR_TTL_MS = 60_000;

const lastSeenAt = new Map<string, number>();

function makeKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function findAntByEntity(state: ReturnType<typeof useColonyStore.getState>, entityType: string, entityId: string): Ant | undefined {
  for (const ant of state.ants.values()) {
    if (ant.entityType === entityType && ant.entityId === entityId) return ant;
  }
  return undefined;
}

function randomPositionInChamber(state: ReturnType<typeof useColonyStore.getState>, chamberType: ChamberType): Vector2D | null {
  let chamber = undefined as any;
  for (const [, c] of state.chambers) {
    if (c.type === chamberType) {
      chamber = c;
      break;
    }
  }
  if (!chamber) return null;

  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * chamber.radius * 0.7;
  return {
    x: chamber.position.x + Math.cos(angle) * distance,
    y: chamber.position.y + Math.sin(angle) * distance,
  };
}

export function reconcileColonyFromStatus(status: StatusResponse, opts: { now?: number } = {}): void {
  const now = opts.now ?? Date.now();
  const colony = useColonyStore.getState();

  const desired = new Set<string>();

  for (const run of status.running ?? []) {
    const id = run.chatId || run.sessionKey;
    if (!id) continue;
    const key = makeKey("task", id);
    desired.add(key);
    lastSeenAt.set(key, now);

    const existing = findAntByEntity(colony, "task", id);
    if (!existing) {
      colony.spawnEntityAnt(id, "task", "forager", "foraging");
    } else if (run.status === "running") {
      existing.setState("exploring");
    } else {
      existing.setState("idle");
    }
  }

  for (const sub of status.subagents ?? []) {
    const id = sub.id;
    if (!id) continue;
    const key = makeKey("subagent", id);
    desired.add(key);
    lastSeenAt.set(key, now);

    const existing = findAntByEntity(colony, "subagent", id);
    if (!existing) {
      colony.spawnEntityAnt(id, "subagent", "worker", "nursery");
    } else if (sub.status === "running") {
      existing.setState("exploring");
    } else if (sub.status === "retrying") {
      existing.setState("alarmed");
    } else {
      existing.setState("idle");
    }
  }

  cleanupStaleEntities(colony, desired, now);
}

export function noteErrorEvent(event: SystemEvent, opts: { now?: number } = {}): void {
  const now = opts.now ?? Date.now();
  const colony = useColonyStore.getState();

  const errorId = event.id || `error-${event.timestamp || now}`;
  const key = makeKey("error", errorId);
  lastSeenAt.set(key, now);

  const existing = findAntByEntity(colony, "error", errorId);
  if (!existing) {
    colony.spawnEntityAnt(errorId, "error", "soldier", "war");
  }

  const severity =
    event.severity === "critical"
      ? "critical"
      : event.severity === "error"
      ? "high"
      : event.severity === "warn"
      ? "medium"
      : "low";

  const pos = randomPositionInChamber(colony, "war") ?? { x: 0, y: 0 };
  colony.createAlarm(pos, severity);

  cleanupStaleEntities(colony, new Set<string>(), now);
}

function cleanupStaleEntities(
  colony: ReturnType<typeof useColonyStore.getState>,
  desired: Set<string>,
  now: number
): void {
  const removeIds: string[] = [];

  for (const ant of colony.ants.values()) {
    if (!ant.entityType || !ant.entityId) continue;

    if (ant.entityType === "task" || ant.entityType === "subagent") {
      const key = makeKey(ant.entityType, ant.entityId);
      if (desired.has(key)) continue;
      const last = lastSeenAt.get(key);
      if (last === undefined) {
        lastSeenAt.set(key, now);
        continue;
      }
      if (now - last > ENTITY_GRACE_MS) {
        removeIds.push(ant.id);
        lastSeenAt.delete(key);
      }
    }

    if (ant.entityType === "error") {
      const key = makeKey("error", ant.entityId);
      const last = lastSeenAt.get(key);
      if (last !== undefined && now - last > ERROR_TTL_MS) {
        removeIds.push(ant.id);
        lastSeenAt.delete(key);
      }
    }
  }

  for (const antId of removeIds) {
    colony.removeAnt(antId);
  }
}

