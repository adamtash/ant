import type { AntConfig } from "../config.js";
import { runMcpServer } from "../mcp/server.js";

export async function runMcpServerCli(cfg: AntConfig): Promise<void> {
  await runMcpServer(cfg);
}

export { runMcpServerCli as runMcpServer };
