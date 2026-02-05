/**
 * ANT Colony Simulation UI
 * Main Application Component
 */

import React, { useMemo } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useUIStore, type PageId } from './stores';
import { useRealtimeState } from './realtime/provider';
import { ToastContainer } from './components/base';
import { CommandPalette, type CommandPaletteAction, EntityDrawer, StatusPills } from './components/ops';
import { useQueryClient } from '@tanstack/react-query';
import { createTask, pauseMainAgent, resumeMainAgent, runJob } from './api/client';
import {
  RoyalChamber,
  ForagingGrounds,
  ArchiveChambers,
  Nursery,
  BuildersWorkshop,
  WarRoom,
  SeasonalCycles,
  PheromonTrails,
  GeneticCode,
  Logs,
  Tunnels,
  TaskDetail,
} from './pages';


// Navigation items configuration
const navItems: Array<{
  id: PageId;
  path: string;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    id: 'royal',
    path: '/',
    label: 'Royal Chamber',
    icon: '👑',
    description: 'Colony Dashboard',
  },
  {
    id: 'foraging',
    path: '/foraging',
    label: 'Foraging Grounds',
    icon: '🍂',
    description: 'Task Management',
  },
  {
    id: 'archive',
    path: '/archive',
    label: 'Archive Chambers',
    icon: '🍄',
    description: 'Memory System',
  },
  {
    id: 'nursery',
    path: '/nursery',
    label: 'Nursery',
    icon: '🥚',
    description: 'Agent Lifecycle',
  },
  {
    id: 'builders',
    path: '/builders',
    label: "Builder's Workshop",
    icon: '🔧',
    description: 'Skills & Tools',
  },
  {
    id: 'war',
    path: '/war',
    label: 'War Room',
    icon: '🛡️',
    description: 'Error Monitoring',
  },
  {
    id: 'seasonal',
    path: '/seasonal',
    label: 'Seasonal Cycles',
    icon: '🗓️',
    description: 'Cron Jobs',
  },
  {
    id: 'pheromone',
    path: '/pheromone',
    label: 'Pheromone Trails',
    icon: '✨',
    description: 'Session History',
  },
  {
    id: 'logs',
    path: '/logs',
    label: 'Colony Logs',
    icon: '📜',
    description: 'System Logs',
  },
  {
    id: 'genetic',
    path: '/genetic',
    label: 'Genetic Code',
    icon: '🧬',
    description: 'Configuration',
  },
  {
    id: 'tunnels',
    path: '/tunnels',
    label: 'Tunnels',
    icon: '📡',
    description: 'Channels',
  },
];

// Sidebar component
const Sidebar: React.FC = () => {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <motion.aside
      className="bg-chamber-tunnel border-r border-chamber-wall flex flex-col"
      initial={false}
      animate={{ width: sidebarCollapsed ? 64 : 240 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="p-4 border-b border-chamber-wall flex items-center gap-3">
        <motion.button
          onClick={toggleSidebar}
          className="text-2xl hover:scale-110 transition-transform"
          whileHover={{ rotate: 15 }}
        >
          🐜
        </motion.button>
        {!sidebarCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h1 className="font-bold text-white">ANT Colony</h1>
            <p className="text-xs text-gray-400">Control Interface</p>
          </motion.div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-all ${
                isActive
                  ? 'bg-queen-amber/20 text-queen-amber border border-queen-amber/30'
                  : 'text-gray-400 hover:text-white hover:bg-chamber-wall/50'
              }`
            }
          >
            <span className="text-xl flex-shrink-0">{item.icon}</span>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="min-w-0"
              >
                <div className="font-medium truncate">{item.label}</div>
                <div className="text-xs text-gray-500 truncate">
                  {item.description}
                </div>
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-chamber-wall">
        {!sidebarCollapsed ? (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-nurse-green animate-pulse" />
              Control Plane
            </div>
            <StatusPills />
          </div>
        ) : (
          <div className="flex justify-center">
            <span className="w-2 h-2 rounded-full bg-nurse-green animate-pulse" />
          </div>
        )}
      </div>
    </motion.aside>
  );
};

// Main content area with routes
const MainContent: React.FC = () => {
  return (
    <main className="flex-1 bg-chamber-dark overflow-hidden">
      <Routes>
        <Route path="/" element={<RoyalChamber />} />
        <Route path="/foraging" element={<ForagingGrounds />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/archive" element={<ArchiveChambers />} />
        <Route path="/nursery" element={<Nursery />} />
        <Route path="/builders" element={<BuildersWorkshop />} />
        <Route path="/war" element={<WarRoom />} />
        <Route path="/seasonal" element={<SeasonalCycles />} />
        <Route path="/pheromone" element={<PheromonTrails />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/genetic" element={<GeneticCode />} />
        <Route path="/tunnels" element={<Tunnels />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
};

// Main App component
const App: React.FC = () => {
  const realtime = useRealtimeState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);

  const paletteActions = useMemo<Array<CommandPaletteAction>>(
    () => [
      {
        id: 'pause-queen',
        group: 'Queen',
        label: 'Pause Queen',
        icon: '⏸️',
        onSelect: async () => {
          await pauseMainAgent();
          await queryClient.invalidateQueries({ queryKey: ['status'] });
          addToast({ type: 'success', title: 'Queen paused' });
        },
      },
      {
        id: 'resume-queen',
        group: 'Queen',
        label: 'Resume Queen',
        icon: '▶️',
        onSelect: async () => {
          await resumeMainAgent();
          await queryClient.invalidateQueries({ queryKey: ['status'] });
          addToast({ type: 'success', title: 'Queen resumed' });
        },
      },
      {
        id: 'create-task',
        group: 'Tasks',
        label: 'Create web task…',
        icon: '🍂',
        onSelect: async () => {
          const prompt = window.prompt('Web task prompt:');
          if (!prompt?.trim()) return;
          const res = await createTask(prompt.trim());
          if ((res as any).ok) {
            addToast({ type: 'success', title: 'Task queued' });
            await queryClient.invalidateQueries({ queryKey: ['tasks'] });
            navigate('/foraging');
          } else {
            addToast({ type: 'error', title: 'Task failed', message: (res as any).error ?? 'Unknown error' });
          }
        },
      },
      {
        id: 'run-job',
        group: 'Scheduler',
        label: 'Run job by id…',
        icon: '🗓️',
        onSelect: async () => {
          const id = window.prompt('Job id:');
          if (!id?.trim()) return;
          const res = await runJob(id.trim());
          if ((res as any).ok) {
            addToast({ type: 'success', title: 'Job executed' });
            await queryClient.invalidateQueries({ queryKey: ['jobs'] });
          } else {
            addToast({ type: 'error', title: 'Job failed', message: (res as any).error ?? 'Unknown error' });
          }
        },
      },
      {
        id: 'refresh-status',
        group: 'System',
        label: 'Refresh status',
        icon: '🔄',
        onSelect: async () => {
          await queryClient.invalidateQueries({ queryKey: ['status'] });
          addToast({ type: 'info', title: 'Refreshing status…' });
        },
      },
    ],
    [addToast, navigate, queryClient]
  );

  return (
    <div className="h-screen flex bg-chamber-dark text-white overflow-hidden">
      <Sidebar />
      <MainContent />
      <ToastContainer />
      <EntityDrawer />
      <CommandPalette
        pages={navItems.map((n) => ({
          id: n.id,
          label: n.label,
          path: n.path,
          icon: n.icon,
          description: n.description,
        }))}
        actions={paletteActions}
      />
      {/* Connection indicator */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-gray-500">
        <span
          className={`w-2 h-2 rounded-full ${
            realtime.connected ? 'bg-nurse-green animate-pulse' : 'bg-soldier-rust'
          }`}
        />
        {realtime.connected ? `Connected (${realtime.transport})` : 'Disconnected'}
      </div>
    </div>
  );
};

export default App;
