/**
 * Process Control - Manage agent runtime processes
 *
 * This module provides utilities for managing the agent runtime lifecycle:
 * - PID file management
 * - Process start/stop/restart
 * - Runtime paths
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../config.js";

/**
 * Runtime paths configuration
 */
export type RuntimeRole = "supervisor" | "gateway" | "worker" | "single";

export interface RuntimePaths {
  stateDir: string;
  sessionDir: string;
  logsDir: string;
  pidFile: string;
  jobsFile: string;
  memorySqlite: string;
}

/**
 * Get the PID file path
 */
function getPidFilePath(cfg: AntConfig, role?: RuntimeRole): string {
  const base = cfg.resolved.stateDir;
  if (!role || role === "single") return path.join(base, "ant.pid");
  if (role === "supervisor") return path.join(base, "ant.supervisor.pid");
  if (role === "gateway") return path.join(base, "ant.gateway.pid");
  if (role === "worker") return path.join(base, "ant.worker.pid");
  return path.join(base, "ant.pid");
}

async function writePidFileAt(pathname: string, pid: number): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, String(pid), "utf-8");
}

/**
 * Ensure all runtime directories exist
 */
export async function ensureRuntimePaths(cfg: AntConfig): Promise<RuntimePaths> {
  const stateDir = cfg.resolved.stateDir;
  const sessionDir = path.join(stateDir, "sessions");
  const logsDir = path.join(stateDir, "logs");

  // Create directories
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  return {
    stateDir,
    sessionDir,
    logsDir,
    pidFile: getPidFilePath(cfg),
    jobsFile: path.join(stateDir, "jobs.json"),
    memorySqlite: cfg.resolved.memorySqlitePath,
  };
}

/**
 * Read the PID from the PID file
 */
export async function readPidFile(cfg: AntConfig, role?: RuntimeRole): Promise<number | null> {
  try {
    const pidFile = getPidFilePath(cfg, role);
    const content = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Write the current PID to the PID file
 */
export async function writePidFile(cfg: AntConfig, role?: RuntimeRole): Promise<void> {
  await ensureRuntimePaths(cfg);
  if (role === "supervisor") {
    await writePidFileAt(getPidFilePath(cfg, "supervisor"), process.pid);
    await writePidFileAt(getPidFilePath(cfg), process.pid);
    return;
  }
  if (role && role !== "single") {
    await writePidFileAt(getPidFilePath(cfg, role), process.pid);
    return;
  }
  await writePidFileAt(getPidFilePath(cfg), process.pid);
}

/**
 * Remove the PID file
 */
export async function removePidFile(cfg: AntConfig, role?: RuntimeRole): Promise<void> {
  try {
    if (role) {
      await fs.unlink(getPidFilePath(cfg, role));
      if (role === "supervisor") {
        await fs.unlink(getPidFilePath(cfg)).catch(() => undefined);
      }
      return;
    }
    await fs.unlink(getPidFilePath(cfg));
  } catch {
    // File doesn't exist
  }
}

/**
 * Check if the agent is running
 */
export async function isRunning(cfg: AntConfig): Promise<boolean> {
  const pids = await readRuntimePids(cfg);
  const values = Object.values(pids).filter((pid): pid is number => typeof pid === "number");
  for (const pid of values) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export async function readRuntimePids(cfg: AntConfig): Promise<{
  primary?: number | null;
  supervisor?: number | null;
  gateway?: number | null;
  worker?: number | null;
}> {
  const [primary, supervisor, gateway, worker] = await Promise.all([
    readPidFile(cfg),
    readPidFile(cfg, "supervisor"),
    readPidFile(cfg, "gateway"),
    readPidFile(cfg, "worker"),
  ]);
  return { primary, supervisor, gateway, worker };
}

/**
 * Stop the running agent
 */
export async function stopAnt(cfg: AntConfig): Promise<boolean> {
  const pids = await readRuntimePids(cfg);
  const supervisorPid = pids.supervisor ?? pids.primary ?? null;
  const targets: Array<{ pid: number; role: RuntimeRole | "primary" }> = [];

  if (supervisorPid) {
    targets.push({ pid: supervisorPid, role: "supervisor" });
  } else {
    if (pids.gateway) targets.push({ pid: pids.gateway, role: "gateway" });
    if (pids.worker) targets.push({ pid: pids.worker, role: "worker" });
  }

  if (targets.length === 0) return false;

  for (const target of targets) {
    try {
      process.kill(target.pid, "SIGTERM");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        continue;
      }
      return false;
    }
  }

  const maxWait = 10_000;
  const checkInterval = 500;
  let waited = 0;

  while (waited < maxWait) {
    let alive = false;
    for (const target of targets) {
      try {
        process.kill(target.pid, 0);
        alive = true;
      } catch {
        // not alive
      }
    }
    if (!alive) {
      await removePidFile(cfg).catch(() => undefined);
      await removePidFile(cfg, "supervisor").catch(() => undefined);
      await removePidFile(cfg, "gateway").catch(() => undefined);
      await removePidFile(cfg, "worker").catch(() => undefined);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    waited += checkInterval;
  }

  for (const target of targets) {
    try {
      process.kill(target.pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  await removePidFile(cfg).catch(() => undefined);
  await removePidFile(cfg, "supervisor").catch(() => undefined);
  await removePidFile(cfg, "gateway").catch(() => undefined);
  await removePidFile(cfg, "worker").catch(() => undefined);
  return true;
}

/**
 * Restart the running agent (stop then signal for restart)
 */
export async function restartAnt(cfg: AntConfig): Promise<boolean> {
  const pids = await readRuntimePids(cfg);
  const supervisorPid = pids.supervisor ?? pids.primary ?? null;
  const targetPid = supervisorPid ?? pids.gateway ?? pids.worker ?? null;
  if (!targetPid) return false;

  try {
    process.kill(targetPid, "SIGHUP");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get runtime state directory
 */
export function getStateDir(cfg: AntConfig): string {
  return cfg.resolved.stateDir;
}

/**
 * Get session storage directory
 */
export function getSessionDir(cfg: AntConfig): string {
  return path.join(cfg.resolved.stateDir, "sessions");
}
