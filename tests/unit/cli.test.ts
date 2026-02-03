import { describe, it, expect, vi } from "vitest";

// Node 22+ includes `node:sqlite`, but Vite's resolver doesn't always recognize it yet.
// Mock it so importing the CLI (and transitively memory modules) works in Vitest.
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {},
}));

import { program } from "../../src/cli.js";

describe("CLI wiring", () => {
  it("registers top-level commands", () => {
    const names = program.commands.map((cmd) => cmd.name());

    expect(names).toContain("start");
    expect(names).toContain("status");
    expect(names).toContain("ask");
    expect(names).toContain("schedule");
    expect(names).toContain("sessions");
    expect(names).toContain("diagnostics");
  });

  it("registers expected subcommands", () => {
    const schedule = program.commands.find((cmd) => cmd.name() === "schedule");
    expect(schedule).toBeTruthy();
    const scheduleNames = schedule!.commands.map((cmd) => cmd.name());
    expect(scheduleNames).toEqual(expect.arrayContaining(["add", "list", "run", "remove"]));

    const sessions = program.commands.find((cmd) => cmd.name() === "sessions");
    expect(sessions).toBeTruthy();
    const sessionNames = sessions!.commands.map((cmd) => cmd.name());
    expect(sessionNames).toEqual(expect.arrayContaining(["list", "view", "clear"]));

    const diagnostics = program.commands.find((cmd) => cmd.name() === "diagnostics");
    expect(diagnostics).toBeTruthy();
    const diagNames = diagnostics!.commands.map((cmd) => cmd.name());
    expect(diagNames).toEqual(expect.arrayContaining(["test-all", "endpoints", "agent-health", "whatsapp", "harness"]));
  });
});
