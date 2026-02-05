# Configuration Sources (ant.config.example.json vs .env vs ~/.ant)

ant has three *different* concepts that can look like “config”:

1) **Config file** (`ant.config.json`) — user-controlled settings (providers, routing, features).
2) **Environment** (`.env` / shell env vars) — secrets and optional overrides.
3) **State directory** (`.ant/` or `~/.ant/`) — generated runtime data (logs, sessions, sqlite, WhatsApp auth, discovered providers overlay).

This doc explains the precedence and the recommended setup.

Repo note: the tracked file is `ant.config.example.json` (a template). Your real config should live at `~/.ant/ant.config.json` and can be pointed to with `ANT_CONFIG_PATH` if needed.

Fast path: run `ant onboard` to generate `~/.ant/ant.config.json` and update `.env` with any secrets you provide.

## 1) Config File Selection (Precedence)

When ant needs a config file, it picks **one** `ant.config.json` using this order:

1. CLI flag: `--config <path>` / `-c <path>`
2. Env var: `ANT_CONFIG_PATH` (or legacy `ANT_CONFIG`)
3. Nearest `ant.config.json` found by walking **upwards from `cwd`**
4. Fallback: `~/.ant/ant.config.json`

Implementation: `resolveConfigPath()` in `src/config.ts`.

## 2) `.env` vs Config File

### Recommended rule
- Put **non-secret** settings in `ant.config.json`
- Put **secrets** in `.env` (API keys, tokens)

You can edit both in the web UI:
- **Config**: Genetic Code page (writes `ant.config.json`)
- **Secrets**: Genetic Code → Secrets modal (writes `.env`)

### What env vars actually affect ant?

Some settings can be overridden by env vars (all prefixed with `ANT_`), for example:
- `ANT_WORKSPACE_DIR`
- `ANT_STATE_DIR`
- `ANT_GATEWAY_PORT`, `ANT_GATEWAY_HOST`
- `ANT_UI_PORT`, `ANT_UI_HOST`
- `ANT_LOG_LEVEL`, `ANT_LOG_FILE_LEVEL`, `ANT_LOG_FILE_PATH`
- `ANT_UI_STATIC_DIR`
- `ANT_RUNTIME_REPO_ROOT`

Implementation: `applyEnvOverrides()` in `src/config.ts`.

Provider API keys and some integrations also read env vars directly (e.g. `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc).

## 3) What Lives in `~/.ant/` (and Why)

`~/.ant/` is primarily for **state**, not hand-edited config:
- logs (`ant.log` or `logs/*`)
- sessions (`sessions/*.jsonl`)
- memory db (`memory.sqlite`)
- WhatsApp auth (`whatsapp/*`)
- scheduled jobs (`jobs.json`)
- provider discovery overlay (`providers.discovered.json`)

That overlay is **generated** and merged at runtime; it’s not your base config.

## Notifications (WhatsApp + Telegram)

The Main Agent can watch logs and notify you about:
- errors detected (and investigation start/finish)
- provider discovery changes (added/removed backups)
- notable improvement ideas found during duty cycles

Configure recipients as **session keys** in `mainAgent.notifySessions`, for example:

```json
{
  "mainAgent": {
    "notifySessions": [
      "whatsapp:dm:12345@s.whatsapp.net",
      "telegram:dm:123456789"
    ],
    "errorScanIntervalMs": 30000
  }
}
```

You can toggle categories via `mainAgent.notifyOn`:
`errors`, `incidentResults`, `providers`, `improvements`.

## Optional: `runtime.repoRoot`

You usually don’t need to set `runtime.repoRoot`.

If omitted, ant defaults `resolved.repoRoot` to the directory containing the loaded `ant.config.json`. Only set `runtime.repoRoot` when your config file lives *outside* the ant source tree but you still want `self_build` / self-maintenance to operate on the ant repo.

You can also set it via `.env` using `ANT_RUNTIME_REPO_ROOT`.

## Ideal Setup (Two Common Options)

### Option A — Per-project (legacy)
- Keep `ant.config.json` in the repo root
- Keep secrets in repo root `.env` (gitignored)
- Let state live in `./.ant/` (gitignored)

Pros: self-contained, portable, no absolute paths needed.

### Option B — Global config + state (recommended)
- Keep `ant.config.example.json` in the repo (template only)
- Store your real config at `~/.ant/ant.config.json`
- Put secrets + machine-specific paths in `.env` (gitignored)
- Set `ANT_WORKSPACE_DIR` in `.env` to point at your repo
- Keep state in `~/.ant` (via `stateDir: "~/.ant"` or `ANT_STATE_DIR=~/.ant`)

Pros: persistent WhatsApp pairing + memory across repos; clean repo; no secrets in source.
