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

export function createLoggerWithCleanup(
  level: string,
  filePath?: string,
  fileLevel?: string,
  opts?: { console?: boolean },
): { logger: Logger; close: () => Promise<void> } {
  const consoleEnabled = opts?.console !== false;
  if (!filePath) {
    const logger = consoleEnabled ? pino({ level }) : pino({ level: "silent" });
    return { logger, close: async () => {} };
  }

  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create log directory: ${dir}`, err);
    throw new Error(`Cannot create log directory: ${dir}`);
  }

  const dest = pino.destination({ dest: filePath, sync: true });
  const logger = consoleEnabled
    ? pino(
        { level: "trace" },
        multistream([
          { level, stream: process.stdout },
          { level: fileLevel ?? level, stream: dest },
        ]),
      )
    : pino({ level: fileLevel ?? level }, dest);

  return {
    logger,
    close: async () => {
      try {
        (dest as any).flushSync?.();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        try {
          (dest as any).once?.("close", done);
          (dest as any).once?.("finish", done);
        } catch {
          // ignore
        }

        try {
          (dest as any).end?.();
        } catch {
          // ignore
          done();
          return;
        }

        const timeout = setTimeout(done, 2000);
        timeout.unref?.();
      });
    },
  };
}
