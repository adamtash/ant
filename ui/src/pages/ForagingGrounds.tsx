/**
 * Foraging Grounds Page
 * Task management and execution tracking
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button, Input, Skeleton } from '../components/base';
import { getStatus, createTask } from '../api/client';
import type { MainTaskStatus } from '../api/types';

export const ForagingGrounds: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<MainTaskStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskPrompt, setNewTaskPrompt] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getStatus();
      setTasks(data.running ?? []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCreateTask = async () => {
    if (!newTaskPrompt.trim()) return;
    setCreating(true);
    try {
      await createTask(newTaskPrompt);
      setNewTaskPrompt('');
      fetchTasks();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge variant="queen" dot pulse>Running</Badge>;
      case 'completed':
        return <Badge variant="nurse" dot>Completed</Badge>;
      case 'error':
        return <Badge variant="soldier" dot>Error</Badge>;
      case 'queued':
        return <Badge variant="default" dot>Queued</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  const formatDuration = (start: number, end?: number) => {
    const duration = (end ?? Date.now()) - start;
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const openTask = (taskId?: string) => {
    if (!taskId) return;
    navigate(`/tasks/${encodeURIComponent(taskId)}`);
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={80} />
        <Skeleton variant="rectangular" height={200} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🍂</span>
            Foraging Grounds
          </h1>
          <p className="text-sm text-gray-400">Task Execution & Management</p>
        </div>
        <Badge variant="queen">{tasks.length} Active</Badge>
      </header>

      {/* New task input */}
      <div className="p-4 border-b border-chamber-wall">
        <div className="flex gap-3">
          <Input
            placeholder="Describe a task for the colony..."
            value={newTaskPrompt}
            onChange={(e) => setNewTaskPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateTask()}
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={handleCreateTask}
            loading={creating}
            disabled={!newTaskPrompt.trim()}
          >
            Send Forager
          </Button>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="popLayout">
          {tasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <span className="text-6xl">🌿</span>
              <h3 className="text-xl font-semibold text-white mt-4">
                No Active Foragers
              </h3>
              <p className="text-gray-400 mt-2">
                Send a forager to explore and gather resources
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task, i) => (
                <motion.div
                  key={task.sessionKey + task.startedAt}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card hoverable className="group" onClick={() => openTask(task.chatId)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">🐜</span>
                          <span className="font-medium text-white truncate">
                            {task.text?.slice(0, 60) ?? 'Unknown Task'}
                            {(task.text?.length ?? 0) > 60 && '...'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-400">
                          <span>Channel: {task.chatId ?? task.sessionKey}</span>
                          <span>•</span>
                          <span>Duration: {formatDuration(task.startedAt, task.endedAt)}</span>
                        </div>
                        {task.error && (
                          <p className="mt-2 text-sm text-soldier-alert">
                            Error: {task.error}
                          </p>
                        )}
                      </div>
                      <div className="ml-4">
                        {getStatusBadge(task.status)}
                        {task.chatId && (
                          <div className="mt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTask(task.chatId);
                              }}
                            >
                              Details
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress indicator for running tasks */}
                    {task.status === 'running' && (
                      <div className="mt-3 pt-3 border-t border-chamber-wall">
                        <div className="h-1 bg-chamber-dark rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-queen-amber"
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: 'linear',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
