/**
 * Pheromone Trails Page
 * Session history and replay
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Badge, Button, Skeleton } from '../components/base';
import { getSessions, getSession } from '../api/client';
import type { Session, SessionMessage } from '../api/types';

export const PheromonTrails: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getSessions();
      setSessions(data.sessions ?? []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSelectSession = async (key: string) => {
    setSelectedSession(key);
    setLoadingMessages(true);
    try {
      const data = await getSession(key);
      setMessages(data.messages ?? []);
    } catch (err) {
      console.error('Failed to fetch session:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'whatsapp': return '📱';
      case 'cli': return '💻';
      case 'web': return '🌐';
      default: return '💬';
    }
  };

  const formatDate = (timestamp: number) => {
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
        <Skeleton variant="rectangular" height={400} />
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Session list sidebar */}
      <aside className="w-80 border-r border-chamber-wall flex flex-col">
        <header className="p-4 border-b border-chamber-wall">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <span>✨</span>
            Pheromone Trails
          </h1>
          <p className="text-sm text-gray-400">Session History</p>
        </header>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <span className="text-4xl">🔍</span>
              <p className="mt-2">No trails found</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {sessions.map((session, i) => (
                <motion.button
                  key={session.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => handleSelectSession(session.key)}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${
                    selectedSession === session.key
                      ? 'bg-queen-amber/20 border border-queen-amber/30'
                      : 'hover:bg-chamber-wall'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{getChannelIcon(session.channel)}</span>
                    <span className="font-medium text-white truncate flex-1">
                      {session.key.slice(0, 20)}...
                    </span>
                    <Badge variant="default" size="sm">
                      {session.messageCount}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {formatDate(session.lastMessageAt)}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Message view */}
      <main className="flex-1 flex flex-col">
        {!selectedSession ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <span className="text-6xl">🐜</span>
              <h3 className="text-xl font-semibold text-white mt-4">
                Select a Trail
              </h3>
              <p className="text-gray-400 mt-2">
                Choose a pheromone trail to replay the journey
              </p>
            </div>
          </div>
        ) : loadingMessages ? (
          <div className="flex-1 p-4">
            <Skeleton variant="rectangular" height={100} />
            <Skeleton variant="rectangular" height={100} className="mt-3" />
          </div>
        ) : (
          <>
            <header className="p-4 border-b border-chamber-wall flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">{selectedSession}</h2>
                <p className="text-sm text-gray-400">{messages.length} messages</p>
              </div>
              <Button variant="ghost" size="sm">
                Export
              </Button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-queen-amber/20 text-white'
                        : msg.role === 'assistant'
                        ? 'bg-chamber-tunnel text-white'
                        : msg.role === 'tool'
                        ? 'bg-architect-sky/20 text-architect-light'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="default" size="sm">
                        {msg.role}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {formatDate(msg.ts)}
                      </span>
                      {msg.model && (
                        <Badge variant="default" size="sm" className="ml-auto bg-blue-600/50">
                          {msg.providerId ? `${msg.providerId}: ` : ''}{msg.model}
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
