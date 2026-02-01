# Skill Registry

This file tracks all available skills (tools) in the ANT CLI system.
It is automatically updated when skills are created, modified, or removed.

## Built-in Skills

### File Operations
| Skill | Description | Category | Version |
|-------|-------------|----------|---------|
| `read` | Read a text file from disk | file | 1.0.0 |
| `write` | Write or append to text files | file | 1.0.0 |
| `ls` | List directory contents | file | 1.0.0 |

### System Operations
| Skill | Description | Category | Version |
|-------|-------------|----------|---------|
| `exec` | Run shell commands | system | 1.0.0 |
| `screenshot` | Capture screen on macOS | system | 1.0.0 |
| `open_app` | Open desktop applications | system | 1.0.0 |

### Memory Operations
| Skill | Description | Category | Version |
|-------|-------------|----------|---------|
| `memory_search` | Search memory files and sessions | memory | 1.0.0 |
| `memory_update` | Add notes to MEMORY.md | memory | 1.0.0 |

### Messaging
| Skill | Description | Category | Version |
|-------|-------------|----------|---------|
| `message_send` | Send messages to chat channels | messaging | 1.0.0 |
| `send_file` | Send files to chat channels | messaging | 1.0.0 |

### Agent Operations
| Skill | Description | Category | Version |
|-------|-------------|----------|---------|
| `spawn_subagent` | Spawn parallel subagent tasks | agent | 1.0.0 |
| `restart_ant` | Trigger agent restart | agent | 1.0.0 |

---

## Auto-Discovered Skills

Skills created by the agent will be automatically registered here.

<!-- AUTO-GENERATED SECTION - DO NOT EDIT MANUALLY -->

*No auto-discovered skills yet.*

<!-- END AUTO-GENERATED SECTION -->

---

## Creating New Skills

The agent can create new skills by:
1. Writing a TypeScript file to `src/tools/dynamic/<skill-name>.ts`
2. Following the standard tool interface
3. This registry will be automatically updated

### Skill Template

```typescript
import { defineTool, defineParams } from "../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../agent/types.js";

export default defineTool({
  meta: {
    name: "skill_name",
    description: "What the skill does",
    category: "dynamic",
    version: "1.0.0",
    author: "agent (auto)",
  },
  parameters: defineParams({
    param1: { type: "string", description: "Description" },
  }, ["param1"]),
  async execute(args, ctx): Promise<ToolResult> {
    // Implementation
    return { ok: true, data: result };
  },
});
```

---

## Skill Status

| Status | Meaning |
|--------|---------|
| `active` | Skill is loaded and available |
| `disabled` | Skill is not loaded |
| `error` | Skill failed to load |
| `pending` | Skill is being created |

---

*Last updated: 2026-02-01*
