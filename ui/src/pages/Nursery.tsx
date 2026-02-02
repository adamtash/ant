/**
 * Nursery Page
 * Agent management and genealogy
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, Badge, Skeleton } from '../components/base';
import { AgentGenealogy } from '../components/complex';
import { getAgents } from '../api/client';
import type { AgentsApiResponse } from '../api/client';

export const Nursery: React.FC = () => {
  const [agents, setAgents] = useState<AgentsApiResponse['agents']>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await getAgents();
      setAgents(data.agents ?? []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Transform agents for genealogy component
  const genealogyAgents = useMemo(() => {
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      caste: agent.caste,
      status: agent.status,
      parentId: agent.parentAgentId,
    }));
  }, [agents]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'running': return 'queen';
      case 'completed':
      case 'retired': return 'nurse';
      case 'error': return 'soldier';
      case 'spawning': return 'architect';
      case 'thinking': return 'drone';
      default: return 'default';
    }
  };

  const getCasteIcon = (caste: string) => {
    switch (caste) {
      case 'queen': return '👑';
      case 'worker': return '🐜';
      case 'soldier': return '🛡️';
      case 'nurse': return '🍼';
      case 'forager': return '🌾';
      case 'architect': return '🔧';
      case 'drone': return '🚁';
      default: return '🐜';
    }
  };

  const getCasteBadgeVariant = (caste: string): 'queen' | 'worker' | 'soldier' | 'nurse' | 'architect' | 'drone' | 'default' => {
    switch (caste) {
      case 'queen': return 'queen';
      case 'worker': return 'worker';
      case 'soldier': return 'soldier';
      case 'nurse': return 'nurse';
      case 'architect': return 'architect';
      case 'drone': return 'drone';
      default: return 'default';
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={100} />
        <Skeleton variant="rectangular" height={400} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🥚</span>
            Nursery
          </h1>
          <p className="text-sm text-gray-400">Agent Lifecycle & Genealogy</p>
        </div>
        <Badge variant="nurse">{agents.length} agents</Badge>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {agents.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-6xl">🥚</span>
            <h3 className="text-xl font-semibold text-white mt-4">
              Nursery is Quiet
            </h3>
            <p className="text-gray-400 mt-2">
              No agents are currently active. Eggs will hatch when tasks arrive.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* Family Tree Visualization */}
            <Card className="col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4">
                Colony Family Tree
              </h3>
              <div className="flex justify-center">
                <AgentGenealogy
                  agents={genealogyAgents}
                  width={700}
                  height={300}
                  onAgentClick={(id) => console.log('Agent clicked:', id)}
                />
              </div>
            </Card>

            {/* Agent List */}
            <div className="col-span-2 space-y-3">
              <h3 className="text-lg font-semibold text-white">Active Agents</h3>
              {agents.map((agent, i) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card hoverable>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getCasteIcon(agent.caste)}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{agent.name}</span>
                            <Badge variant={getCasteBadgeVariant(agent.caste)} size="sm">{agent.caste}</Badge>
                            {agent.metadata.specialization.map((spec) => (
                              <span key={spec} className="text-xs text-gray-500">{spec}</span>
                            ))}
                          </div>
                          <div className="text-sm text-gray-400">
                            {agent.currentTask?.slice(0, 60) || 'Idle'}
                            {(agent.currentTask?.length ?? 0) > 60 && '...'}
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                            <span>⚡ Energy: {agent.metadata.energy}%</span>
                            <span>📊 Tasks: {agent.taskCount}</span>
                            <span>⏱️ Avg: {formatDuration(agent.averageDuration)}</span>
                            {agent.errorCount > 0 && (
                              <span className="text-soldier-alert">⚠️ Errors: {agent.errorCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400">
                          {formatDuration(Date.now() - agent.createdAt)}
                        </span>
                        <Badge
                          variant={getStatusColor(agent.status)}
                          dot
                          pulse={agent.status === 'active' || agent.status === 'thinking'}
                        >
                          {agent.status}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
