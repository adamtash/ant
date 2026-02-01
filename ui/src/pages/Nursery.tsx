/**
 * Nursery Page
 * Agent management and genealogy
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, Badge, Skeleton } from '../components/base';
import { AgentGenealogy } from '../components/complex';
import { getStatus } from '../api/client';
import type { SubagentRecord } from '../api/types';

export const Nursery: React.FC = () => {
  const [agents, setAgents] = useState<SubagentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await getStatus();
      setAgents(data.subagents ?? []);
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
    // Always include queen as root
    const result: Array<{
      id: string;
      name: string;
      caste: string;
      status: string;
      parentId?: string;
    }> = [
      {
        id: 'queen',
        name: 'Queen',
        caste: 'queen',
        status: 'active',
      },
    ];

    // Add other agents as children of queen
    agents.forEach((agent, i) => {
      result.push({
        id: agent.id ?? `agent-${i}`,
        name: agent.label ?? `Worker-${i + 1}`,
        caste: agent.label?.includes('forager') ? 'forager' :
               agent.label?.includes('nurse') ? 'nurse' :
               agent.label?.includes('soldier') ? 'soldier' : 'worker',
        status: agent.status,
        parentId: 'queen',
      });
    });

    return result;
  }, [agents]);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'queen';
      case 'completed': return 'nurse';
      case 'error': return 'soldier';
      default: return 'default';
    }
  };

  const formatDuration = (start: number, end?: number) => {
    const duration = (end ?? Date.now()) - start;
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
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
                  key={agent.id ?? i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card hoverable>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🐜</span>
                        <div>
                          <div className="font-medium text-white">
                            {agent.label ?? `Agent ${agent.id ?? i + 1}`}
                          </div>
                          <div className="text-sm text-gray-400">
                            {agent.task?.slice(0, 50)}
                            {(agent.task?.length ?? 0) > 50 && '...'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400">
                          {formatDuration(agent.createdAt, agent.endedAt)}
                        </span>
                        <Badge
                          variant={getStatusColor(agent.status)}
                          dot
                          pulse={agent.status === 'running'}
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
