import fs from "node:fs/promises";

import type { AntConfig } from "../config.js";
import { ensureRuntimePaths } from "./paths.js";
import type { SubagentRecord } from "./subagents.js";

export async function listSubagents(cfg: AntConfig): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  const records = await loadRecords(paths.subagentsFile);
  if (records.length === 0) {
    console.log("No subagent runs.");
    return;
  }
  for (const record of records) {
    console.log(
      `${record.runId} ${record.status} ${new Date(record.createdAt).toISOString()} ${record.task}`,
    );
  }
}

export async function cleanupSubagents(cfg: AntConfig): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  const records = await loadRecords(paths.subagentsFile);
  if (records.length === 0) {
    console.log("No subagent runs to clean.");
    return;
  }
  await fs.unlink(paths.subagentsFile).catch(() => {});
  console.log("Subagent registry cleared.");
}

async function loadRecords(filePath: string): Promise<SubagentRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as SubagentRecord[];
  } catch {
    return [];
  }
}
