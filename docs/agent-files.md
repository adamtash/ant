# Agent Markdown Files (Repo vs Workspace vs State)

ant intentionally splits files into three “zones” so you can keep **versioned docs** in the repo, **editable instructions** in a workspace, and **generated runtime state** out of git.

## The Three Zones

### 1) Repo (source code)
Files that ship with / document the CLI. These live in the repo folder (e.g. `README.md`, `PROJECT.md`, `AGENTS.md`).

### 2) Workspace (`workspaceDir`)
Where the agent treats “relative paths” as living, and where user-editable context files live.

Examples (by default / convention):
- `MEMORY.md`
- `memory/*.md`
- `AGENT_DUTIES.md` (Main Agent prompt/instructions)

### 3) State (`stateDir`)
Generated runtime state: sessions, sqlite, WhatsApp auth, provider overlays, logs, etc.

By default:
- `stateDir = workspaceDir/.ant`
- Special-case: if `workspaceDir` ends with `.ant` (e.g. `~/.ant`), then `stateDir = workspaceDir`

## How ant Resolves Paths

Many config paths are resolved by `resolveWorkspaceOrStatePath()` (`src/config.ts`):

- Absolute paths (or `~`) stay absolute
- Relative paths starting with `.ant/` (or `./.ant/`) resolve under `stateDir`
- All other relative paths resolve under `workspaceDir`

This is why config values like `"./.ant/ant.log"` (or `".ant/ant.log"`) end up under `stateDir`, even if your `workspaceDir` is somewhere else.

## Where the “Agent Prompt” Markdown Lives

### `AGENT_DUTIES.md` (instructions / prompt)
- Read from: `workspaceDir/<mainAgent.dutiesFile>` (`src/agent/main-agent.ts`)
- Fallback: if missing in `workspaceDir`, ant also tries `dirname(configPath)/<dutiesFile>`

That fallback is the most common reason you’ll see “some prompt docs” in the repo while other runtime files are in `~/.ant`.

### `MEMORY.md` (long-term memory)
- Read/write at: `workspaceDir/MEMORY.md`
- Indexed by the memory system (`src/memory/*`) and used by `memory_*` tools (`src/tools/built-in/memory/*`)

### `AGENT_LOG.md` (Main Agent activity log)
- Written to: `mainAgent.logFile` resolved via `resolveWorkspaceOrStatePath()`
- Default: `".ant/AGENT_LOG.md"` (so it lands under `stateDir/AGENT_LOG.md`)

## Why You’re Seeing Files Split Between `~/.ant` and the Repo

Example scenario:
- `workspaceDir` is set to `~/.ant`
- `~/.ant/MEMORY.md` exists (created by memory tools)
- `~/.ant/AGENT_LOG.md` exists (written by provider discovery / Main Agent)
- `~/.ant/AGENT_DUTIES.md` does **not** exist

In that case, the Main Agent falls back to `AGENT_DUTIES.md` next to your config file (often the repo), while memory/logs live in `~/.ant`.

## Make It Consistent (Pick One)

### Option A: “Everything per-project” (common dev setup)
- `workspaceDir: "."` (repo root)
- leave `stateDir` unset (defaults to `./.ant`)

Result:
- `./AGENT_DUTIES.md`, `./MEMORY.md` in the repo workspace
- `./.ant/AGENT_LOG.md` and other runtime state in `.ant/` (gitignored)

### Option B: “Everything under `~/.ant`” (global assistant)
- `workspaceDir: "~/.ant"`
- ensure `~/.ant/AGENT_DUTIES.md` exists (copy the template from the repo if you want)

Result:
- all prompt-ish docs live together under `~/.ant`

### Option C: “Workspace = repo, State = home”
- `workspaceDir: "."`
- `stateDir: "~/.ant"`

Result:
- repo files stay in the repo
- state/logs/db/sessions go to `~/.ant`

