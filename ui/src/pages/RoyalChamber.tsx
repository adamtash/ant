/**
 * Royal Chamber Page
 * Main dashboard - the queen's view of the colony
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useColonyStore } from '../stores/colonyStore';
import { useSystemStore } from '../stores/systemStore';
import { useUIStore } from '../stores/uiStore';
import { Card, Badge, Button, Skeleton } from '../components/base';
import { ColonyCanvas } from '../colony/renderer/ColonyCanvas';
import { getStatus } from '../api/client';
import type { StatusResponse, SubagentRecord } from '../api/types';

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
// Quick Actions Component
// ============================================

const QuickActions: React.FC = () => {
  const { navigateTo } = useUIStore();
  const { spawnAnt } = useColonyStore();
  const { addToast } = useUIStore();

  const handleSpawnWorker = () => {
    const id = spawnAnt('worker', { x: 400, y: 300 });
    addToast({
      type: 'success',
      title: 'Worker Spawned',
      message: `Worker ${id} has been created`,
    });
  };

  return (
    <Card>
      <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSpawnWorker}
          icon={<span>🐜</span>}
        >
          Spawn Worker
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateTo('foraging')}
          icon={<span>📋</span>}
        >
          View Tasks
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateTo('archive')}
          icon={<span>📚</span>}
        >
          Memory
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateTo('war')}
          icon={<span>🛡️</span>}
        >
          War Room
        </Button>
      </div>
    </Card>
  );
};

// ============================================
// Main Royal Chamber Page
// ============================================

export const RoyalChamber: React.FC = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { queen, isRunning } = useColonyStore();
  const { queenThinking, totalErrors } = useSystemStore();

  // Fetch status periodically
  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('Failed to connect to colony');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Calculate metrics
  const workerCount = status?.subagents?.length ?? 0;
  const queueDepth = status?.queue?.reduce((acc, q) => acc + q.queued, 0) ?? 0;
  const uptime = status?.time ? Date.now() - status.time : 0;
  const runningTasks = status?.running?.length ?? 0;
  const errorRate = totalErrors > 0 ? Math.min(100, totalErrors * 10) : 0;

  if (loading) {
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
            variant={isRunning ? 'nurse' : 'soldier'}
            dot
            pulse={isRunning}
          >
            {isRunning ? 'Colony Active' : 'Colony Paused'}
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
          <ColonyCanvas width={800} height={600} className="w-full h-full" />

          {/* Overlay stats */}
          <div className="absolute top-4 left-4">
            <QueenHeartbeat
              isActive={queen?.isActive ?? false}
              isThinking={queenThinking}
              iterationCount={runningTasks}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="w-80 border-l border-chamber-wall p-4 space-y-4 overflow-y-auto">
          <ColonyVitals
            workerCount={workerCount}
            queueDepth={queueDepth}
            uptime={uptime}
            errorCount={totalErrors}
          />

          <ThreatMeter errorRate={errorRate} recentErrors={totalErrors} />

          <WorkerGrid workers={status?.subagents ?? []} />

          <QuickActions />
        </aside>
      </div>
    </div>
  );
};
