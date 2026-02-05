/**
 * Royal Chamber Page
 * Main dashboard - the queen's view of the colony
 */

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useColonyStore } from '../stores/colonyStore';
import { useUIStore } from '../stores/uiStore';
import { Card, Badge, Button, Input, Modal, Skeleton } from '../components/base';
import { ColonyScene3D } from '../colony/renderer/ColonyScene3D';
import { assignMainAgentTask, createTask, pauseMainAgent, resumeMainAgent, getProviderHealth, getStatus } from '../api/client';
import type { SubagentRecord } from '../api/types';
import { useEventsStore } from '../state/eventsStore';
import { JsonPanel } from '../components/ops';

// ============================================
// Provider Health Component
// ============================================

interface ProviderHealthData {
  id: string;
  name: string;
  type: 'openai' | 'cli' | 'ollama';
  model: string;
  status: 'healthy' | 'degraded' | 'cooldown' | 'offline';
  stats: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    errorRate: number;
  };
  cooldown?: {
    until: number;
    reason: string;
  };
}

interface ProviderHealthPanelProps {
  providers: ProviderHealthData[];
}

const ProviderHealthPanel: React.FC<ProviderHealthPanelProps> = ({ providers }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'degraded': return '⚠️';
      case 'cooldown': return '⏸️';
      case 'offline': return '❌';
      default: return '❓';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'nurse';
      case 'degraded': return 'queen';
      case 'cooldown': return 'architect';
      case 'offline': return 'soldier';
      default: return 'default';
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Provider Health</h3>
        <Badge variant="default">{providers.length} providers</Badge>
      </div>

      {providers.length === 0 ? (
        <div className="text-center py-4 text-gray-500">
          <p>No providers configured</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="p-3 bg-chamber-dark rounded-lg border border-chamber-wall"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getStatusIcon(provider.status)}</span>
                  <div>
                    <div className="font-medium text-white text-sm">{provider.name}</div>
                    <div className="text-xs text-gray-500">{provider.model}</div>
                  </div>
                </div>
                <Badge variant={getStatusColor(provider.status)} size="sm">
                  {provider.status}
                </Badge>
              </div>
              
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span>Req: {provider.stats.requestCount}</span>
                <span className={provider.stats.errorRate > 10 ? 'text-soldier-alert' : ''}>
                  Errors: {provider.stats.errorRate}%
                </span>
                <span>Avg: {provider.stats.avgResponseTime}ms</span>
              </div>
              
              {provider.cooldown && (
                <div className="mt-2 text-xs text-architect-sky">
                  ⏸️ Cooldown until {new Date(provider.cooldown.until).toLocaleTimeString()}
                  <span className="ml-1 text-gray-500">({provider.cooldown.reason})</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ============================================
// Queen Heartbeat Component
// ============================================

interface QueenHeartbeatProps {
  isActive: boolean;
  isThinking: boolean;
  iterationCount: number;
}

const QueenHeartbeat: React.FC<QueenHeartbeatProps> = ({
  isActive,
  isThinking,
  iterationCount,
}) => {
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="text-2xl">👑</span>
            Queen Status
          </h3>
          <p className="text-sm text-gray-400 mt-1">Main Agent</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={isActive ? 'queen' : 'default'}
            dot
            pulse={isThinking}
          >
            {isThinking ? 'Thinking' : isActive ? 'Active' : 'Idle'}
          </Badge>
        </div>
      </div>

      {/* Iteration counter */}
      {isThinking && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-queen-amber/10 rounded-lg border border-queen-amber/20"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-queen-amber">Tool Iterations</span>
            <span className="text-xl font-bold text-queen-amber">
              {iterationCount}
            </span>
          </div>
          <div className="mt-2 h-1 bg-queen-amber/20 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-queen-amber"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, iterationCount * 16.6)}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </motion.div>
      )}

      {/* Pulse animation overlay */}
      {isActive && (
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            className="absolute inset-0 bg-queen-amber/5"
            animate={{
              opacity: [0.05, 0.15, 0.05],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>
      )}
    </Card>
  );
};

// ============================================
// Colony Vitals Component
// ============================================

interface ColonyVitalsProps {
  workerCount: number;
  queueDepth: number;
  uptime: number;
  errorCount: number;
}

const ColonyVitals: React.FC<ColonyVitalsProps> = ({
  workerCount,
  queueDepth,
  uptime,
  errorCount,
}) => {
  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const stats = [
    {
      label: 'Active Workers',
      value: workerCount,
      icon: '🐜',
      color: 'text-worker-brown',
    },
    {
      label: 'Queue Depth',
      value: queueDepth,
      icon: '📋',
      color: 'text-forager-orange',
    },
    {
      label: 'Colony Age',
      value: formatUptime(uptime),
      icon: '⏱️',
      color: 'text-nurse-green',
    },
    {
      label: 'Threats',
      value: errorCount,
      icon: '⚠️',
      color: errorCount > 0 ? 'text-soldier-alert' : 'text-gray-400',
    },
  ];

  return (
    <Card>
      <h3 className="text-lg font-semibold text-white mb-4">Colony Vitals</h3>
      <div className="grid grid-cols-2 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="p-3 bg-chamber-dark rounded-lg border border-chamber-wall"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{stat.icon}</span>
              <span className="text-xs text-gray-400">{stat.label}</span>
            </div>
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ============================================
// Worker Grid Component
// ============================================

interface WorkerGridProps {
  workers: SubagentRecord[];
}

const WorkerGrid: React.FC<WorkerGridProps> = ({ workers }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'queen';
      case 'completed':
        return 'nurse';
      case 'error':
        return 'soldier';
      default:
        return 'default';
    }
  };

  const getCasteEmoji = (label?: string) => {
    if (label?.includes('forager')) return '🐜';
    if (label?.includes('nurse')) return '🩺';
    if (label?.includes('builder')) return '🔧';
    if (label?.includes('scout')) return '🔍';
    return '🐜';
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Active Workers</h3>
        <Badge variant="default">{workers.length}</Badge>
      </div>

      {workers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <span className="text-4xl">🥚</span>
          <p className="mt-2">No active workers</p>
          <p className="text-sm">Workers spawn when tasks are created</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {workers.slice(0, 6).map((worker, i) => (
            <motion.div
              key={worker.id ?? i}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-3 bg-chamber-dark rounded-lg border border-chamber-wall"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{getCasteEmoji(worker.label)}</span>
                <span className="text-sm font-medium text-white truncate">
                  {worker.label ?? `Worker ${i + 1}`}
                </span>
              </div>
              <Badge
                variant={getStatusColor(worker.status)}
                size="sm"
                dot
                pulse={worker.status === 'running'}
              >
                {worker.status}
              </Badge>
              <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                {worker.task}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {workers.length > 6 && (
        <p className="text-sm text-gray-400 text-center mt-3">
          +{workers.length - 6} more workers
        </p>
      )}
    </Card>
  );
};

// ============================================
// Threat Meter Component
// ============================================

interface ThreatMeterProps {
  errorRate: number; // 0-100
  recentErrors: number;
}

const ThreatMeter: React.FC<ThreatMeterProps> = ({ errorRate, recentErrors }) => {
  const getThreatLevel = () => {
    if (errorRate > 50) return { label: 'Critical', color: 'soldier-alert', textClass: 'text-soldier-alert', bgClass: 'bg-soldier-alert' };
    if (errorRate > 25) return { label: 'High', color: 'soldier-rust', textClass: 'text-soldier-rust', bgClass: 'bg-soldier-rust' };
    if (errorRate > 10) return { label: 'Elevated', color: 'queen-amber', textClass: 'text-queen-amber', bgClass: 'bg-queen-amber' };
    return { label: 'Normal', color: 'nurse-green', textClass: 'text-nurse-green', bgClass: 'bg-nurse-green' };
  };

  const threat = getThreatLevel();

  return (
    <Card>
      <h3 className="text-lg font-semibold text-white mb-4">Threat Level</h3>

      <div className="flex items-center justify-between mb-3">
        <span className={`text-2xl font-bold ${threat.textClass}`}>
          {threat.label}
        </span>
        <Badge
          variant={errorRate > 25 ? 'soldier' : 'default'}
          dot={recentErrors > 0}
          pulse={recentErrors > 0}
        >
          {recentErrors} recent
        </Badge>
      </div>

      <div className="h-3 bg-chamber-dark rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${threat.bgClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${errorRate}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>0%</span>
        <span>Error Rate</span>
        <span>100%</span>
      </div>
    </Card>
  );
};

// ============================================
// Scene Controls Component
// ============================================

const SceneControls: React.FC = () => {
  const { zoomBy, setViewport } = useColonyStore();

  return (
    <div className="absolute bottom-6 right-6 flex flex-col gap-2">
      <div className="bg-chamber-dark/80 backdrop-blur border border-chamber-wall rounded-lg p-1 flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => zoomBy(1.2)}
          title="Zoom In"
          className="w-10 h-10"
        >
          ➕
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => zoomBy(0.8)}
          title="Zoom Out"
          className="w-10 h-10"
        >
          ➖
        </Button>
        <div className="h-px bg-chamber-wall my-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewport({ x: 0, y: 0 }, 1)}
          title="Recenter"
          className="w-10 h-10 text-xs"
        >
          🎯
        </Button>
      </div>
    </div>
  );
};

// ============================================
// Main Royal Chamber Page
// ============================================

export const RoyalChamber: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();
  const { queen } = useColonyStore();
  const events = useEventsStore((s) => s.events);

  const [rawOpen, setRawOpen] = React.useState(false);
  const [dutyText, setDutyText] = React.useState("");
  const [quickTask, setQuickTask] = React.useState("");

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: getStatus,
  });

  const providerHealthQuery = useQuery({
    queryKey: ['providerHealth'],
    queryFn: getProviderHealth,
    refetchInterval: 10_000,
  });

  const status = statusQuery.data ?? null;
  const providers = (providerHealthQuery.data as any)?.providers ?? [];
  const error = (statusQuery.error as Error | undefined)?.message ?? null;

  const pauseMutation = useMutation({
    mutationFn: pauseMainAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["status"] });
      addToast({ type: "success", title: "Queen paused" });
    },
    onError: (err) => addToast({ type: "error", title: "Pause failed", message: err instanceof Error ? err.message : String(err) }),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeMainAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["status"] });
      addToast({ type: "success", title: "Queen resumed" });
    },
    onError: (err) => addToast({ type: "error", title: "Resume failed", message: err instanceof Error ? err.message : String(err) }),
  });

  const assignDutyMutation = useMutation({
    mutationFn: (description: string) => assignMainAgentTask(description),
    onSuccess: async () => {
      setDutyText("");
      await queryClient.invalidateQueries({ queryKey: ["status"] });
      addToast({ type: "success", title: "Duty assigned" });
    },
    onError: (err) => addToast({ type: "error", title: "Assign failed", message: err instanceof Error ? err.message : String(err) }),
  });

  const quickTaskMutation = useMutation({
    mutationFn: (prompt: string) => createTask(prompt),
    onSuccess: async () => {
      setQuickTask("");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      addToast({ type: "success", title: "Task queued" });
    },
    onError: (err) => addToast({ type: "error", title: "Task failed", message: err instanceof Error ? err.message : String(err) }),
  });

  // Sync Queen to Main Agent status
  useEffect(() => {
    const colonyStore = useColonyStore.getState();
    
    if (status?.mainAgent) {
      // Activate queen if main agent is enabled
      if (status.mainAgent.running) {
        colonyStore.activateQueen();
        colonyStore.ensureQueenAttendants(3);
      } else {
        colonyStore.deactivateQueen();
        colonyStore.clearQueenAttendants();
      }
      
      // Set thinking state based on active tasks
      const hasActiveTask = status.mainAgent.tasks?.some(
        t => t.status === 'running'
      );
      colonyStore.setQueenThinking(hasActiveTask ?? false);
    }
  }, [status]);

  // Calculate metrics
  const workerCount = status?.subagents?.length ?? 0;
  const queueDepth = status?.queue?.reduce((acc, q) => acc + q.queued, 0) ?? 0;
  const uptime = (status as any)?.health?.uptime ?? (status?.time ? Date.now() - status.time : 0);
  const runningTasks = status?.running?.length ?? 0;
  const healthTotalErrors = (status as any)?.health?.totalErrors;
  const errorCount = typeof healthTotalErrors === "number" ? healthTotalErrors : 0;
  const errorRate = Math.min(100, ((status as any)?.health?.errorRate ?? 0) * 10);
  const feed = events.slice().reverse().slice(0, 20);
  const queenThinking = Boolean(status?.mainAgent?.tasks?.some((t: any) => t.status === "running" || t.status === "queued" || t.status === "retrying"));
  const mainAgentRunning = Boolean((status as any)?.mainAgent?.running);

  if (statusQuery.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton variant="rectangular" height={150} />
        <div className="grid grid-cols-3 gap-6">
          <Skeleton variant="rectangular" height={200} />
          <Skeleton variant="rectangular" height={200} />
          <Skeleton variant="rectangular" height={200} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">👑</span>
            Royal Chamber
          </h1>
          <p className="text-sm text-gray-400">Colony Command Center</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={mainAgentRunning ? 'nurse' : 'soldier'}
            dot
            pulse={mainAgentRunning}
          >
            {mainAgentRunning ? 'Queen Running' : 'Queen Paused'}
          </Badge>
          {error && (
            <Badge variant="soldier" dot>
              {error}
            </Badge>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Colony visualization (center) */}
        <div className="flex-1 relative">
          <ColonyScene3D className="w-full h-full" />

          {/* Overlay stats */}
          <div className="absolute top-4 left-4">
            <QueenHeartbeat
              isActive={queen?.isActive ?? false}
              isThinking={queenThinking}
              iterationCount={runningTasks}
            />
          </div>

          {/* Scene Controls */}
          <SceneControls />
        </div>

        {/* Right sidebar */}
        <aside className="w-80 border-l border-chamber-wall p-4 space-y-4 overflow-y-auto">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Queen Console</h3>
              <Badge variant={(status as any)?.mainAgent?.running ? "queen" : "default"} size="sm" dot pulse={(status as any)?.mainAgent?.running}>
                {(status as any)?.mainAgent?.running ? "running" : "paused"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => pauseMutation.mutate()}
                loading={pauseMutation.isPending}
              >
                Pause
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => resumeMutation.mutate()}
                loading={resumeMutation.isPending}
              >
                Resume
              </Button>
            </div>
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">Assign duty</div>
              <div className="flex gap-2">
                <Input
                  placeholder="Describe a duty for the queen…"
                  value={dutyText}
                  onChange={(e) => setDutyText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && dutyText.trim() && assignDutyMutation.mutate(dutyText.trim())}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!dutyText.trim()}
                  loading={assignDutyMutation.isPending}
                  onClick={() => assignDutyMutation.mutate(dutyText.trim())}
                >
                  Assign
                </Button>
              </div>
            </div>
          </Card>

          <ColonyVitals
            workerCount={workerCount}
            queueDepth={queueDepth}
            uptime={uptime}
            errorCount={errorCount}
          />

          <ThreatMeter errorRate={errorRate} recentErrors={errorCount} />

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Active Task</h3>
              <Badge variant="default">{status?.running?.length ?? 0}</Badge>
            </div>
            {status?.running && status.running.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm text-white font-medium line-clamp-2">
                  {status.running[0]?.text ?? 'Task'}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="truncate">{status.running[0]?.chatId ?? status.running[0]?.sessionKey}</span>
                  <Badge variant="queen" dot pulse>
                    {status.running[0]?.status ?? 'running'}
                  </Badge>
                </div>
                {status.running[0]?.chatId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/tasks/${encodeURIComponent(status.running[0]!.chatId!)}`)}
                  >
                    View Details
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">No active tasks.</div>
            )}
          </Card>

          <WorkerGrid workers={status?.subagents ?? []} />

          <ProviderHealthPanel providers={providers} />

          <Card>
            <h3 className="text-lg font-semibold text-white mb-3">Quick Task</h3>
            <div className="flex gap-2">
              <Input
                placeholder="Ask the colony…"
                value={quickTask}
                onChange={(e) => setQuickTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && quickTask.trim() && quickTaskMutation.mutate(quickTask.trim())}
                className="flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!quickTask.trim()}
                loading={quickTaskMutation.isPending}
                onClick={() => quickTaskMutation.mutate(quickTask.trim())}
              >
                Send
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => navigate("/foraging")}>
                Open Foraging
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRawOpen(true)}>
                Raw Status
              </Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Activity Feed</h3>
              <Badge variant="default" size="sm">{feed.length}</Badge>
            </div>
            {feed.length === 0 ? (
              <div className="text-sm text-gray-500">No recent events.</div>
            ) : (
              <div className="space-y-2">
                {feed.map((evt) => (
                  <div key={evt.id} className="p-2 bg-chamber-dark rounded border border-chamber-wall">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-gray-400 truncate">{evt.type}</div>
                      <Badge variant={evt.severity === "critical" || evt.severity === "error" ? "soldier" : evt.severity === "warn" ? "queen" : "default"} size="sm">
                        {evt.severity}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 truncate">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                      {evt.sessionKey ? ` · ${evt.sessionKey}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>

      <Modal isOpen={rawOpen} onClose={() => setRawOpen(false)} title="Raw Status" size="full">
        <JsonPanel title="Status JSON" endpoint="/api/status" value={status ?? { loading: true }} />
      </Modal>
    </div>
  );
};
