# Usage

## Start

```bash
npm install
npm run dev -- run -c ant.config.json
```

You should see a QR code in the terminal. Scan it with WhatsApp.

If you want Codex/Copilot/Claude as the main model, keep an OpenAI provider for tools and set routing:

```json
"providers": {
  "default": "lmstudio",
  "items": {
    "lmstudio": { "type": "openai", "baseUrl": "http://localhost:1234/v1", "model": "zai-org/glm-4.7-flash" },
    "codex-cli": { "type": "cli", "cliProvider": "codex", "model": "codex" }
  }
},
"routing": {
  "chat": "codex-cli",
  "tools": "lmstudio",
  "embeddings": "lmstudio",
  "parentForCli": "lmstudio"
}
```

To reply only to messages sent by your own account, set:
```json
"whatsapp": { "respondToSelfOnly": true }
```

## Keep it running

Foreground:
```bash
npm run dev -- run -c ant.config.json
```

Background:
```bash
nohup npm run dev -- run -c ant.config.json > ant.log 2>&1 &
tail -f ant.log
```

## Debug without WhatsApp

```bash
npm run dev -- debug run "Reply in 8 words."
npm run dev -- debug simulate "/memory My favorite snack is pistachios"
```

## External CLI tools

Use the `external_cli` tool from the agent to delegate a prompt to Codex/Copilot/Claude CLIs.
If you enable `cliTools.mcp`, Copilot and Claude CLIs can call `memory_search` and `memory_get` via MCP.

Example prompt:
```
Use external_cli with provider "codex" and prompt "Summarize this repo in 5 bullets".
```

## OS control + screen capture

Example prompts:
```
Use exec to run "ls -la ~"
Use read to open ~/Desktop/notes.txt
Use screenshot and send it
Use screen_record for 10 seconds and send it
Use browser with action "extract" and url "https://example.com"
Use browser with action "screenshot" and url "https://example.com" and send true
```

On macOS, enable Screen Recording for Terminal in:
System Settings → Privacy & Security → Screen Recording.
You can also use the `macos_permissions` tool to open the settings panes.

## Twitter/X via bird

Install bird (if missing):
```bash
brew install steipete/tap/bird
# or
npm install -g @steipete/bird
```

Then run:
```
bird check
bird whoami
```

Example prompt:
```
Use bird with args ["search", "from:jack", "-n", "5"]
```

## Memory

Create a note from chat:
```
/memory My favorite snack is pistachios
```

Index + search:
```bash
npm run dev -- memory index -c ant.config.json
npm run dev -- memory search "favorite snack" -c ant.config.json
```

## Sessions

```bash
npm run dev -- sessions list -c ant.config.json
npm run dev -- sessions show "whatsapp:dm:<chat-id>" -c ant.config.json
npm run dev -- sessions clear "whatsapp:dm:<chat-id>" -c ant.config.json
```
