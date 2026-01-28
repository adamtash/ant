import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";

export function pidFilePath(cfg: AntConfig): string {
  return path.join(cfg.resolved.stateDir, "ant.pid");
}

export async function writePidFile(cfg: AntConfig): Promise<void> {
  const filePath = pidFilePath(cfg);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(process.pid), "utf-8");
}

export async function readPidFile(cfg: AntConfig): Promise<number | null> {
  try {
    const raw = await fs.readFile(pidFilePath(cfg), "utf-8");
    const pid = Number(raw.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function clearPidFile(cfg: AntConfig): Promise<void> {
  try {
    await fs.rm(pidFilePath(cfg), { force: true });
  } catch {
    // ignore
  }
}

export function stopProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
