/**
 * Genetic Code Page
 * Configuration management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Badge, Button, Skeleton, Tabs, TabPanel } from '../components/base';
import { getConfig, updateConfig } from '../api/client';

export const GeneticCode: React.FC = () => {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('form');
  const [jsonText, setJsonText] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const data = await getConfig();
      setConfig(data.config);
      setConfigPath(data.path);
      setJsonText(JSON.stringify(data.config, null, 2));
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const configToSave = activeTab === 'json' ? JSON.parse(jsonText) : config;
      await updateConfig(configToSave);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const renderConfigSection = (title: string, icon: string, data: Record<string, unknown>) => (
    <Card className="mb-4">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h3>
      <div className="space-y-3">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-gray-400">{key}</span>
            <span className="text-white font-mono text-sm">
              {typeof value === 'boolean' ? (
                <Badge variant={value ? 'nurse' : 'default'}>
                  {value ? 'Enabled' : 'Disabled'}
                </Badge>
              ) : typeof value === 'object' ? (
                <span className="text-gray-500">[Object]</span>
              ) : (
                String(value)
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );

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
            <span className="text-3xl">🧬</span>
            Genetic Code
          </h1>
          <p className="text-sm text-gray-400">{configPath}</p>
        </div>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
        >
          Save Changes
        </Button>
      </header>

      {/* Tabs */}
      <div className="px-4 pt-4">
        <Tabs
          tabs={[
            { id: 'form', label: 'Visual Editor', icon: <span>📝</span> },
            { id: 'json', label: 'Raw JSON', icon: <span>📄</span> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <TabPanel tabId="form" activeTab={activeTab}>
          {config && (
            <div className="grid grid-cols-2 gap-4">
              {/* Runtime settings */}
              {typeof config.runtime === 'object' && config.runtime !== null && renderConfigSection(
                'Runtime',
                '⚙️',
                config.runtime as Record<string, unknown>
              )}

              {/* Provider settings */}
              {typeof config.providers === 'object' && config.providers !== null && renderConfigSection(
                'LLM Providers',
                '🤖',
                config.providers as Record<string, unknown>
              )}

              {/* Channel settings */}
              {typeof config.channels === 'object' && config.channels !== null && renderConfigSection(
                'Channels',
                '📡',
                config.channels as Record<string, unknown>
              )}

              {/* Memory settings */}
              {typeof config.memory === 'object' && config.memory !== null && renderConfigSection(
                'Memory',
                '🧠',
                config.memory as Record<string, unknown>
              )}

              {/* Scheduler settings */}
              {typeof config.scheduler === 'object' && config.scheduler !== null && renderConfigSection(
                'Scheduler',
                '🗓️',
                config.scheduler as Record<string, unknown>
              )}

              {/* Monitoring settings */}
              {typeof config.monitoring === 'object' && config.monitoring !== null && renderConfigSection(
                'Monitoring',
                '📊',
                config.monitoring as Record<string, unknown>
              )}
            </div>
          )}
        </TabPanel>

        <TabPanel tabId="json" activeTab={activeTab}>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Raw Configuration
              </h3>
              <Badge variant="architect">JSON</Badge>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full h-96 bg-chamber-dark text-white font-mono text-sm p-4 rounded-lg border border-chamber-wall focus:outline-none focus:ring-2 focus:ring-queen-amber/50"
              spellCheck={false}
            />
          </Card>
        </TabPanel>
      </div>
    </div>
  );
};
