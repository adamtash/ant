/**
 * ANT Colony Simulation UI
 * Main Application Component
 */

import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useUIStore, type PageId } from './stores';
import { useEventConnection } from './api/eventHandler';
import { ToastContainer } from './components/base';
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
    id: 'genetic',
    path: '/genetic',
    label: 'Genetic Code',
    icon: '🧬',
    description: 'Configuration',
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
          <div className="text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-nurse-green animate-pulse" />
              Colony Active
            </div>
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
        <Route path="/archive" element={<ArchiveChambers />} />
        <Route path="/nursery" element={<Nursery />} />
        <Route path="/builders" element={<BuildersWorkshop />} />
        <Route path="/war" element={<WarRoom />} />
        <Route path="/seasonal" element={<SeasonalCycles />} />
        <Route path="/pheromone" element={<PheromonTrails />} />
        <Route path="/genetic" element={<GeneticCode />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
};

// Main App component
const App: React.FC = () => {
  // Connect to backend events
  const isConnected = useEventConnection();

  return (
    <div className="h-screen flex bg-chamber-dark text-white overflow-hidden">
      <Sidebar />
      <MainContent />
      <ToastContainer />
      {/* Connection indicator */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-gray-500">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-nurse-green animate-pulse' : 'bg-soldier-rust'
          }`}
        />
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>
    </div>
  );
};

export default App;
