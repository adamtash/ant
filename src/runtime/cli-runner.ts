import { spawn } from "node:child_process";

export type CliRunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export async function runCliCommand(params: {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  cwd?: string;
}): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const child = spawn(params.command, params.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      cwd: params.cwd,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}`.trim(),
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });

    if (params.stdin !== undefined) {
      child.stdin.write(params.stdin);
    }
    child.stdin.end();
  });
}
