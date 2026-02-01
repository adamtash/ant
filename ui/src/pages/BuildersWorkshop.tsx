/**
 * Builder's Workshop Page
 * Skills and tools management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, Badge, Button, Skeleton, Tabs, TabPanel } from '../components/base';
import { getSkills } from '../api/client';
import type { Skill } from '../api/types';

export const BuildersWorkshop: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('catalog');
  const [_selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await getSkills();
      setSkills(data.skills ?? []);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'memory': return '🧠';
      case 'file': return '📄';
      case 'system': return '⚙️';
      case 'browser': return '🌐';
      case 'agent': return '🤖';
      default: return '🔧';
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="rectangular" height={80} />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton variant="rectangular" height={150} />
          <Skeleton variant="rectangular" height={150} />
          <Skeleton variant="rectangular" height={150} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🔧</span>
            Builder's Workshop
          </h1>
          <p className="text-sm text-gray-400">Skills & Tools Registry</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="architect">{skills.length} tools</Badge>
          <Button variant="primary" size="sm">
            + Create Skill
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-4 pt-4">
        <Tabs
          tabs={[
            { id: 'catalog', label: 'Catalog', icon: <span>📦</span> },
            { id: 'create', label: 'Create New', icon: <span>➕</span> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <TabPanel tabId="catalog" activeTab={activeTab}>
          {skills.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-6xl">🏗️</span>
              <h3 className="text-xl font-semibold text-white mt-4">
                Workshop is Empty
              </h3>
              <p className="text-gray-400 mt-2">
                Architects will build tools as the colony grows
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {skills.map((skill, i) => (
                <motion.div
                  key={skill.name}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setSelectedSkill(skill)}
                >
                  <Card hoverable className="h-full cursor-pointer">
                    <div className="flex items-start gap-3">
                      <span className="text-3xl">
                        {getCategoryIcon(skill.category)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-white truncate">
                          {skill.name}
                        </h3>
                        <p className="text-sm text-gray-400 line-clamp-2 mt-1">
                          {skill.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-chamber-wall">
                      <Badge variant="architect" size="sm">
                        {skill.category}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        v{skill.version}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                      <span>by {skill.author}</span>
                      <span>{skill.usageCount}x used</span>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabPanel>

        <TabPanel tabId="create" activeTab={activeTab}>
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">
              Create New Skill
            </h3>
            <p className="text-gray-400">
              Skill creation interface coming soon. Architects will be able to
              design and deploy new tools for the colony.
            </p>
            <div className="mt-6 p-4 bg-chamber-dark rounded-lg border border-dashed border-chamber-wall">
              <div className="text-center text-gray-500">
                <span className="text-4xl">🏗️</span>
                <p className="mt-2">Skill builder under construction</p>
              </div>
            </div>
          </Card>
        </TabPanel>
      </div>

      {/* Skill detail modal would go here */}
    </div>
  );
};
