/**
 * Event Handler
 * Maps backend events to colony simulation and system state
 */

import { useSystemStore } from '../stores/systemStore';
import { useColonyStore } from '../stores/colonyStore';
import type { SystemEvent, Agent, Task } from '../stores/systemStore';
import { getWebSocketClient, openEventStream } from './client';
import type { Vector2D } from '../utils/vector';
import type { ChamberType } from '../utils/biology';

// ============================================
// Event Mapping Types
// ============================================

export interface EventMapping {
  systemEvent: SystemEvent;
  colonyAction?: () => void;
}

// ============================================
// Colony Position Helpers
// ============================================

function getRandomPositionInChamber(chamberType: string): Vector2D {
  const colonyStore = useColonyStore.getState();
  const chambers = colonyStore.chambers;

  // Find chamber by type
  for (const [, chamber] of chambers) {
    if (chamber.type === chamberType) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * chamber.radius * 0.7;
      return {
        x: chamber.position.x + Math.cos(angle) * distance,
        y: chamber.position.y + Math.sin(angle) * distance,
      };
    }
  }

  // Default to center
  return { x: colonyStore.width / 2, y: colonyStore.height / 2 };
}

function getForagingPosition(): Vector2D {
  return getRandomPositionInChamber('foraging');
}

function getRoyalPosition(): Vector2D {
  return getRandomPositionInChamber('royal');
}

function getWarRoomPosition(): Vector2D {
  return getRandomPositionInChamber('war');
}

// ============================================
// Event Handlers
// ============================================

function handleTaskStarted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const taskData = event.data as { id: string; prompt: string; description?: string };
  const taskId = taskData.id || `task-${Date.now()}`;

  // Add task to system store
  const task: Task = {
    id: taskId,
    prompt: taskData.description || taskData.prompt || 'Unknown task',
    status: 'running',
    startedAt: event.timestamp,
    toolCalls: [],
    subagents: [],
    channel: 'web',
    sessionKey: (event.data?.sessionKey as string) || '',
    iterations: 0,
  };
  systemStore.addTask(task);

  // Spawn a forager ant in the foraging gallery (user tasks are foraging)
  colonyStore.spawnEntityAnt(taskId, 'task', 'forager', 'foraging');

  // Create a pheromone trail from royal chamber to foraging gallery
  const trailId = `trail-${taskId}`;
  const trail = colonyStore.createTrail(trailId, taskId);
  trail.addPoint(getRoyalPosition());
  trail.addPoint(getForagingPosition());

  // Set queen to thinking
  systemStore.queenThinking = true;
  colonyStore.setQueenThinking(true);
}

function handleTaskCompleted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const taskData = event.data as { id: string; result?: string; taskId?: string };
  const entityId = taskData.id || taskData.taskId;
  
  if (!entityId) return;

  // Update task in system store
  systemStore.updateTask(entityId, {
    status: 'completed',
    completedAt: event.timestamp,
    result: taskData.result,
  });

  // Remove the forager ant (task completed) using entity tracking
  colonyStore.removeAntByEntityId(entityId);

  // Remove the trail
  colonyStore.removeTrail(`trail-${entityId}`);

  // Check if any tasks are still running
  const hasRunningTasks = Array.from(systemStore.tasks.values()).some(
    t => t.status === 'running'
  );
  if (!hasRunningTasks) {
    systemStore.queenThinking = false;
    colonyStore.setQueenThinking(false);
  }
}

function handleAgentSpawned(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const agentData = event.data as {
    id: string;
    caste?: string;
    name?: string;
    taskId?: string;
    label?: string;
  };

  // Determine caste based on label or provided caste
  let caste: Agent['caste'] = (agentData.caste as Agent['caste']) || 'worker';
  const label = agentData.label || agentData.name || '';
  
  // Infer caste from label if not provided
  if (label.includes('forager')) caste = 'forager';
  else if (label.includes('nurse')) caste = 'nurse';
  else if (label.includes('builder') || label.includes('architect')) caste = 'architect';
  else if (label.includes('soldier')) caste = 'soldier';
  else if (label.includes('scout')) caste = 'forager';
  
  // Add agent to system store
  const agent: Agent = {
    id: agentData.id,
    caste,
    name: agentData.name || label || `Worker-${agentData.id.slice(-4)}`,
    status: 'active',
    currentTask: agentData.taskId,
    progress: 0,
    toolsUsed: [],
    taskCount: 0,
    averageDuration: 0,
    errorCount: 0,
    createdAt: event.timestamp,
    metadata: {
      age: 0,
      energy: 100,
      specialization: [],
    },
  };
  systemStore.addAgent(agent);

  // Map caste to chamber
  const chamberMap: Record<string, ChamberType> = {
    'soldier': 'war',
    'nurse': 'nursery',
    'forager': 'foraging',
    'architect': 'builders',
    'worker': 'nursery',
    'drone': 'seasonal',
    'queen': 'royal',
  };
  
  const chamberType = chamberMap[caste] || 'nursery';
  
  // Spawn corresponding ant in colony with entity tracking
  colonyStore.spawnEntityAnt(agentData.id, 'subagent', caste, chamberType);
}

function handleAgentRetired(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const agentData = event.data as { id: string };

  // Update agent in system store
  systemStore.updateAgent(agentData.id, {
    status: 'retired',
    retiredAt: event.timestamp,
  });

  // Remove corresponding colony ant using entity tracking
  colonyStore.removeAntByEntityId(agentData.id);
}

function handleErrorOccurred(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const errorData = event.data as {
    message?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    taskId?: string;
    error?: string;
  };

  // Add event to store
  systemStore.addEvent(event);
  systemStore.totalErrors++;

  // Determine severity
  const severity = errorData.severity ||
    (event.severity === 'critical' ? 'critical' :
     event.severity === 'error' ? 'high' : 'medium');

  // Create error ID for tracking
  const errorId = `error-${Date.now()}`;

  // Position alarm at the task location or war room
  let alarmPosition = getWarRoomPosition();
  if (errorData.taskId) {
    const ant = colonyStore.findAntByEntityId(errorData.taskId);
    if (ant) {
      alarmPosition = { ...ant.position };
    }
  }

  // Create alarm in war room
  colonyStore.createAlarm(alarmPosition, severity);

  // Spawn soldier in war room for errors (they defend against threats)
  if (severity === 'critical' || severity === 'high') {
    colonyStore.spawnEntityAnt(errorId, 'error', 'soldier', 'war');
  }
}

function handleToolExecuted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  // Add event
  systemStore.addEvent(event);

  // Spawn an architect ant in the builder's workshop for tool execution
  const toolId = `tool-${Date.now()}`;
  colonyStore.spawnEntityAnt(toolId, 'memory', 'architect', 'builders');
  
  // Deposit pheromone at builder's workshop
  colonyStore.depositPheromone(getRandomPositionInChamber('builders'), 'trail', 0.3);
  
  // Remove the architect after a short delay (tool execution is brief)
  setTimeout(() => {
    colonyStore.removeAntByEntityId(toolId);
  }, 3000);
}

function handleCronTriggered(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const cronData = event.data as {
    jobId: string;
    name?: string;
  };

  // Spawn a drone ant in seasonal cycles chamber for cron jobs
  colonyStore.spawnEntityAnt(cronData.jobId, 'cron', 'drone', 'seasonal');

  // Add event
  systemStore.addEvent(event);
}

function handleMemoryIndexed(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  // Deposit pheromone in archive area (memory activity)
  colonyStore.depositPheromone(getRandomPositionInChamber('archive'), 'trail', 0.2);

  // Spawn nurse in archive chamber for memory operations
  const memoryId = `memory-${Date.now()}`;
  colonyStore.spawnEntityAnt(memoryId, 'memory', 'nurse', 'archive');
  
  // Remove nurse after delay (memory ops are brief)
  setTimeout(() => {
    colonyStore.removeAntByEntityId(memoryId);
  }, 5000);

  // Add event
  systemStore.addEvent(event);
}

function handleMessageReceived(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  // Set queen to thinking (processing message)
  systemStore.queenThinking = true;

  // Deposit pheromone trail from entrance to queen
  colonyStore.depositPheromone(getRoyalPosition(), 'trail', 0.5);

  // Add event
  systemStore.addEvent(event);
}

function handleJobCreated(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const data = event.data as { jobId: string; name: string; schedule: string };
  
  // Add job to store
  systemStore.addJob({
    id: data.jobId,
    name: data.name,
    schedule: data.schedule,
    naturalLanguage: data.schedule,
    enabled: true,
    nextRunAt: Date.now() + 3600000, // Placeholder
    trigger: { type: 'agent_ask', data: {} },
    actions: [],
    executionHistory: [],
  });
}

function handleJobStarted(event: SystemEvent): void {
  const colonyStore = useColonyStore.getState();
  const data = event.data as { jobId: string; name: string };
  
  // Spawn a drone ant in seasonal chamber for scheduled jobs
  colonyStore.spawnEntityAnt(data.jobId, 'cron', 'drone', 'seasonal');
}

function handleJobCompleted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();
  const data = event.data as { jobId: string; duration: number };
  
  // Update job in store
  systemStore.updateJob(data.jobId, {
    lastRunAt: Date.now(),
  });
  
  // Remove the drone ant representing this job
  colonyStore.removeAntByEntityId(data.jobId);
}

function handleJobFailed(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();
  const data = event.data as { jobId: string; error: string };
  
  // Update job with error
  systemStore.updateJob(data.jobId, {
    lastRunAt: Date.now(),
  });
  
  // Remove the drone ant representing this job
  colonyStore.removeAntByEntityId(data.jobId);
  
  // Create an alarm in war room for failed jobs
  colonyStore.createAlarm(getWarRoomPosition(), 'medium');
}

function handleSkillCreated(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const data = event.data as { name: string; description: string; author: string };
  
  // Add skill to store
  systemStore.addSkill({
    name: data.name,
    description: data.description,
    category: 'custom',
    version: '1.0.0',
    author: data.author,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    usageCount: 0,
    parameters: {},
  });
}

// ============================================
// Main Event Processor
// ============================================

export function processEvent(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();

  // Always add event to the log
  systemStore.addEvent(event);

  // Route to specific handler
  switch (event.type) {
    case 'task_started':
      handleTaskStarted(event);
      break;
    case 'task_completed':
      handleTaskCompleted(event);
      break;
    case 'agent_spawned':
      handleAgentSpawned(event);
      break;
    case 'agent_retired':
      handleAgentRetired(event);
      break;
    case 'error_occurred':
      handleErrorOccurred(event);
      break;
    case 'tool_executed':
      handleToolExecuted(event);
      break;
    case 'cron_triggered':
      handleCronTriggered(event);
      break;
    case 'memory_indexed':
      handleMemoryIndexed(event);
      break;
    case 'message_received':
      handleMessageReceived(event);
      break;
    case 'job_created':
      handleJobCreated(event);
      break;
    case 'job_started':
      handleJobStarted(event);
      break;
    case 'job_completed':
      handleJobCompleted(event);
      break;
    case 'job_failed':
      handleJobFailed(event);
      break;
    case 'skill_created':
      handleSkillCreated(event);
      break;
  }
}

// ============================================
// Connection Manager
// ============================================

let eventSource: EventSource | null = null;

export function connectToEvents(): () => void {
  const systemStore = useSystemStore.getState();

  try {
    // Try WebSocket first
    const wsClient = getWebSocketClient({
      onEvent: (event) => {
        try {
          processEvent(event);
        } catch (err) {
          console.error('Error processing event:', err);
        }
      },
      onConnect: () => {
        systemStore.setConnected(true);
        console.log('WebSocket connected to colony');
      },
      onDisconnect: () => {
        systemStore.setConnected(false);
        console.log('WebSocket disconnected from colony');
        // Fallback to EventSource
        startEventSource();
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
        // Try EventSource fallback
        startEventSource();
      },
    });

    wsClient.connect();

    // Return cleanup function
    return () => {
      try {
        wsClient.disconnect();
      } catch (err) {
        console.error('Error disconnecting WebSocket:', err);
      }
      if (eventSource) {
        try {
          eventSource.close();
        } catch (err) {
          console.error('Error closing EventSource:', err);
        }
        eventSource = null;
      }
    };
  } catch (err) {
    console.error('Failed to initialize event connection:', err);
    // Return no-op cleanup
    return () => {};
  }
}

function startEventSource(): void {
  if (eventSource) return;

  try {
    const systemStore = useSystemStore.getState();

    eventSource = openEventStream((event) => {
      try {
        processEvent(event);
      } catch (err) {
        console.error('Error processing EventSource event:', err);
      }
    });

    eventSource.onopen = () => {
      systemStore.setConnected(true);
      console.log('EventSource connected to colony');
    };

    eventSource.onerror = () => {
      systemStore.setConnected(false);
      console.log('EventSource error, connection lost');
    };
  } catch (err) {
    console.error('Failed to start EventSource:', err);
  }
}

// ============================================
// React Hook for Event Connection
// ============================================

import { useEffect } from 'react';

export function useEventConnection(): boolean {
  const isConnected = useSystemStore((state) => state.isConnected);

  useEffect(() => {
    const cleanup = connectToEvents();
    return cleanup;
  }, []);

  return isConnected;
}
