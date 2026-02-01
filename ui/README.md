# ANT Colony Control UI

A modern, responsive React + TypeScript + Vite web interface for the ANT CLI agent runtime. Features real-time monitoring, session management, memory search, and task control.

## 🎯 Features

- **Royal Chamber Dashboard** - Real-time system status, metrics, and activity monitoring
- **Chat Interface** - Direct conversation with the agent with message history
- **Sessions Manager** - View, search, filter, and export session conversations
- **Memory Explorer** - Semantic search over the agent's knowledge base
- **Task Monitor** - Track active subagents and long-running tasks
- **System Settings** - Configure runtime options and preferences
- **Dark Theme** - Ant-colony inspired color scheme (dark grays, warm amber)
- **Real-time Updates** - WebSocket/SSE integration for live data

## 🏗️ Architecture

```
┌──────────────────────────────────────────┐
│     React + TypeScript + Vite            │
├──────────────────────────────────────────┤
│  Tailwind CSS (Dynamic Classes)          │
│  React Router (Multi-page SPA)           │
│  React Konva (Canvas Visualization)      │
│  Socket.io (Real-time Updates)           │
├──────────────────────────────────────────┤
│  API Layer (REST + WebSocket)            │
├──────────────────────────────────────────┤
│  ANT Runtime (:5117)                     │
└──────────────────────────────────────────┘
```

## 📦 Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7 (Fast development server, production bundling)
- **Styling**: Tailwind CSS 3 with custom dynamic class generation
- **Visualization**: React Konva (Canvas rendering for colony visualization)
- **Routing**: React Router 7
- **Real-time**: Socket.io client (optional)
- **HTTP**: Fetch API with custom error handling

## 🚀 Development

### Install Dependencies

```bash
npm --prefix ui install
# or from the ui directory
cd ui && npm install
```

### Start Dev Server

```bash
# From project root
npm run ui:dev

# Or from ui directory
cd ui && npm run dev
```

The UI will be available at `http://localhost:5173` (Vite dev server) with API proxy to the runtime at `:5117`.

### Build for Production

```bash
# From project root
npm run ui:build

# Or from ui directory
cd ui && npm run build
```

Output: `ui/dist/` (ready for serving)

## 📁 Project Structure

```
ui/
├── src/
│   ├── components/
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   ├── Header.tsx            # Top bar with status
│   │   ├── ChatInterface.tsx      # Chat panel
│   │   ├── VisualizationPanel.tsx # Canvas rendering
│   │   ├── SessionList.tsx        # Session manager
│   │   ├── MemorySearch.tsx       # Memory explorer
│   │   ├── TaskMonitor.tsx        # Subagent tracker
│   │   └── Settings.tsx           # Configuration UI
│   ├── pages/
│   │   ├── RoyalChamber.tsx       # Dashboard (default)
│   │   ├── Chat.tsx              # Chat page
│   │   ├── Sessions.tsx          # Sessions page
│   │   ├── Memory.tsx            # Memory page
│   │   ├── Tasks.tsx             # Tasks page
│   │   ├── MainAgent.tsx         # Main Agent status
│   │   ├── Logs.tsx              # Log viewer
│   │   └── Settings.tsx          # Settings page
│   ├── hooks/
│   │   ├── useApi.ts             # API client hook
│   │   ├── useWebSocket.ts       # WebSocket connection
│   │   ├── useTheme.ts           # Dark theme management
│   │   └── useSession.ts         # Session state
│   ├── utils/
│   │   ├── api.ts                # API client
│   │   ├── format.ts             # Text formatting
│   │   ├── colors.ts             # Color palette
│   │   └── dynamic-classes.ts    # Tailwind utilities
│   ├── App.tsx                   # Main app component
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Global styles
├── index.html
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

## 🎨 Design System

### Color Palette (Ant Colony Theme)

- **Primary**: `#f59e0b` (Amber - for accents)
- **Background**: `#111827` (Dark gray - ant colony)
- **Surface**: `#1f2937` (Lighter gray - surfaces)
- **Border**: `#374151` (Medium gray - dividers)
- **Text**: `#f3f4f6` (Light - primary text)
- **Muted**: `#9ca3af` (Gray - secondary text)

### Components

Each page follows the ANT Colony Control design language:
- Sidebar for persistent navigation
- Header with system status
- Main content area with panels
- Footer with real-time metrics

### Responsive Breakpoints

- Mobile: `< 640px` (hidden sidebar, full-width layout)
- Tablet: `640px - 1024px` (collapsed sidebar)
- Desktop: `> 1024px` (full sidebar visible)

## 🔌 API Integration

The UI communicates with the runtime API at `/api/`:

### Key Endpoints

```
GET  /api/status              → Runtime status
GET  /api/sessions            → List sessions
GET  /api/sessions/:id        → Get session messages
POST /api/sessions/:id        → Send message to session
GET  /api/memory/search       → Search memory
GET  /api/tasks               → List active tasks
GET  /api/logs/stream         → SSE stream of logs
GET  /api/main-agent/status   → Main Agent status
```

### Error Handling

All API calls include error boundaries and retry logic:
- Network errors: Show reconnection banner
- API errors: Display user-friendly messages
- Missing data: Graceful fallbacks to empty states

## 🛠️ Common Tasks

### Add a New Page

1. Create `src/pages/MyPage.tsx`:
```typescript
export default function MyPage() {
  return (
    <div className="min-h-screen bg-ant-dark">
      {/* Your content */}
    </div>
  );
}
```

2. Add route in `App.tsx`:
```typescript
import MyPage from './pages/MyPage';

// In router config
<Route path="/my-page" element={<MyPage />} />
```

3. Add to sidebar navigation in `Sidebar.tsx`

### Add API Call

1. Use the `useApi` hook:
```typescript
const { data, loading, error } = useApi('/api/endpoint');
```

2. Or make manual call:
```typescript
const response = await fetch('/api/endpoint');
const data = await response.json();
```

### Update Styling

Tailwind classes are used throughout. For dynamic colors:
```typescript
import { getDynamicClasses } from '@/utils/dynamic-classes';

// Generate classes dynamically
const classes = getDynamicClasses('bg', 'ant-dark');
```

## 🐛 Troubleshooting

### API calls return 404

- Ensure the runtime is running: `npm run dev -- run -c ant.config.json`
- Check that the runtime is serving on `http://localhost:5117`
- Verify `/api` proxy is configured in `vite.config.ts`

### Tailwind classes not working

- Run `npm run ui:build` to regenerate class mappings
- Check that class names are in `tailwind.config.ts` safelist
- Use `dynamic-classes.ts` for dynamic color generation

### WebSocket not connecting

- Check that the runtime supports Socket.io (`ui.gateway.enabled`)
- Verify firewall isn't blocking WebSocket connections
- Check browser console for connection errors

## 📝 Development Workflow

1. **Start runtime**: `npm run dev -- run -c ant.config.json`
2. **Start UI dev server**: `npm run ui:dev`
3. **Open browser**: `http://localhost:5173`
4. **Make changes**: Files auto-reload on save
5. **Build for production**: `npm run ui:build`

## 🚀 Deployment

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build && npm run ui:build
EXPOSE 5117
CMD ["npm", "start"]
```

### Standalone

The built UI (`ui/dist/`) is completely static and can be served by any web server:

```bash
npm run ui:build
# Serve ui/dist/ on your domain
```

## 📚 Documentation

- **[../README.md](../README.md)** - Main project README
- **[../PROJECT.md](../PROJECT.md)** - Technical architecture
- **Vite Docs**: https://vite.dev
- **React Docs**: https://react.dev
- **Tailwind Docs**: https://tailwindcss.com

## 🔗 Integration Points

The UI integrates with the runtime through:

1. **REST API** - For static data (sessions, settings, status)
2. **Server-Sent Events (SSE)** - For log streaming (`/api/logs/stream`)
3. **WebSocket** - For real-time updates (optional)
4. **File Proxy** - For media display (screenshots, etc.)

All connections include automatic reconnection and error handling.

## 📄 License

MIT
