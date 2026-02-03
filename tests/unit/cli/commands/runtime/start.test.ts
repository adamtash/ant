import { describe, it, expect, vi } from "vitest";

import { createSchedulerAgentExecutor } from "../../../../../src/cli/commands/runtime/start.js";

describe("createSchedulerAgentExecutor", () => {
  it("passes the trigger prompt as query to the agent engine", async () => {
    const agentEngine = {
      execute: vi.fn(async () => ({
        response: "OK",
        toolsUsed: [],
        iterations: 1,
      })),
    } as any;

    const exec = createSchedulerAgentExecutor(agentEngine);
    const res = await exec({
      sessionKey: "cron:job-1",
      query: "Reply with exactly: PONG",
      cronContext: {
        jobId: "job-1",
        jobName: "Job Name (should not be used as query)",
        schedule: "* * * * *",
        triggeredAt: 123,
      },
    });

    expect(agentEngine.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "cron:job-1",
        query: "Reply with exactly: PONG",
        channel: "web",
      })
    );
    expect(res.response).toBe("OK");
  });
});

