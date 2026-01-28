import { execFile, spawn } from "node:child_process";

import type { AntConfig } from "../config.js";
import { readPidFile, stopProcess } from "./process-control.js";

async function postWithTimeout(url: string, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function stopAnt(cfg: AntConfig): Promise<boolean> {
  let stopped = false;
  if (cfg.ui.enabled) {
    const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
    stopped = await postWithTimeout(`${base}/stop`);
  }
  const pid = await readPidFile(cfg);
  if (!stopped && pid) {
    stopped = stopProcess(pid);
  }
  await stopUiDevServer(cfg);
  return stopped;
}

export async function restartAnt(cfg: AntConfig): Promise<boolean> {
  if (cfg.ui.enabled) {
    const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
    const ok = await postWithTimeout(`${base}/restart`);
    if (ok) return true;
  }
  const stopped = await stopAnt(cfg);
  const restart = cfg.runtime?.restart;
  if (!restart?.command) return stopped;
  const args = Array.isArray(restart.args) ? restart.args : [];
  const cwd = restart.cwd ?? cfg.resolved.workspaceDir;
  const child = spawn(restart.command, args, { cwd, detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

async function stopUiDevServer(cfg: AntConfig): Promise<void> {
  const rawUrl = cfg.ui.openUrl?.trim();
  if (!rawUrl) return;
  let port: number | null = null;
  try {
    const parsed = new URL(rawUrl);
    port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return;
  }
  if (!port || !Number.isFinite(port)) return;
  await killPortIfBusy(port);
}

function killPortIfBusy(port: number): Promise<void> {
  const args = ["-ti", `tcp:${port}`, "-sTCP:LISTEN"];
  return new Promise((resolve) => {
    execFile("lsof", args, (err, stdout) => {
      if (err) return resolve();
      const pids = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => Number(line))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ignore
        }
      }
      resolve();
    });
  });
}
