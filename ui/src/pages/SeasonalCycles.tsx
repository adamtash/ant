/**
 * Seasonal Cycles Page
 * Cron job management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, Badge, Button, Skeleton } from '../components/base';
import { getJobs, toggleJob, runJob } from '../api/client';
import type { CronJob } from '../api/types';

export const SeasonalCycles: React.FC = () => {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await getJobs();
      setJobs(data.jobs ?? []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleToggle = async (id: string) => {
    try {
      await toggleJob(id);
      fetchJobs();
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      await runJob(id);
      fetchJobs();
    } catch (err) {
      console.error('Failed to run job:', err);
    }
  };

  const formatNextRun = (timestamp: number) => {
    const diff = timestamp - Date.now();
    if (diff < 0) return 'Now';
    if (diff < 60000) return 'Soon';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}d`;
  };

  const formatLastRun = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={80} />
        <Skeleton variant="rectangular" height={300} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🗓️</span>
            Seasonal Cycles
          </h1>
          <p className="text-sm text-gray-400">Scheduled Tasks (Drone Flights)</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="drone">{jobs.length} schedules</Badge>
          <Button variant="primary" size="sm">
            + New Schedule
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {jobs.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-6xl">🌸</span>
            <h3 className="text-xl font-semibold text-white mt-4">
              No Seasonal Events
            </h3>
            <p className="text-gray-400 mt-2">
              Schedule drone flights for automated tasks
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job, i) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={!job.enabled ? 'opacity-60' : ''}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <motion.span
                        className="text-3xl"
                        animate={job.enabled ? { y: [0, -5, 0] } : {}}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        🪽
                      </motion.span>
                      <div>
                        <h3 className="font-semibold text-white">{job.name}</h3>
                        <p className="text-sm text-gray-400 mt-1">
                          {job.naturalLanguage ?? job.schedule}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <span>Last: {formatLastRun(job.lastRunAt)}</span>
                          <span>•</span>
                          <span>Next: {formatNextRun(job.nextRunAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={job.enabled ? 'drone' : 'default'}
                        dot
                        pulse={job.enabled}
                      >
                        {job.enabled ? 'Active' : 'Paused'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(job.id)}
                      >
                        {job.enabled ? 'Pause' : 'Enable'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRunNow(job.id)}
                      >
                        Run Now
                      </Button>
                    </div>
                  </div>

                  {/* Execution history */}
                  {job.executionHistory.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-chamber-wall">
                      <h4 className="text-xs font-medium text-gray-400 mb-2">
                        Recent Flights
                      </h4>
                      <div className="flex gap-1">
                        {job.executionHistory.slice(-10).map((exec, i) => (
                          <div
                            key={i}
                            className={`w-6 h-2 rounded-full ${
                              exec.status === 'success'
                                ? 'bg-nurse-green'
                                : exec.status === 'error'
                                ? 'bg-soldier-alert'
                                : 'bg-gray-500'
                            }`}
                            title={`${exec.status} - ${new Date(exec.runAt).toLocaleString()}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
