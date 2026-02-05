/**
 * Builder's Workshop Page
 * Skills + tools registry (create, inspect, delete).
 */

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge, Button, Card, Input, Modal, Skeleton, Tabs, TabPanel } from '../components/base';
import { createSkill, deleteSkill, getSkill, getSkills } from '../api/client';
import type { Skill } from '../api/types';
import { DataTable, JsonPanel } from '../components/ops';

export const BuildersWorkshop: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('catalog');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSource, setNewSource] = useState('');

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: getSkills,
    refetchInterval: 10_000,
  });

  const skillDetailQuery = useQuery({
    queryKey: ['skill', selectedSkill ?? ''],
    queryFn: () => getSkill(selectedSkill!),
    enabled: Boolean(selectedSkill),
  });

  const createMutation = useMutation({
    mutationFn: () => createSkill(newName.trim(), newDescription.trim(), newSource.trim()),
    onSuccess: async () => {
      setNewName('');
      setNewDescription('');
      setNewSource('');
      setActiveTab('catalog');
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteSkill(name),
    onSuccess: async () => {
      setSelectedSkill(null);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const skills = (skillsQuery.data?.skills ?? []) as Skill[];
  const categories = (skillsQuery.data as any)?.categories as string[] | undefined;
  const categoryOptions = ['all', ...(categories ?? Array.from(new Set(skills.map((s) => s.category))).sort())];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills
      .filter((s) => (category === 'all' ? true : s.category === category))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [category, search, skills]);

  const nameTaken = useMemo(() => {
    const n = newName.trim().toLowerCase();
    if (!n) return false;
    return skills.some((s) => s.name.toLowerCase() === n);
  }, [newName, skills]);

  const columns = useMemo<Array<ColumnDef<Skill>>>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="text-white font-medium truncate">{ctx.row.original.name}</div>
            <div className="text-xs text-gray-500 truncate">{ctx.row.original.description}</div>
          </div>
        ),
      },
      {
        header: 'Category',
        accessorKey: 'category',
        cell: (ctx) => <Badge variant="architect" size="sm">{ctx.row.original.category}</Badge>,
      },
      {
        header: 'Author',
        accessorKey: 'author',
        cell: (ctx) => <span className="text-xs text-gray-400">{ctx.row.original.author}</span>,
      },
    ],
    []
  );

  if (skillsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={80} />
        <Skeleton variant="rectangular" height={320} />
      </div>
    );
  }

  const selected = (skillDetailQuery.data as any)?.skill as Skill | undefined;
  const selectedSource = (skillDetailQuery.data as any)?.source as string | undefined;
  const canDelete = selected?.category === 'custom' && selected?.author !== 'system';

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🔧</span>
            Builder&apos;s Workshop
          </h1>
          <p className="text-sm text-gray-400">Skills & Tools Registry</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="architect">{skills.length} entries</Badge>
          <Button variant="primary" size="sm" onClick={() => setActiveTab('create')}>
            + Create Skill
          </Button>
        </div>
      </header>

      <div className="px-4 pt-4">
        <Tabs
          tabs={[
            { id: 'catalog', label: 'Catalog', icon: <span>📦</span> },
            { id: 'create', label: 'Create', icon: <span>➕</span> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <TabPanel tabId="catalog" activeTab={activeTab}>
          <Card>
            <div className="grid grid-cols-6 gap-2">
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="col-span-4"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="col-span-2 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <div className="mt-4">
            <DataTable
              data={filtered}
              columns={columns}
              onRowClick={(row) => setSelectedSkill(row.name)}
              empty="No skills match filters."
            />
          </div>
        </TabPanel>

        <TabPanel tabId="create" activeTab={activeTab}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Create Skill</h3>
              <Badge variant="default" size="sm">POST /api/skills</Badge>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <Input
                placeholder="Skill name (unique)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="col-span-2"
              />
              <Input
                placeholder="Description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="col-span-4"
              />
              <div className="col-span-6">
                <textarea
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  placeholder="Usage/source (optional)"
                  className="w-full h-40 bg-chamber-dark text-white font-mono text-sm p-3 rounded-lg border border-chamber-wall focus:outline-none focus:ring-2 focus:ring-queen-amber/50"
                  spellCheck={false}
                />
              </div>
              <div className="col-span-6 flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {nameTaken ? <span className="text-soldier-alert">Name already exists</span> : null}
                </div>
                <Button
                  variant="primary"
                  onClick={() => createMutation.mutate()}
                  disabled={!newName.trim() || !newDescription.trim() || nameTaken}
                  loading={createMutation.isPending}
                >
                  Create
                </Button>
              </div>
            </div>
          </Card>
        </TabPanel>
      </div>

      <Modal
        isOpen={Boolean(selectedSkill)}
        onClose={() => setSelectedSkill(null)}
        title={selectedSkill ? `Skill · ${selectedSkill}` : 'Skill'}
        size="full"
      >
        {skillDetailQuery.isLoading ? (
          <Skeleton variant="rectangular" height={260} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="architect">{selected?.category ?? 'unknown'}</Badge>
                <Badge variant="default">{selected?.author ?? 'unknown'}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {selectedSource && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(selectedSource)}
                  >
                    Copy Usage
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selected && deleteMutation.mutate(selected.name)}
                    loading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>

            <JsonPanel title="Skill JSON" endpoint={`/api/skills/${encodeURIComponent(selectedSkill ?? '')}`} value={skillDetailQuery.data ?? { loading: true }} />
            {selectedSource ? (
              <Card>
                <h3 className="text-lg font-semibold text-white mb-3">Usage / Source</h3>
                <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words bg-chamber-dark rounded-lg p-3 border border-chamber-wall">
                  {selectedSource}
                </pre>
              </Card>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
};

