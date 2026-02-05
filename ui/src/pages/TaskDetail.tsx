/**
 * Task Detail Page
 * Drill-down view for a single web task.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Skeleton, Tabs, TabPanel } from '../components/base';
import { getSession, getTask } from '../api/client';
import type { Task } from '../api/types';
import { JsonPanel, ToolChain } from '../components/ops';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function statusBadge(status: Task['status']): React.ReactNode {
  switch (status) {
    case 'running':
      return <Badge variant="queen" dot pulse>running</Badge>;
    case 'completed':
      return <Badge variant="nurse" dot>completed</Badge>;
    case 'failed':
      return <Badge variant="soldier" dot>failed</Badge>;
    case 'queued':
    default:
      return <Badge variant="default" dot>queued</Badge>;
  }
}

export const TaskDetail: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const taskId = params.id ?? '';
  const [activeTab, setActiveTab] = useState('overview');

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId),
    enabled: Boolean(taskId),
    refetchInterval: (data: any) =>
      data?.status === 'running' || data?.status === 'queued' ? 2000 : false,
  });

  const task = (taskQuery.data ?? null) as Task | null;
  const sessionKey = task?.sessionKey ?? null;

  const sessionQuery = useQuery({
    queryKey: ['session', sessionKey ?? ''],
    queryFn: () => getSession(sessionKey!),
    enabled: Boolean(sessionKey && activeTab === 'session'),
  });

  const resultText = useMemo(() => {
    if (!task?.result) return null;
    if (typeof task.result === 'string') return task.result;
    const maybe = task.result as any;
    if (typeof maybe?.response === 'string') return maybe.response as string;
    return JSON.stringify(task.result, null, 2);
  }, [task?.result]);

  if (taskQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={120} />
        <Skeleton variant="rectangular" height={260} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">📋</span>
            Task Detail
          </h1>
          <p className="text-sm text-gray-400 truncate">{taskId}</p>
        </div>
        <div className="flex items-center gap-2">
          {sessionKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/pheromone?session=${encodeURIComponent(sessionKey)}`)}
            >
              Session
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate('/foraging')}>
            Back
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {taskQuery.isError ? (
          <Card>
            <div className="text-sm text-soldier-alert">
              {(taskQuery.error as Error | undefined)?.message ?? 'Failed to load task'}
            </div>
          </Card>
        ) : task ? (
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-400 mb-1">Description</div>
                <div className="text-white font-medium whitespace-pre-wrap break-words">
                  {task.description}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                  <span>Session: {task.sessionKey}</span>
                  <span>•</span>
                  <span>Created: {new Date(task.createdAt).toLocaleString()}</span>
                  {task.startedAt && (
                    <>
                      <span>•</span>
                      <span>
                        Duration: {formatDuration((task.endedAt ?? Date.now()) - task.startedAt)}
                      </span>
                    </>
                  )}
                </div>
                {task.error && (
                  <div className="mt-3 text-sm text-soldier-alert whitespace-pre-wrap">
                    {task.error}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0">{statusBadge(task.status)}</div>
            </div>
          </Card>
        ) : null}

        <div className="px-1">
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview', icon: <span>🧾</span> },
              { id: 'tools', label: 'Tool Chain', icon: <span>🔧</span> },
              { id: 'session', label: 'Session Messages', icon: <span>✨</span> },
              { id: 'raw', label: 'Raw JSON', icon: <span>📄</span> },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            variant="pills"
          />
        </div>

        <TabPanel tabId="overview" activeTab={activeTab}>
          {resultText ? (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-white">Result</h3>
                {task?.startedAt && (
                  <Badge variant="default">
                    {formatDuration((task.endedAt ?? Date.now()) - task.startedAt)}
                  </Badge>
                )}
              </div>
              <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-chamber-dark rounded-lg p-3 border border-chamber-wall">
                {resultText}
              </pre>
            </Card>
          ) : (
            <Card>
              <div className="text-sm text-gray-500">No result yet.</div>
            </Card>
          )}
        </TabPanel>

        <TabPanel tabId="tools" activeTab={activeTab}>
          {sessionKey ? (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-white">Tool Chain</h3>
                <Badge variant="default">/api/sessions/:key/tool-parts</Badge>
              </div>
              <ToolChain sessionKey={sessionKey} />
            </Card>
          ) : (
            <Card>
              <div className="text-sm text-gray-500">No sessionKey available.</div>
            </Card>
          )}
        </TabPanel>

        <TabPanel tabId="session" activeTab={activeTab}>
          {!sessionKey ? (
            <Card>
              <div className="text-sm text-gray-500">No sessionKey available.</div>
            </Card>
          ) : sessionQuery.isLoading ? (
            <Skeleton variant="rectangular" height={140} />
          ) : (
            <JsonPanel
              title="Session JSON"
              endpoint={`/api/sessions/${encodeURIComponent(sessionKey)}`}
              value={sessionQuery.data ?? { loading: true }}
            />
          )}
        </TabPanel>

        <TabPanel tabId="raw" activeTab={activeTab}>
          <JsonPanel
            title="Task JSON"
            endpoint={`/api/tasks/${encodeURIComponent(taskId)}`}
            value={task ?? { loading: true }}
          />
        </TabPanel>
      </div>
    </div>
  );
};

