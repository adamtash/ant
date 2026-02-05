/**
 * Foraging Grounds Page
 * Web task management (/api/tasks)
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge, Button, Input, Skeleton } from '../components/base';
import { createTask, getTasksPage } from '../api/client';
import type { Task } from '../api/types';
import { DataTable } from '../components/ops';

export const ForagingGrounds: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newTaskPrompt, setNewTaskPrompt] = useState('');
  const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all');
  const [search, setSearch] = useState('');

  const tasksQuery = useQuery({
    queryKey: ['tasks', { limit: 200, offset: 0 }],
    queryFn: () => getTasksPage({ limit: 200, offset: 0 }),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (prompt: string) => createTask(prompt),
    onSuccess: async () => {
      setNewTaskPrompt('');
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const tasks = (tasksQuery.data?.tasks ?? []) as Task[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks
      .filter((t) => (statusFilter === 'all' ? true : t.status === statusFilter))
      .filter((t) => (q ? t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [search, statusFilter, tasks]);

  const columns = useMemo<Array<ColumnDef<Task>>>(
    () => [
      {
        header: 'Status',
        accessorKey: 'status',
        cell: (ctx) => (
          <Badge
            variant={
              ctx.row.original.status === 'running'
                ? 'queen'
                : ctx.row.original.status === 'completed'
                ? 'nurse'
                : ctx.row.original.status === 'failed'
                ? 'soldier'
                : 'default'
            }
            dot
            pulse={ctx.row.original.status === 'running'}
          >
            {ctx.row.original.status}
          </Badge>
        ),
      },
      {
        header: 'Task',
        accessorKey: 'description',
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="text-white truncate">{ctx.row.original.description}</div>
            <div className="text-xs text-gray-500 font-mono truncate">{ctx.row.original.id}</div>
          </div>
        ),
      },
      {
        header: 'Created',
        accessorKey: 'createdAt',
        cell: (ctx) => <span className="text-xs text-gray-400">{new Date(ctx.row.original.createdAt).toLocaleString()}</span>,
      },
      {
        header: 'Session',
        accessorKey: 'sessionKey',
        cell: (ctx) => <span className="text-xs text-gray-500 font-mono truncate">{ctx.row.original.sessionKey}</span>,
      },
    ],
    []
  );

  if (tasksQuery.isLoading) {
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
          <p className="text-sm text-gray-400">Web Tasks (/api/tasks)</p>
        </div>
        <Badge variant="queen">{filtered.length} tasks</Badge>
      </header>

      {/* New task input */}
      <div className="p-4 border-b border-chamber-wall">
        <div className="flex gap-3 items-center">
          <Input
            placeholder="Describe a task for the colony..."
            value={newTaskPrompt}
            onChange={(e) => setNewTaskPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newTaskPrompt.trim() && createMutation.mutate(newTaskPrompt.trim())}
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={() => createMutation.mutate(newTaskPrompt.trim())}
            loading={createMutation.isPending}
            disabled={!newTaskPrompt.trim()}
          >
            Send Forager
          </Button>
        </div>
        <div className="mt-3 flex gap-3">
          <Input
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
          </select>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4">
        <DataTable
          data={filtered}
          columns={columns}
          onRowClick={(row) => navigate(`/tasks/${encodeURIComponent(row.id)}`)}
          empty={
            <div className="text-center py-10">
              <div className="text-4xl">🌿</div>
              <div className="mt-2 text-sm text-gray-400">No tasks match filters.</div>
            </div>
          }
        />
      </div>
    </div>
  );
};
