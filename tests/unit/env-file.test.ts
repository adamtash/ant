import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyEnvUpdates, readEnvSnapshot } from "../../src/env-file.js";

describe("env-file", () => {
  it("updates, appends, and removes keys while preserving comments", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-env-"));
    const envPath = path.join(dir, ".env");

    await fs.writeFile(
      envPath,
      ["# header", "OPENAI_API_KEY=old", "FOO=bar", "", "# tail"].join("\n") + "\n",
      "utf-8",
    );

    const res = await applyEnvUpdates(envPath, {
      OPENAI_API_KEY: "new",
      ANT_TELEGRAM_BOT_TOKEN: "t123",
      FOO: null,
    });

    expect(res.ok).toBe(true);

    const next = await fs.readFile(envPath, "utf-8");
    expect(next).toContain("# header\n");
    expect(next).toContain("OPENAI_API_KEY=new\n");
    expect(next).not.toContain("FOO=bar\n");
    expect(next).toContain("ANT_TELEGRAM_BOT_TOKEN=t123\n");
    expect(next).toContain("# tail\n");
  });

  it("quotes values with whitespace", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-env-"));
    const envPath = path.join(dir, ".env");

    const res = await applyEnvUpdates(envPath, { OPENAI_API_KEY: "a b" });
    expect(res.ok).toBe(true);

    const next = await fs.readFile(envPath, "utf-8");
    expect(next).toContain('OPENAI_API_KEY="a b"\n');
  });

  it("returns snapshot even when missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-env-"));
    const envPath = path.join(dir, ".env");

    const snap = await readEnvSnapshot(envPath);
    expect(snap.ok).toBe(true);
    expect(snap.ok && snap.exists).toBe(false);
  });
});

