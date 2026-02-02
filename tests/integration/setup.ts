/**
 * Integration Test Setup
 *
 * Provides utilities for spawning ANT-CLI processes,
 * managing test environments, and cleanup.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Test environment configuration
 */
export interface TestEnvConfig {
  /** Unique test ID */
  testId: string;
  /** Temporary directory for test state */
  tempDir: string;
  /** Port for gateway server */
  gatewayPort: number;
  /** Port for UI server */
  uiPort: number;
  /** Path to test config file */
  configPath: string;
  /** Whether to enable WhatsApp (mock) */
  enableWhatsApp: boolean;
  /** Whether to enable memory */
  enableMemory: boolean;
  /** Whether to enable main agent */
  enableMainAgent: boolean;
}

/**
 * Running test instance
 */
export interface TestInstance {
  /** Test configuration */
  config: TestEnvConfig;
  /** Spawned process */
  process: ChildProcess;
  /** Start time */
  startedAt: number;
  /** Process logs */
  logs: string[];
  /**
   * Stop the test instance
   */
  stop(): Promise<void>;
  /**
   * Check if process is running
   */
  isRunning(): boolean;
  /**
   * Get gateway base URL
   */
  getGatewayUrl(): string;
  /**
   * Get logs as string
   */
  getLogs(): string;
}

/**
 * Generate a unique test ID
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find an available port
 */
export async function findAvailablePort(startPort = 18000): Promise<number> {
  const net = await import("node:net");

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let port = startPort;

    const tryPort = () => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          port++;
          if (port > startPort + 100) {
            reject(new Error("Could not find available port"));
            return;
          }
          tryPort();
        } else {
          reject(err);
        }
      });

      server.once("listening", () => {
        server.close(() => resolve(port));
      });

      server.listen(port, "127.0.0.1");
    };

    tryPort();
  });
}

/**
 * Create a test configuration file
 */
async function createTestConfig(config: TestEnvConfig): Promise<void> {
  const testConfig = {
    workspaceDir: config.tempDir,
    stateDir: path.join(config.tempDir, ".ant"),
    providers: {
      default: "test-provider",
      items: {
        "test-provider": {
          type: "openai",
          baseUrl: "http://localhost:1234/v1",
          apiKey: "test-key",
          model: "zai-org/glm-4.7-flash",
        },
      },
    },
    routing: {
      chat: "test-provider",
      tools: "test-provider",
      embeddings: "test-provider",
    },
    gateway: {
      enabled: true,
      port: config.gatewayPort,
      host: "127.0.0.1",
    },
    ui: {
      enabled: true,
      port: config.uiPort,
      host: "127.0.0.1",
      autoOpen: false,
    },
    whatsapp: {
      sessionDir: path.join(config.tempDir, ".ant", "whatsapp"),
      respondToGroups: false,
      mentionOnly: true,
      respondToSelfOnly: true,
      allowSelfMessages: true,
    },
    memory: {
      enabled: config.enableMemory,
      indexSessions: true,
      sqlitePath: path.join(config.tempDir, ".ant", "memory.sqlite"),
      embeddingsModel: "text-embedding-test",
      sync: {
        onSessionStart: false,
        onSearch: false,
        watch: false,
        intervalMinutes: 0,
      },
    },
    agent: {
      maxHistoryTokens: 4000,
      temperature: 0.2,
    },
    mainAgent: {
      enabled: config.enableMainAgent,
      intervalMs: 5000,
      dutiesFile: "AGENT_DUTIES.md",
    },
    subagents: {
      enabled: true,
      timeoutMs: 60000,
    },
    cliTools: {
      enabled: true,
      timeoutMs: 300000,
    },
    scheduler: {
      enabled: false,
      storePath: path.join(config.tempDir, ".ant", "jobs.json"),
      timezone: "UTC",
    },
    monitoring: {
      enabled: false,
      retentionDays: 7,
      alertChannels: [],
      criticalErrorThreshold: 5,
    },
    logging: {
      level: "debug",
      filePath: path.join(config.tempDir, ".ant", "test.log"),
      fileLevel: "trace",
    },
  };

  await fs.writeFile(config.configPath, JSON.stringify(testConfig, null, 2));
}

/**
 * Create test duties file for main agent
 */
async function createTestDutiesFile(tempDir: string): Promise<void> {
  const dutiesPath = path.join(tempDir, "AGENT_DUTIES.md");
  const content = `# Test Agent Duties

This is a test duties file for the main agent integration tests.

## Responsibilities

1. Monitor system health
2. Report test status
3. Verify duty cycle completion

## Current Tasks

- Run health checks
- Validate configuration
- Report completion status
`;
  await fs.writeFile(dutiesPath, content);
}

/**
 * Spawn a test instance of ANT-CLI
 */
export async function spawnTestInstance(
  options: Partial<Omit<TestEnvConfig, "testId" | "tempDir" | "gatewayPort" | "uiPort" | "configPath">> = {}
): Promise<TestInstance> {
  const testId = generateTestId();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ant-test-${testId}-`));
  const gatewayPort = await findAvailablePort(18000);
  const uiPort = await findAvailablePort(gatewayPort + 1);
  const configPath = path.join(tempDir, "test.config.json");

  const config: TestEnvConfig = {
    testId,
    tempDir,
    gatewayPort,
    uiPort,
    configPath,
    enableWhatsApp: options.enableWhatsApp ?? false,
    enableMemory: options.enableMemory ?? false,
    enableMainAgent: options.enableMainAgent ?? false,
  };

  // Create test config file
  await createTestConfig(config);

  // Create duties file if main agent is enabled
  if (config.enableMainAgent) {
    await createTestDutiesFile(tempDir);
  }

  // Ensure state directory exists
  await fs.mkdir(path.join(tempDir, ".ant"), { recursive: true });

  const logs: string[] = [];

  // Spawn the process
  const proc = spawn("node", [path.join(PROJECT_ROOT, "dist/cli.js"), "start", "-c", configPath], {
    cwd: tempDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ANT_TEST_ID: testId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stdout
  proc.stdout?.on("data", (data: Buffer) => {
    const line = data.toString();
    logs.push(`[stdout] ${line}`);
  });

  // Capture stderr
  proc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString();
    logs.push(`[stderr] ${line}`);
  });

  const startedAt = Date.now();

  const instance: TestInstance = {
    config,
    process: proc,
    startedAt,
    logs,

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (proc.killed || proc.exitCode !== null) {
          resolve();
          return;
        }

        // Try graceful termination first
        proc.kill("SIGTERM");

        // Force kill after timeout
        const timeout = setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 10000);

        proc.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },

    isRunning(): boolean {
      return !proc.killed && proc.exitCode === null;
    },

    getGatewayUrl(): string {
      return `http://127.0.0.1:${config.gatewayPort}`;
    },

    getLogs(): string {
      return logs.join("\n");
    },
  };

  return instance;
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {}
): Promise<void> {
  const { timeoutMs = 300000, intervalMs = 100, message = "Condition not met" } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`${message} (timeout after ${timeoutMs}ms)`);
}

/**
 * Wait for gateway to be ready
 */
export async function waitForGateway(instance: TestInstance, timeoutMs = 300000): Promise<void> {
  const url = `${instance.getGatewayUrl()}/api/status`;

  await waitFor(
    async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return response.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs, message: "Gateway failed to start" }
  );
}

/**
 * Cleanup test environment
 */
export async function cleanupTest(instance: TestInstance): Promise<void> {
  // Stop the process
  await instance.stop();

  // Clean up temp directory
  try {
    await fs.rm(instance.config.tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Make HTTP request to test instance
 */
export async function httpGet(instance: TestInstance, path: string): Promise<Response> {
  const url = `${instance.getGatewayUrl()}${path}`;
  return fetch(url, { signal: AbortSignal.timeout(10000) });
}

export async function httpPost(
  instance: TestInstance,
  path: string,
  body: unknown
): Promise<Response> {
  const url = `${instance.getGatewayUrl()}${path}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
