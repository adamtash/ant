import fs from "node:fs/promises";
import path from "node:path";

const cliPath = path.join(process.cwd(), "dist", "cli.js");

async function main() {
  const contents = await fs.readFile(cliPath, "utf8");
  if (!contents.startsWith("#!")) {
    const updated = `#!/usr/bin/env node\n${contents}`;
    await fs.writeFile(cliPath, updated, "utf8");
  }
  await fs.chmod(cliPath, 0o755);
}

main().catch((err) => {
  console.error("Failed to add shebang to dist/cli.js:", err);
  process.exit(1);
});
