// Modified by ANT at 2026-02-02T13:59:26.581Z to prove source code access
import fs from "node:fs";
import path from "node:path";

import pino, { multistream } from "pino";

export type Logger = pino.Logger;

export function createLogger(
  level: string,
  filePath?: string,
  fileLevel?: string,
  opts?: { console?: boolean },
): Logger {
  const consoleEnabled = opts?.console !== false;
  if (!filePath) {
    if (!consoleEnabled) {
      return pino({ level: "silent" });
    }
    return pino({ level });
  }
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create log directory: ${dir}`, err);
    throw new Error(`Cannot create log directory: ${dir}`);
  }
  const streams = [
    ...(consoleEnabled ? [{ level, stream: process.stdout }] : []),
    {
      level: fileLevel ?? level,
      stream: pino.destination({ dest: filePath, sync: false }),
    },
  ];
  return pino({ level: "trace" }, multistream(streams));
}
