/**
 * Archive Chambers Page
 * Memory system visualization and management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, Badge, Button, Input, Skeleton, Tabs, TabPanel } from '../components/base';
import { MemoryTreemap } from '../components/complex';
import { getMemoryStats, searchMemory, getMemoryIndex } from '../api/client';
import type { Memory, MemoryStatsResponse } from '../api/types';

export const ArchiveChambers: React.FC = () => {
  const [stats, setStats] = useState<MemoryStatsResponse['stats'] | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('browse');

  const fetchData = useCallback(async () => {
    try {
      const [statsData, indexData] = await Promise.all([
        getMemoryStats(),
        getMemoryIndex(),
      ]);
      setStats(statsData.stats);
      setMemories(indexData.memories ?? []);
    } catch (err) {
      console.error('Failed to fetch memory data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await searchMemory(searchQuery);
      setSearchResults(data.results ?? []);
      setActiveTab('search');
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'note': return '📝';
      case 'session': return '💬';
      case 'indexed': return '📑';
      case 'learned': return '🧠';
      case 'system': return '⚙️';
      default: return '📄';
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
            <span className="text-3xl">🍄</span>
            Archive Chambers
          </h1>
          <p className="text-sm text-gray-400">Colony Knowledge Base (Fungus Garden)</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="nurse">
            {stats?.fileCount ?? 0} memories
          </Badge>
          <Badge variant={stats?.enabled ? 'nurse' : 'default'}>
            {stats?.enabled ? 'Active' : 'Disabled'}
          </Badge>
        </div>
      </header>

      {/* Search bar */}
      <div className="p-4 border-b border-chamber-wall">
        <div className="flex gap-3">
          <Input
            placeholder="Search colony memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            icon={<span>🔍</span>}
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={handleSearch}
            loading={searching}
          >
            Search
          </Button>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <TabPanel tabId="browse" activeTab={activeTab}>
          {memories.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-6xl">🌱</span>
              <h3 className="text-xl font-semibold text-white mt-4">
                Fungus Garden is Empty
              </h3>
              <p className="text-gray-400 mt-2">
                Memories will grow here as the colony learns
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {memories.map((memory, i) => (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <Card hoverable>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{getTypeIcon(memory.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="default" size="sm">
                            {memory.category}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {formatDate(memory.createdAt)}
                          </span>
                        </div>
                        <p className="text-white line-clamp-3">
                          {memory.content}
                        </p>
                        {memory.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {memory.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 text-xs bg-chamber-wall rounded text-gray-400"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {memory.accessCount}x
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabPanel>

        <TabPanel tabId="search" activeTab={activeTab}>
          {searchResults.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-6xl">🔎</span>
              <h3 className="text-xl font-semibold text-white mt-4">
                No Results
              </h3>
              <p className="text-gray-400 mt-2">
                Try a different search query
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {searchResults.map((memory, i) => (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <Card hoverable className="border-l-4 border-l-fungus-cyan">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{getTypeIcon(memory.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="nurse" size="sm">
                            Score: {((memory.searchScore ?? 0) * 100).toFixed(0)}%
                          </Badge>
                          <Badge variant="default" size="sm">
                            {memory.category}
                          </Badge>
                        </div>
                        <p className="text-white line-clamp-3">
                          {memory.content}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabPanel>

        <TabPanel tabId="stats" activeTab={activeTab}>
          <div className="grid grid-cols-2 gap-4">
            {/* Memory Treemap */}
            <Card className="col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4">Memory Map</h3>
              <div className="flex justify-center">
                <MemoryTreemap
                  data={stats?.categories ?? {}}
                  width={600}
                  height={250}
                  onCategoryClick={(category) => {
                    setSearchQuery(category);
                    handleSearch();
                  }}
                />
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-white mb-4">Storage Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Memories</span>
                  <span className="font-bold text-nurse-green">{stats?.fileCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Indexed</span>
                  <span className="text-white">
                    {stats?.lastRunAt ? formatDate(stats.lastRunAt) : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <Badge variant={stats?.enabled ? 'nurse' : 'default'}>
                    {stats?.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-white mb-4">Categories</h3>
              {stats?.categories ? (
                <div className="space-y-2">
                  {Object.entries(stats.categories).map(([category, count]) => (
                    <div key={category} className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-chamber-dark rounded-full overflow-hidden">
                        <div
                          className="h-full bg-fungus-cyan"
                          style={{ width: `${(count / (stats?.fileCount ?? 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-400 w-20 text-right">
                        {category}
                      </span>
                      <span className="text-sm font-medium text-white w-8">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No category data available</p>
              )}
            </Card>
          </div>
        </TabPanel>
      </div>
    </div>
  );
};
