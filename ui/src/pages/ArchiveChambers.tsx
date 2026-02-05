/**
 * Archive Chambers Page
 * Memory explorer + search + stats.
 */

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge, Button, Card, Input, Skeleton, Tabs, TabPanel } from '../components/base';
import { MemoryTreemap } from '../components/complex';
import { addMemory, getMemoryIndexPage, getMemoryStats, searchMemory } from '../api/client';
import type { Memory } from '../api/types';
import { DataTable, JsonPanel } from '../components/ops';

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'note':
      return '📝';
    case 'session':
      return '💬';
    case 'indexed':
      return '📑';
    case 'learned':
      return '🧠';
    case 'system':
      return '⚙️';
    default:
      return '📄';
  }
};

export const ArchiveChambers: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('browse');

  const [indexCategory, setIndexCategory] = useState('');
  const [indexSource, setIndexSource] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [newCategory, setNewCategory] = useState('');
  const [newContent, setNewContent] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Memory[]>([]);

  const statsQuery = useQuery({
    queryKey: ['memoryStats'],
    queryFn: getMemoryStats,
    refetchInterval: 10_000,
  });

  const indexQuery = useQuery({
    queryKey: ['memoryIndex', { limit, offset, category: indexCategory, source: indexSource }],
    queryFn: () =>
      getMemoryIndexPage({
        limit,
        offset,
        category: indexCategory.trim() ? indexCategory.trim() : undefined,
        source: indexSource.trim() ? indexSource.trim() : undefined,
      }),
  });

  const addMutation = useMutation({
    mutationFn: async () => addMemory(newContent, newCategory.trim() ? newCategory.trim() : undefined),
    onSuccess: async () => {
      setNewContent('');
      await queryClient.invalidateQueries({ queryKey: ['memoryStats'] });
      await queryClient.invalidateQueries({ queryKey: ['memoryIndex'] });
    },
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await searchMemory(searchQuery.trim());
      setSearchResults(data.results ?? []);
      setActiveTab('search');
    } finally {
      setSearching(false);
    }
  };

  const stats = statsQuery.data?.stats as any;
  const memories = (indexQuery.data?.memories ?? []) as Memory[];
  const total = (indexQuery.data as any)?.total ?? memories.length;

  const columns = useMemo<Array<ColumnDef<Memory>>>(
    () => [
      {
        header: 'Type',
        accessorKey: 'type',
        cell: (ctx) => <span className="text-lg">{getTypeIcon(String(ctx.row.original.type))}</span>,
      },
      {
        header: 'Category',
        accessorKey: 'category',
        cell: (ctx) => <Badge variant="default" size="sm">{ctx.row.original.category}</Badge>,
      },
      {
        header: 'Content',
        accessorKey: 'content',
        cell: (ctx) => (
          <div className="min-w-0">
            <div className="text-white line-clamp-2">{ctx.row.original.content}</div>
            <div className="mt-1 text-[11px] text-gray-500 font-mono truncate">
              {ctx.row.original.references?.[0] ?? ctx.row.original.id}
            </div>
          </div>
        ),
      },
      {
        header: 'Hits',
        accessorKey: 'accessCount',
        cell: (ctx) => <span className="text-xs text-gray-400">{ctx.row.original.accessCount ?? 0}</span>,
      },
    ],
    []
  );

  if (statsQuery.isLoading || indexQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={100} />
        <Skeleton variant="rectangular" height={400} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🍄</span>
            Archive Chambers
          </h1>
          <p className="text-sm text-gray-400">Memory Explorer (backend-truthful)</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="nurse">{stats?.fileCount ?? 0} files</Badge>
          <Badge variant="architect">{stats?.chunkCount ?? 0} chunks</Badge>
          <Badge variant={stats?.enabled ? 'nurse' : 'default'}>{stats?.enabled ? 'Enabled' : 'Disabled'}</Badge>
        </div>
      </header>

      <div className="p-4 border-b border-chamber-wall">
        <div className="grid grid-cols-6 gap-2">
          <Input
            placeholder="Search memories…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="col-span-3"
          />
          <Button variant="primary" onClick={handleSearch} loading={searching}>
            Search
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab('browse')}>
            Browse
          </Button>
          <Button variant="outline" onClick={() => setActiveTab('stats')}>
            Stats
          </Button>
        </div>
      </div>

      <div className="px-4 pt-4">
        <Tabs
          tabs={[
            { id: 'browse', label: 'Browse', icon: <span>📂</span> },
            { id: 'search', label: 'Search Results', icon: <span>🔍</span> },
            { id: 'stats', label: 'Analytics', icon: <span>📊</span> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <TabPanel tabId="browse" activeTab={activeTab}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Add Memory</h3>
              <Badge variant="default" size="sm">POST /api/memory</Badge>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <Input
                placeholder="Category (optional)"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="col-span-2"
              />
              <Input
                placeholder="Memory content…"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="col-span-4"
              />
              <div className="col-span-6 flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => addMutation.mutate()}
                  disabled={!newContent.trim()}
                  loading={addMutation.isPending}
                >
                  Add
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Memory Index</h3>
              <div className="flex items-center gap-2">
                <Badge variant="default" size="sm">
                  total {total}
                </Badge>
                <Badge variant="default" size="sm">
                  GET /api/memory/index
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-2 mb-3">
              <Input
                placeholder="category filter"
                value={indexCategory}
                onChange={(e) => {
                  setIndexCategory(e.target.value);
                  setOffset(0);
                }}
                className="col-span-2"
              />
              <Input
                placeholder="source filter"
                value={indexSource}
                onChange={(e) => {
                  setIndexSource(e.target.value);
                  setOffset(0);
                }}
                className="col-span-2"
              />
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(parseInt(e.target.value, 10));
                  setOffset(0);
                }}
                className="col-span-1 bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <div className="col-span-1 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>
                  Prev
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}>
                  Next
                </Button>
              </div>
            </div>

            <DataTable data={memories} columns={columns} dense empty="No memory chunks found." />
          </Card>
        </TabPanel>

        <TabPanel tabId="search" activeTab={activeTab}>
          {searchResults.length === 0 ? (
            <Card>
              <div className="text-sm text-gray-500">No results.</div>
            </Card>
          ) : (
            <DataTable
              data={searchResults}
              columns={columns}
              dense
            />
          )}
        </TabPanel>

        <TabPanel tabId="stats" activeTab={activeTab}>
          <div className="grid grid-cols-2 gap-4">
            <Card className="col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4">Category Map</h3>
              <div className="flex justify-center">
                <MemoryTreemap
                  data={stats?.categories ?? {}}
                  width={700}
                  height={280}
                  onCategoryClick={(category) => {
                    setIndexCategory(category);
                    setOffset(0);
                    setActiveTab('browse');
                  }}
                />
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-white mb-4">Stats</h3>
              <div className="space-y-2 text-sm text-gray-300">
                <div className="flex justify-between"><span className="text-gray-500">Enabled</span><span>{String(stats?.enabled ?? false)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Files</span><span>{stats?.fileCount ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Chunks</span><span>{stats?.chunkCount ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Last Run</span><span>{stats?.lastRunAt ? new Date(stats.lastRunAt).toLocaleString() : 'never'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Size</span><span>{typeof stats?.totalSize === 'number' ? `${Math.round(stats.totalSize / 1024)} KB` : '-'}</span></div>
              </div>
            </Card>

            <JsonPanel title="Raw Stats JSON" endpoint="/api/memory/stats" value={statsQuery.data ?? { loading: true }} />
          </div>
        </TabPanel>
      </div>
    </div>
  );
};

