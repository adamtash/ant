/**
 * Event Handler
 * Maps backend events to colony simulation and system state
 */

import { useSystemStore } from '../stores/systemStore';
import { useColonyStore } from '../stores/colonyStore';
import type { SystemEvent, Agent, Task } from '../stores/systemStore';
import { getWebSocketClient, openEventStream } from './client';
import type { Vector2D } from '../utils/vector';

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

  const taskData = event.data as { id: string; prompt: string };

  // Add task to system store
  const task: Task = {
    id: taskData.id,
    prompt: taskData.prompt || 'Unknown task',
    status: 'running',
    startedAt: event.timestamp,
    toolCalls: [],
    subagents: [],
    channel: 'web',
    sessionKey: '',
    iterations: 0,
  };
  systemStore.addTask(task);

  // Spawn a forager ant in the colony
  colonyStore.spawnAnt('forager', getForagingPosition(), taskData.id);

  // Create a pheromone trail from royal chamber
  const trailId = `trail-${taskData.id}`;
  const trail = colonyStore.createTrail(trailId, taskData.id);

  // Add points to trail
  trail.addPoint(getRoyalPosition());
  trail.addPoint(getForagingPosition());

  // Set queen to thinking
  systemStore.queenThinking = true;
}

function handleTaskCompleted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const taskData = event.data as { id: string; result?: string };

  // Update task in system store
  systemStore.updateTask(taskData.id, {
    status: 'completed',
    completedAt: event.timestamp,
    result: taskData.result,
  });

  // Remove the forager ant (task completed)
  const ants = colonyStore.getAllAnts();
  const taskAnt = ants.find(a => a.taskId === taskData.id);
  if (taskAnt) {
    colonyStore.removeAnt(taskAnt.id);
  }

  // Remove the trail
  colonyStore.removeTrail(`trail-${taskData.id}`);

  // Set queen back to idle
  systemStore.queenThinking = false;
}

function handleAgentSpawned(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const agentData = event.data as {
    id: string;
    caste?: string;
    name?: string;
    taskId?: string;
  };

  // Add agent to system store
  const agent: Agent = {
    id: agentData.id,
    caste: (agentData.caste as Agent['caste']) || 'worker',
    name: agentData.name || `Worker-${agentData.id.slice(-4)}`,
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

  // Spawn corresponding ant in colony
  const caste = agentData.caste || 'worker';
  const position = caste === 'soldier'
    ? getWarRoomPosition()
    : getForagingPosition();

  colonyStore.spawnAnt(caste as any, position, agentData.taskId);
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

  // Find and remove corresponding colony ant
  const ants = colonyStore.getAllAnts();
  const agentAnt = ants.find(a => a.id.includes(agentData.id));
  if (agentAnt) {
    colonyStore.removeAnt(agentAnt.id);
  }
}

function handleErrorOccurred(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const errorData = event.data as {
    message?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    taskId?: string;
  };

  // Add event to store
  systemStore.addEvent(event);

  // Create alarm in colony
  const severity = errorData.severity ||
    (event.severity === 'critical' ? 'critical' :
     event.severity === 'error' ? 'high' : 'medium');

  // Position alarm at the task location or war room
  let alarmPosition = getWarRoomPosition();
  if (errorData.taskId) {
    const ants = colonyStore.getAllAnts();
    const taskAnt = ants.find(a => a.taskId === errorData.taskId);
    if (taskAnt) {
      alarmPosition = { ...taskAnt.position };
    }
  }

  colonyStore.createAlarm(alarmPosition, severity);

  // Spawn soldier if critical
  if (severity === 'critical' || severity === 'high') {
    colonyStore.spawnAnt('soldier', getWarRoomPosition());
  }
}

function handleToolExecuted(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  // Deposit pheromone at foraging location (tool activity)
  colonyStore.depositPheromone(getForagingPosition(), 'trail', 0.3);

  // Add event
  systemStore.addEvent(event);
}

function handleCronTriggered(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  const cronData = event.data as {
    jobId: string;
    name?: string;
  };

  // Spawn a drone ant for the cron job
  const position = getRandomPositionInChamber('seasonal');
  colonyStore.spawnAnt('drone', position, cronData.jobId);

  // Add event
  systemStore.addEvent(event);
}

function handleMemoryIndexed(event: SystemEvent): void {
  const systemStore = useSystemStore.getState();
  const colonyStore = useColonyStore.getState();

  // Deposit pheromone in archive area (memory activity)
  const archivePosition = getRandomPositionInChamber('archive');
  colonyStore.depositPheromone(archivePosition, 'trail', 0.2);

  // Spawn nurse if significant memory activity
  const memoryData = event.data as { count?: number };
  if (memoryData.count && memoryData.count > 10) {
    colonyStore.spawnAnt('nurse', getRandomPositionInChamber('nursery'));
  }

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
