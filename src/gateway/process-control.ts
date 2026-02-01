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
function getPidFilePath(cfg: AntConfig): string {
  return path.join(cfg.resolved.stateDir, "ant.pid");
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
export async function readPidFile(cfg: AntConfig): Promise<number | null> {
  try {
    const pidFile = getPidFilePath(cfg);
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
export async function writePidFile(cfg: AntConfig): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  await fs.writeFile(paths.pidFile, String(process.pid), "utf-8");
}

/**
 * Remove the PID file
 */
export async function removePidFile(cfg: AntConfig): Promise<void> {
  try {
    const pidFile = getPidFilePath(cfg);
    await fs.unlink(pidFile);
  } catch {
    // File doesn't exist
  }
}

/**
 * Check if the agent is running
 */
export async function isRunning(cfg: AntConfig): Promise<boolean> {
  const pid = await readPidFile(cfg);
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the running agent
 */
export async function stopAnt(cfg: AntConfig): Promise<boolean> {
  const pid = await readPidFile(cfg);
  if (!pid) return false;

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, "SIGTERM");

    // Wait for process to exit (with timeout)
    const maxWait = 10000; // 10 seconds
    const checkInterval = 500;
    let waited = 0;

    while (waited < maxWait) {
      try {
        process.kill(pid, 0);
        // Still running, wait
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      } catch {
        // Process exited
        await removePidFile(cfg);
        return true;
      }
    }

    // Force kill if still running
    try {
      process.kill(pid, "SIGKILL");
      await removePidFile(cfg);
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      // Process doesn't exist, clean up PID file
      await removePidFile(cfg);
      return true;
    }
    return false;
  }
}

/**
 * Restart the running agent (stop then signal for restart)
 */
export async function restartAnt(cfg: AntConfig): Promise<boolean> {
  const pid = await readPidFile(cfg);
  if (!pid) return false;

  try {
    // Send SIGHUP for restart
    process.kill(pid, "SIGHUP");
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
