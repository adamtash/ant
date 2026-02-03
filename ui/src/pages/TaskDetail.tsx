/**
 * Task Detail Page
 * Drill-down view for a single task, including tool execution history.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Badge, Button, Skeleton } from '../components/base';
import { getSessionToolParts, getTaskRaw } from '../api/client';

type BackendTask = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  description: string;
  sessionKey: string;
  chatId: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
};

type ToolPart = {
  id: string;
  tool: string;
  state:
    | { status: 'pending'; input: Record<string, unknown>; raw: string }
    | { status: 'running'; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
    | { status: 'completed'; input: Record<string, unknown>; title: string; output: string; metadata?: Record<string, unknown>; time: { start: number; end: number } }
    | { status: 'error'; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } };
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function getToolStart(part: ToolPart): number {
  if (part.state.status === 'running') return part.state.time.start;
  if (part.state.status === 'completed') return part.state.time.start;
  if (part.state.status === 'error') return part.state.time.start;
  return 0;
}

function getToolDuration(part: ToolPart): number | null {
  if (part.state.status === 'completed') return part.state.time.end - part.state.time.start;
  if (part.state.status === 'error') return part.state.time.end - part.state.time.start;
  return null;
}

function statusBadge(status: BackendTask['status']): React.ReactNode {
  switch (status) {
    case 'running':
      return <Badge variant="queen" dot pulse>Running</Badge>;
    case 'completed':
      return <Badge variant="nurse" dot>Completed</Badge>;
    case 'failed':
      return <Badge variant="soldier" dot>Failed</Badge>;
    case 'queued':
    default:
      return <Badge variant="default" dot>Queued</Badge>;
  }
}

export const TaskDetail: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const taskId = params.id ?? '';

  const [task, setTask] = useState<BackendTask | null>(null);
  const [toolParts, setToolParts] = useState<ToolPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTask = useCallback(async () => {
    if (!taskId) return;
    const next = (await getTaskRaw(taskId)) as BackendTask;
    setTask(next);
    return next;
  }, [taskId]);

  const fetchTools = useCallback(async (sessionKey: string) => {
    const data = await getSessionToolParts(sessionKey);
    setToolParts((data.toolParts ?? []) as ToolPart[]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchTask();
      if (next?.sessionKey) {
        await fetchTools(next.sessionKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchTask, fetchTools]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  const sortedToolParts = useMemo(() => {
    return [...toolParts].sort((a, b) => getToolStart(a) - getToolStart(b));
  }, [toolParts]);

  const resultText = useMemo(() => {
    if (!task?.result) return null;
    if (typeof task.result === 'string') return task.result;
    const maybe = task.result as any;
    if (typeof maybe?.response === 'string') return maybe.response as string;
    return JSON.stringify(task.result, null, 2);
  }, [task?.result]);

  if (loading) {
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
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">📋</span>
            Task Detail
          </h1>
          <p className="text-sm text-gray-400">{taskId}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/foraging')}>
            Back
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <Card className="border border-soldier-alert/30 bg-soldier-alert/10">
            <div className="text-soldier-alert text-sm">Error: {error}</div>
          </Card>
        )}

        {task && (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-gray-400 mb-1">Description</div>
                <div className="text-white font-medium whitespace-pre-wrap break-words">
                  {task.description}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                  <span>Session: {task.sessionKey}</span>
                  <span>•</span>
                  <span>
                    Created: {new Date(task.createdAt).toLocaleString()}
                  </span>
                  {task.startedAt && (
                    <>
                      <span>•</span>
                      <span>Duration: {formatDuration((task.endedAt ?? Date.now()) - task.startedAt)}</span>
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
        )}

        {resultText && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Result</h3>
              {task && task.startedAt && (
                <Badge variant="default">{formatDuration((task.endedAt ?? Date.now()) - task.startedAt)}</Badge>
              )}
            </div>
            <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-chamber-dark rounded-lg p-3 border border-chamber-wall">
              {resultText}
            </pre>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white">Tool Chain</h3>
            <Badge variant="default">{sortedToolParts.length}</Badge>
          </div>

          {sortedToolParts.length === 0 ? (
            <div className="text-sm text-gray-500">No tool calls recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {sortedToolParts.map((part) => {
                const dur = getToolDuration(part);
                const status = part.state.status;
                return (
                  <div key={part.id} className="p-3 bg-chamber-dark rounded-lg border border-chamber-wall">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{part.tool}</div>
                        <div className="text-xs text-gray-500 truncate">{part.id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {dur !== null && <Badge variant="default">{formatDuration(dur)}</Badge>}
                        <Badge variant={status === 'completed' ? 'nurse' : status === 'error' ? 'soldier' : status === 'running' ? 'queen' : 'default'} dot pulse={status === 'running'}>
                          {status}
                        </Badge>
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gray-400">Details</summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Input</div>
                          <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-black/20 rounded p-2 border border-chamber-wall">
                            {JSON.stringify(part.state.input, null, 2)}
                          </pre>
                        </div>
                        {part.state.status === 'completed' && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Output</div>
                            <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-black/20 rounded p-2 border border-chamber-wall">
                              {part.state.output}
                            </pre>
                          </div>
                        )}
                        {part.state.status === 'error' && (
                          <div className="text-xs text-soldier-alert whitespace-pre-wrap">
                            {part.state.error}
                          </div>
                        )}
                        {part.state.status === 'pending' && (
                          <div className="text-xs text-gray-500 whitespace-pre-wrap">
                            {part.state.raw}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

