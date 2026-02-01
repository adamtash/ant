# Contributing to ANT CLI

Thank you for your interest in contributing to ANT CLI! This guide explains how to develop, test, and submit changes.

## 🏗️ Development Setup

### Prerequisites

- Node.js 22+
- Git
- Terminal/CLI experience
- Basic TypeScript knowledge (helpful but not required)

### Installation

```bash
git clone <your-fork>/ant-cli
cd ant-cli
npm install
```

### Build & Dev

```bash
# Build TypeScript
npm run build

# Development mode (watch and reload)
npm run dev -- run -c ant.config.json

# With TUI dashboard
npm run dev -- run -c ant.config.json --tui

# UI development
npm run ui:dev

# Tests
npm run test
npm run test:run
```

## 📁 Project Structure

```
ant-cli/
├── src/
│   ├── cli.ts                  # CLI entry point
│   ├── config.ts               # Configuration schema
│   ├── log.ts                  # Logging setup
│   ├── agent/                  # Agent runtime
│   │   ├── index.ts
│   │   ├── runner.ts
│   │   ├── tools.ts
│   │   └── ...
│   ├── channels/               # Communication adapters
│   │   ├── whatsapp/
│   │   ├── cli/
│   │   └── ...
│   ├── memory/                 # Memory system
│   │   ├── manager.ts
│   │   ├── sqlite.ts
│   │   └── ...
│   ├── scheduler/              # Task scheduling
│   ├── monitor/                # Monitoring & metrics
│   ├── gateway/                # HTTP API
│   ├── supervisor.ts           # Main Agent loop
│   ├── tools/                  # Built-in tools
│   └── utils/                  # Utilities
├── ui/                         # React UI
│   └── src/
├── tests/                      # Test files
├── dist/                       # Compiled output (generated)
└── README.md, etc.
```

## 🔧 Common Development Tasks

### Add a New Tool

Tools are defined in `src/runtime/tools.ts` (or `src/tools/` if split):

```typescript
tools.push({
  name: "my_tool",
  description: "What this tool does",
  parameters: {
    type: "object",
    properties: {
      arg1: { type: "string", description: "..." },
      arg2: { type: "number" }
    },
    required: ["arg1"]
  },
  execute: async (args, ctx) => {
    // Parse arguments
    const { arg1, arg2 } = JSON.parse(args);

    // Tool logic
    const result = await doSomething(arg1, arg2);

    // Return result
    return { content: JSON.stringify({ ok: true, result }) };
  }
});
```

**Test it**:
```bash
npm run dev -- debug run "Use my_tool with arg1=\"test\" and arg2=42"
```

### Add a New CLI Command

CLI commands are defined in `src/cli.ts`:

```typescript
program
  .command('my-command')
  .description('What this does')
  .option('-f, --flag <value>', 'A flag')
  .action(async (options) => {
    // Command logic
    console.log('Hello from my-command!');
  });
```

**Test it**:
```bash
npm run dev -- my-command --flag=value
```

### Add a New Web UI Page

1. Create `ui/src/pages/MyPage.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { Sidebar } from '../components/Sidebar';

export default function MyPage() {
  return (
    <div className="flex h-screen bg-gray-900">
      <Sidebar />
      <div className="flex-1 p-8">
        <h1 className="text-3xl font-bold text-white">My Page</h1>
        {/* Your content */}
      </div>
    </div>
  );
}
```

2. Add to `ui/src/App.tsx`:
```typescript
import MyPage from './pages/MyPage';

// Inside Routes:
<Route path="/my-page" element={<MyPage />} />
```

3. Add to `ui/src/components/Sidebar.tsx`:
```typescript
<NavLink to="/my-page" className="...">
  My Page
</NavLink>
```

### Add Configuration Option

1. Update `src/config.ts` schema
2. Add defaults in config loading
3. Update `ant.config.json` documentation in README.md
4. Add validation if needed

### Update Documentation

Documentation files:
- `README.md` - Main user guide
- `PROJECT.md` - Technical architecture
- `AGENT_DUTIES.md` - Main Agent responsibilities
- `ui/README.md` - UI development guide
- `CONTRIBUTING.md` - This file

Always update docs when:
- Adding features
- Changing configuration
- Modifying CLI commands
- Updating architecture

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm run test

# Run tests once (CI mode)
npm run test:run

# Run specific test file
npm run test -- path/to/test.ts
```

### Write Tests

Create files matching `**/*.test.ts` or `**/*.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/my-function';

describe('myFunction', () => {
  it('should return 42', () => {
    expect(myFunction()).toBe(42);
  });
});
```

### Manual Testing

**Test without WhatsApp**:
```bash
npm run dev -- debug run "Your prompt here"
```

**Simulate inbound message**:
```bash
npm run dev -- debug simulate "/memory test note"
```

**Test a specific tool**:
```bash
npm run dev -- debug run "Use read to open ~/test.txt"
```

## 🐛 Debugging

### Enable Debug Logging

In `ant.config.json`:
```json
{
  "logging": {
    "level": "debug",
    "fileLevel": "trace"
  }
}
```

Then check `~/.ant/ant.log`

### Use VS Code Debugger

Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "ANT CLI",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/dist/cli.js",
      "args": ["run", "-c", "ant.config.json"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

Then press F5 to debug.

### Check Memory Usage

```bash
# Monitor memory during runtime
watch -n 1 'ps aux | grep node | grep -v grep'
```

## 📋 Code Style

### TypeScript

- Use strict mode (`"strict": true` in tsconfig.json)
- Type all function parameters and returns
- Use interfaces for objects
- Avoid `any` - use `unknown` if needed

### Formatting

```bash
# Format code (uses Prettier if configured)
npm run lint
```

### Naming Conventions

- Functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.ts`
- Interfaces: `PascalCase` with `I` prefix optional

## 🚀 Pull Request Process

### Before Submitting

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**:
   - Keep commits logical and descriptive
   - Update tests
   - Update documentation

3. **Test thoroughly**:
   ```bash
   npm run test
   npm run build
   npm run typecheck
   ```

4. **Check for issues**:
   ```bash
   npm run lint
   ```

### Submit PR

1. Push to your fork
2. Create Pull Request with:
   - **Title**: Clear, concise description
   - **Description**: Why this change? What does it do?
   - **Linked Issues**: Reference any related issues
   - **Testing**: How did you test this?

### PR Template

```markdown
## Description
Brief description of changes

## Motivation
Why is this needed? What problem does it solve?

## Testing
How was this tested? Include repro steps if applicable.

## Documentation
- [ ] Updated README.md
- [ ] Updated PROJECT.md
- [ ] Updated relevant docs
- [ ] Added inline comments for complex logic

## Checklist
- [ ] Builds successfully (`npm run build`)
- [ ] Tests pass (`npm run test:run`)
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] Code formatted (`npm run lint`)
- [ ] No console errors/warnings
```

## 🔍 Review Process

Your PR will be reviewed for:
- **Correctness** - Does it work as intended?
- **Quality** - Is the code readable and maintainable?
- **Testing** - Is it properly tested?
- **Documentation** - Is it well documented?
- **Performance** - Does it introduce inefficiencies?
- **Security** - Are there any vulnerabilities?

## 📚 Resources

- **[README.md](README.md)** - User guide
- **[PROJECT.md](PROJECT.md)** - Technical docs
- **[AGENT_DUTIES.md](AGENT_DUTIES.md)** - Main Agent system
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/
- **Node.js Docs**: https://nodejs.org/docs/

## 💡 Ideas for Contributions

### Easy (Good First Issues)

- [ ] Add new tool
- [ ] Improve error messages
- [ ] Add unit tests
- [ ] Update documentation
- [ ] Add configuration option

### Medium

- [ ] Add new channel (Telegram, Discord, etc.)
- [ ] Implement new provider type
- [ ] Add UI feature
- [ ] Performance optimization
- [ ] Memory system improvement

### Hard

- [ ] Multi-agent orchestration
- [ ] Distributed deployment
- [ ] Plugin system
- [ ] Advanced scheduling
- [ ] ML-based optimization

## 🤝 Community

- **Discussions**: GitHub Discussions for questions
- **Issues**: Report bugs via GitHub Issues
- **Chat**: Discord/Slack (if available)

## 📝 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Questions?** Open an issue or start a discussion on GitHub!

Thank you for contributing to ANT CLI! 🐜
