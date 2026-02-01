/**
 * War Room Page
 * Error monitoring and system health with Recharts visualizations
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { Card, Badge, Button } from '../components/base';
import { useSystemStore } from '../stores/systemStore';
import { useColonyStore } from '../stores/colonyStore';

// Color palette for charts
const CHART_COLORS = {
  critical: '#EF4444',
  error: '#DC2626',
  warn: '#F59E0B',
  info: '#10B981',
  background: '#0B1120',
  grid: '#1E293B',
  text: '#94A3B8',
};

export const WarRoom: React.FC = () => {
  const { events, totalErrors, health } = useSystemStore();
  const { alarms } = useColonyStore();

  // Filter error events
  const errorEvents = events.filter(
    (e) => e.severity === 'error' || e.severity === 'critical'
  );

  // Generate time series data for the last hour (grouped by minute)
  const timeSeriesData = useMemo(() => {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const minuteBuckets: Record<string, { errors: number; warns: number }> = {};

    // Initialize buckets for last 60 minutes
    for (let i = 0; i < 60; i++) {
      const bucketTime = new Date(hourAgo + i * 60 * 1000);
      const key = `${bucketTime.getHours()}:${String(bucketTime.getMinutes()).padStart(2, '0')}`;
      minuteBuckets[key] = { errors: 0, warns: 0 };
    }

    // Count events into buckets
    events.forEach((event) => {
      if (event.timestamp >= hourAgo) {
        const eventDate = new Date(event.timestamp);
        const key = `${eventDate.getHours()}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
        if (minuteBuckets[key]) {
          if (event.severity === 'error' || event.severity === 'critical') {
            minuteBuckets[key].errors++;
          } else if (event.severity === 'warn') {
            minuteBuckets[key].warns++;
          }
        }
      }
    });

    return Object.entries(minuteBuckets).map(([time, data]) => ({
      time,
      errors: data.errors,
      warns: data.warns,
    }));
  }, [events]);

  // Error type distribution
  const errorDistribution = useMemo(() => {
    const distribution: Record<string, number> = {};
    errorEvents.forEach((event) => {
      const type = event.type.replace(/_/g, ' ');
      distribution[type] = (distribution[type] || 0) + 1;
    });

    return Object.entries(distribution)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [errorEvents]);

  // System health data for bar chart
  const healthData = [
    { name: 'CPU', value: health.cpu, color: health.cpu > 80 ? CHART_COLORS.error : CHART_COLORS.info },
    { name: 'Memory', value: health.memory, color: health.memory > 80 ? CHART_COLORS.error : CHART_COLORS.info },
    { name: 'Disk', value: health.disk, color: health.disk > 90 ? CHART_COLORS.error : CHART_COLORS.info },
  ];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'soldier';
      case 'error':
        return 'soldier';
      case 'warn':
        return 'queen';
      default:
        return 'default';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const threatLevel =
    totalErrors > 10
      ? 'critical'
      : totalErrors > 5
      ? 'high'
      : totalErrors > 0
      ? 'elevated'
      : 'normal';

  const PIE_COLORS = ['#EF4444', '#DC2626', '#F59E0B', '#10B981', '#3B82F6'];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-3xl">🛡️</span>
            War Room
          </h1>
          <p className="text-sm text-gray-400">Error Monitoring & Defense</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={threatLevel === 'normal' ? 'nurse' : 'soldier'}
            dot
            pulse={threatLevel !== 'normal'}
          >
            Threat: {threatLevel.charAt(0).toUpperCase() + threatLevel.slice(1)}
          </Badge>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {/* Threat meter */}
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Threat Level
            </h3>
            <div
              className={`text-3xl font-bold ${
                threatLevel === 'critical'
                  ? 'text-soldier-alert'
                  : threatLevel === 'high'
                  ? 'text-soldier-rust'
                  : threatLevel === 'elevated'
                  ? 'text-queen-amber'
                  : 'text-nurse-green'
              }`}
            >
              {threatLevel.toUpperCase()}
            </div>
            <div className="mt-3 h-2 bg-chamber-dark rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${
                  threatLevel === 'critical'
                    ? 'bg-soldier-alert'
                    : threatLevel === 'high'
                    ? 'bg-soldier-rust'
                    : threatLevel === 'elevated'
                    ? 'bg-queen-amber'
                    : 'bg-nurse-green'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, totalErrors * 10)}%` }}
              />
            </div>
          </Card>

          {/* Active soldiers */}
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Active Soldiers
            </h3>
            <div className="text-3xl font-bold text-soldier-rust">
              {alarms.size}
            </div>
            <p className="text-sm text-gray-500 mt-1">Patrolling perimeter</p>
          </Card>

          {/* Total errors */}
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Total Errors
            </h3>
            <div className="text-3xl font-bold text-white">{totalErrors}</div>
            <p className="text-sm text-gray-500 mt-1">Since last reset</p>
          </Card>

          {/* Queue depth */}
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Queue Depth
            </h3>
            <div className="text-3xl font-bold text-architect-sky">
              {health.queueDepth}
            </div>
            <p className="text-sm text-gray-500 mt-1">Messages waiting</p>
          </Card>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Error rate over time */}
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">
              Error Rate (Last Hour)
            </h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeriesData}>
                  <defs>
                    <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.error} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={CHART_COLORS.error} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="warnGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.warn} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={CHART_COLORS.warn} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                  <XAxis
                    dataKey="time"
                    stroke={CHART_COLORS.text}
                    fontSize={10}
                    tickLine={false}
                    interval={9}
                  />
                  <YAxis
                    stroke={CHART_COLORS.text}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CHART_COLORS.background,
                      border: `1px solid ${CHART_COLORS.grid}`,
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: CHART_COLORS.text }}
                  />
                  <Area
                    type="monotone"
                    dataKey="errors"
                    stroke={CHART_COLORS.error}
                    fillOpacity={1}
                    fill="url(#errorGradient)"
                    name="Errors"
                  />
                  <Area
                    type="monotone"
                    dataKey="warns"
                    stroke={CHART_COLORS.warn}
                    fillOpacity={1}
                    fill="url(#warnGradient)"
                    name="Warnings"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Error distribution */}
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">
              Error Distribution
            </h3>
            <div className="h-48 flex items-center">
              {errorDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={errorDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {errorDistribution.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_COLORS.background,
                        border: `1px solid ${CHART_COLORS.grid}`,
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: CHART_COLORS.text }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full text-center text-gray-500">
                  <span className="text-4xl">✅</span>
                  <p className="mt-2">No errors to display</p>
                </div>
              )}
              {errorDistribution.length > 0 && (
                <div className="flex-shrink-0 space-y-2">
                  {errorDistribution.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-gray-400 truncate max-w-[120px]">
                        {item.name}
                      </span>
                      <span className="text-white font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* System health */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="col-span-1">
            <h3 className="text-lg font-semibold text-white mb-4">
              System Health
            </h3>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={healthData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    stroke={CHART_COLORS.text}
                    fontSize={10}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke={CHART_COLORS.text}
                    fontSize={12}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CHART_COLORS.background,
                      border: `1px solid ${CHART_COLORS.grid}`,
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [`${value}%`]}
                  />
                  <Bar dataKey="value" radius={4}>
                    {healthData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Error log */}
          <Card className="col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Error Log</h3>
              <Button variant="ghost" size="sm">
                Clear All
              </Button>
            </div>

            {errorEvents.length === 0 ? (
              <div className="text-center py-8">
                <span className="text-4xl">✅</span>
                <h3 className="text-lg font-semibold text-white mt-2">
                  All Clear
                </h3>
                <p className="text-gray-400 text-sm">
                  No errors detected. Colony is secure.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {errorEvents
                  .slice(-10)
                  .reverse()
                  .map((event, i) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="p-2 bg-chamber-dark rounded-lg border border-soldier-rust/30"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          <span className="text-soldier-alert text-sm">⚠️</span>
                          <div>
                            <div className="text-xs font-medium text-white">
                              {event.type.replace(/_/g, ' ').toUpperCase()}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[300px]">
                              {JSON.stringify(event.data).slice(0, 50)}
                              {JSON.stringify(event.data).length > 50 && '...'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {formatTime(event.timestamp)}
                          </span>
                          <Badge
                            variant={getSeverityColor(event.severity)}
                            size="sm"
                          >
                            {event.severity}
                          </Badge>
                        </div>
                      </div>
                    </motion.div>
                  ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
