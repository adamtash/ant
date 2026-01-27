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
  } catch {
    // ignore
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
