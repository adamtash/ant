# Config

`ant.config.json` is JSON only.

```json
{
  "workspaceDir": "~",
  "providers": {
    "default": "lmstudio",
    "items": {
      "lmstudio": {
        "type": "openai",
        "baseUrl": "http://localhost:1234/v1",
        "model": "zai-org/glm-4.7-flash",
        "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
      },
      "codex-cli": {
        "type": "cli",
        "cliProvider": "codex",
        "model": "codex"
      }
    }
  },
  "routing": {
    "chat": "codex-cli",
    "tools": "lmstudio",
    "embeddings": "lmstudio",
    "parentForCli": "lmstudio"
  },
  "whatsapp": {
    "sessionDir": "./.ant/whatsapp",
    "respondToGroups": false,
    "mentionOnly": true,
    "respondToSelfOnly": true,
    "mentionKeywords": ["ant"],
    "allowSelfMessages": true,
    "resetOnLogout": true,
    "typingIndicator": true,
    "ownerJids": []
  },
  "memory": {
    "enabled": true,
    "indexSessions": true,
    "sqlitePath": "./.ant/memory.sqlite",
    "embeddingsModel": "text-embedding-nomic-embed-text-v1.5",
    "sync": {
      "onSessionStart": true,
      "onSearch": true,
      "watch": true,
      "watchDebounceMs": 1500,
      "intervalMinutes": 0,
      "sessionsDeltaBytes": 100000,
      "sessionsDeltaMessages": 50
    }
  },
  "agent": {
    "systemPrompt": ""
  },
  "subagents": {
    "enabled": true
  },
  "cliTools": {
    "enabled": true,
    "timeoutMs": 120000,
    "mcp": {
      "enabled": true,
      "tools": ["memory_search", "memory_get"]
    },
    "providers": {
      "codex": { "command": "codex", "args": [] },
      "copilot": { "command": "copilot", "args": [] },
      "claude": { "command": "claude", "args": [] }
    }
  }
}
```

Notes:
- Relative paths are resolved from `workspaceDir`.
- To allow ant to operate across your whole home directory, set `workspaceDir` to `~` (or `/` for full disk).
- `providers.items.*.type` can be `openai` (LM Studio API) or `cli` (Codex/Copilot/Claude CLI).
- `routing` controls which provider handles each action. Use `parentForCli` to select a parent LLM that runs tool calls when `routing.chat` is a CLI provider.
- `respondToSelfOnly` limits WhatsApp replies to messages sent by the connected account.
- When `respondToSelfOnly` is true, ant only replies in the self-chat (your own number), not other chats.
- `ownerJids` can further restrict allowed senders or chats (example: `15551234567@s.whatsapp.net`).
- `typingIndicator` sends WhatsApp "composing" presence updates while replies are generated.
- For screen capture on macOS, grant Screen Recording permission to Terminal (or your Node binary).
- `logging.filePath` defaults to `~/.ant/ant.log`. `logging.fileLevel` controls verbosity for the file output (defaults to `logging.level`).
- `cliTools` uses non-interactive CLI modes by default when `args` is empty.
- You can override CLI `args` and use placeholders `{prompt}` and `{output}` in your custom args.
- `cliTools.mcp` enables MCP for Copilot/Claude CLIs so they can call ant tools.
- `memory.sync` controls when session transcripts are re-indexed:
  - `onSessionStart`: run a sync when the runtime boots.
  - `onSearch`: run a sync before memory searches.
  - `watch`: watch session transcript files and sync after edits.
  - `intervalMinutes`: periodic syncs (0 disables).
  - `sessionsDeltaBytes` / `sessionsDeltaMessages`: minimum changes before indexing.
- Default CLI args (when `args` is empty):
  - codex: `exec --output-last-message {output} --color never -` (prompt via stdin)
  - copilot: `-p {prompt} --silent --no-color --allow-all-tools`
  - claude: `--print --output-format text --permission-mode dontAsk {prompt}`
