/**
 * Colony Store
 * Manages ant colony simulation state
 */

import { create } from 'zustand';
import type { Vector2D } from '../utils/vector';
import type { AntCaste, ChamberType, PheromoneType } from '../utils/biology';
import { Ant, Queen, Worker, Soldier, Drone } from '../colony/entities';
import type { AntRenderData } from '../colony/entities';
import { PheromoneMap, Trail, Alarm } from '../colony/pheromones';

// Chamber definition
export interface Chamber {
  id: string;
  type: ChamberType;
  position: Vector2D;
  radius: number;
  color: string;
  connections: string[]; // IDs of connected chambers
}

// Tunnel definition
export interface Tunnel {
  id: string;
  from: string; // Chamber ID
  to: string; // Chamber ID
  path: Vector2D[];
  width: number;
}

// Colony state
export interface ColonyState {
  // Dimensions
  width: number;
  height: number;

  // Entities
  queen: Queen | null;
  ants: Map<string, Ant>;
  chambers: Map<string, Chamber>;
  tunnels: Map<string, Tunnel>;

  // Pheromones
  pheromoneMap: PheromoneMap | null;
  trails: Map<string, Trail>;
  alarms: Map<string, Alarm>;

  // Simulation state
  isRunning: boolean;
  tickCount: number;
  lastTickTime: number;

  // Viewport
  viewportOffset: Vector2D;
  zoom: number;

  // Selection
  selectedAntId: string | null;
  hoveredAntId: string | null;

  // Actions
  initialize: (width: number, height: number) => void;
  tick: (deltaTime: number) => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  spawnAmbientAnts: (count: number) => void;

  // Entity management
  spawnAnt: (caste: AntCaste, position: Vector2D, taskId?: string) => string;
  removeAnt: (id: string) => void;
  getAnt: (id: string) => Ant | undefined;
  getAllAnts: () => Ant[];
  getAntRenderData: () => AntRenderData[];

  // Queen management
  createQueen: (position: Vector2D) => void;
  activateQueen: () => void;
  deactivateQueen: () => void;

  // Chamber management
  addChamber: (chamber: Chamber) => void;
  removeChamber: (id: string) => void;
  connectChambers: (fromId: string, toId: string) => void;

  // Pheromone management
  depositPheromone: (position: Vector2D, type: PheromoneType, amount?: number) => void;
  createTrail: (id: string, sourceId: string) => Trail;
  removeTrail: (id: string) => void;
  createAlarm: (position: Vector2D, severity: 'low' | 'medium' | 'high' | 'critical') => string;
  removeAlarm: (id: string) => void;

  // Viewport
  setViewport: (offset: Vector2D, zoom: number) => void;
  panBy: (delta: Vector2D) => void;
  zoomBy: (factor: number, center?: Vector2D) => void;

  // Selection
  selectAnt: (id: string | null) => void;
  hoverAnt: (id: string | null) => void;
}

let antIdCounter = 0;
let alarmIdCounter = 0;

export const useColonyStore = create<ColonyState>((set, get) => ({
  // Initial state
  width: 0,
  height: 0,
  queen: null,
  ants: new Map(),
  chambers: new Map(),
  tunnels: new Map(),
  pheromoneMap: null,
  trails: new Map(),
  alarms: new Map(),
  isRunning: false,
  tickCount: 0,
  lastTickTime: 0,
  viewportOffset: { x: 0, y: 0 },
  zoom: 1,
  selectedAntId: null,
  hoveredAntId: null,

  // Initialize colony
  initialize: (width: number, height: number) => {
    const pheromoneMap = new PheromoneMap(width, height, 20);

    // Create default chambers
    const chambers = new Map<string, Chamber>();
    const centerX = width / 2;
    const centerY = height / 2;

    // Royal chamber (center)
    chambers.set('royal', {
      id: 'royal',
      type: 'royal',
      position: { x: centerX, y: centerY - 50 },
      radius: 80,
      color: '#F59E0B',
      connections: ['nursery', 'foraging'],
    });

    // Nursery (adjacent to royal)
    chambers.set('nursery', {
      id: 'nursery',
      type: 'nursery',
      position: { x: centerX - 120, y: centerY },
      radius: 60,
      color: '#84CC16',
      connections: ['royal', 'archive'],
    });

    // Foraging gallery
    chambers.set('foraging', {
      id: 'foraging',
      type: 'foraging',
      position: { x: centerX + 120, y: centerY },
      radius: 100,
      color: '#EA8A3A',
      connections: ['royal', 'war'],
    });

    // Archive chambers
    chambers.set('archive', {
      id: 'archive',
      type: 'archive',
      position: { x: centerX - 180, y: centerY + 100 },
      radius: 70,
      color: '#06B6D4',
      connections: ['nursery', 'builders'],
    });

    // Builders workshop
    chambers.set('builders', {
      id: 'builders',
      type: 'builders',
      position: { x: centerX, y: centerY + 150 },
      radius: 60,
      color: '#0EA5E9',
      connections: ['archive', 'seasonal'],
    });

    // War room
    chambers.set('war', {
      id: 'war',
      type: 'war',
      position: { x: centerX + 180, y: centerY + 100 },
      radius: 50,
      color: '#DC2626',
      connections: ['foraging', 'seasonal'],
    });

    // Seasonal cycles
    chambers.set('seasonal', {
      id: 'seasonal',
      type: 'seasonal',
      position: { x: centerX + 80, y: centerY + 180 },
      radius: 50,
      color: '#A855F7',
      connections: ['builders', 'war'],
    });

    set({
      width,
      height,
      pheromoneMap,
      chambers,
      tunnels: new Map(),
    });

    // Create queen in royal chamber
    get().createQueen({ x: centerX, y: centerY - 50 });

    // Spawn ambient ants for atmosphere
    get().spawnAmbientAnts(15);
  },

  // Spawn ambient ants for visual richness
  spawnAmbientAnts: (count: number) => {
    const state = get();
    const chambers = Array.from(state.chambers.values());

    for (let i = 0; i < count; i++) {
      // Pick a random chamber
      const chamber = chambers[Math.floor(Math.random() * chambers.length)];

      // Random position within chamber
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * chamber.radius * 0.7;
      const position = {
        x: chamber.position.x + Math.cos(angle) * distance,
        y: chamber.position.y + Math.sin(angle) * distance,
      };

      // Determine caste based on chamber type
      let caste: AntCaste = 'worker';
      if (chamber.type === 'war') caste = 'soldier';
      else if (chamber.type === 'nursery') caste = 'nurse';
      else if (chamber.type === 'foraging') caste = 'forager';
      else if (chamber.type === 'builders') caste = 'architect';

      // Spawn as ambient (no task)
      state.spawnAnt(caste, position, undefined);
    }
  },

  // Simulation tick
  tick: (deltaTime: number) => {
    const state = get();
    if (!state.isRunning) return;

    const bounds = { width: state.width, height: state.height };

    // Update queen
    if (state.queen) {
      state.queen.update(deltaTime, bounds);
    }

    // Update all ants
    for (const ant of state.ants.values()) {
      ant.update(deltaTime, bounds);

      // Check for pheromone sensing
      if (state.pheromoneMap) {
        const trail = state.pheromoneMap.findStrongestDirection(
          ant.position,
          'trail'
        );
        if (trail) {
          ant.sensePheromone('trail', trail.strength, trail.direction);
        }

        // Check for alarm
        const alarm = state.pheromoneMap.sense(ant.position, 'alarm');
        if (alarm > 0.1) {
          ant.sensePheromone('alarm', alarm);
          if (ant.caste === 'soldier') {
            ant.setState('alarmed');
          }
        }
      }

      // Workers deposit pheromones when carrying
      if (ant instanceof Worker && ant.shouldDepositPheromone()) {
        state.depositPheromone(ant.position, 'trail', 0.2);
      }
    }

    // Update pheromone map
    if (state.pheromoneMap) {
      state.pheromoneMap.update(deltaTime);
    }

    // Update trails
    for (const trail of state.trails.values()) {
      trail.update(deltaTime);
      if (!trail.isVisible()) {
        state.trails.delete(trail.id);
      }
    }

    // Update alarms
    for (const alarm of state.alarms.values()) {
      alarm.update(deltaTime);
      if (!alarm.isVisible()) {
        state.alarms.delete(alarm.id);
      }
    }

    // Remove dead ants
    for (const [id, ant] of state.ants) {
      if (ant.isDead) {
        state.ants.delete(id);
      }
    }

    set({
      tickCount: state.tickCount + 1,
      lastTickTime: Date.now(),
    });
  },

  start: () => set({ isRunning: true }),
  stop: () => set({ isRunning: false }),

  reset: () => {
    const { width, height } = get();
    antIdCounter = 0;
    alarmIdCounter = 0;
    set({
      queen: null,
      ants: new Map(),
      trails: new Map(),
      alarms: new Map(),
      tickCount: 0,
      selectedAntId: null,
      hoveredAntId: null,
    });
    get().initialize(width, height);
  },

  // Spawn an ant
  spawnAnt: (caste: AntCaste, position: Vector2D, taskId?: string) => {
    const id = `ant-${++antIdCounter}`;
    let ant: Ant;

    switch (caste) {
      case 'soldier':
        ant = new Soldier({
          id,
          position,
          taskId,
          patrolCenter: position,
          patrolRadius: 80,
        });
        break;
      case 'drone':
        ant = new Drone({
          id,
          position,
          taskId,
          scheduleName: taskId,
        });
        break;
      case 'forager':
      case 'nurse':
      case 'architect':
      default:
        ant = new Worker({
          id,
          position,
          taskId,
          role: caste === 'forager' ? 'forager' : caste === 'nurse' ? 'nurse' : 'builder',
          homePosition: get().chambers.get('royal')?.position ?? position,
        });
        break;
    }

    const ants = new Map(get().ants);
    ants.set(id, ant);
    set({ ants });

    return id;
  },

  removeAnt: (id: string) => {
    const ants = new Map(get().ants);
    ants.delete(id);
    set({ ants });
  },

  getAnt: (id: string) => get().ants.get(id),

  getAllAnts: () => Array.from(get().ants.values()),

  getAntRenderData: () => {
    const data: AntRenderData[] = [];
    const { queen, ants } = get();

    if (queen) {
      data.push(queen.getRenderData());
    }

    for (const ant of ants.values()) {
      data.push(ant.getRenderData());
    }

    return data;
  },

  // Queen management
  createQueen: (position: Vector2D) => {
    const queen = new Queen({
      id: 'queen',
      position,
    });
    set({ queen });
  },

  activateQueen: () => {
    const queen = get().queen;
    if (queen) {
      queen.activate();
      set({ queen });
    }
  },

  deactivateQueen: () => {
    const queen = get().queen;
    if (queen) {
      queen.deactivate();
      set({ queen });
    }
  },

  // Chamber management
  addChamber: (chamber: Chamber) => {
    const chambers = new Map(get().chambers);
    chambers.set(chamber.id, chamber);
    set({ chambers });
  },

  removeChamber: (id: string) => {
    const chambers = new Map(get().chambers);
    chambers.delete(id);
    set({ chambers });
  },

  connectChambers: (fromId: string, toId: string) => {
    const chambers = new Map(get().chambers);
    const from = chambers.get(fromId);
    const to = chambers.get(toId);

    if (from && to) {
      if (!from.connections.includes(toId)) {
        from.connections.push(toId);
      }
      if (!to.connections.includes(fromId)) {
        to.connections.push(fromId);
      }
      chambers.set(fromId, from);
      chambers.set(toId, to);
      set({ chambers });
    }
  },

  // Pheromone management
  depositPheromone: (position: Vector2D, type: PheromoneType, amount?: number) => {
    const pheromoneMap = get().pheromoneMap;
    if (pheromoneMap) {
      pheromoneMap.deposit(position, type, amount);
    }
  },

  createTrail: (id: string, sourceId: string) => {
    const trail = new Trail(id, sourceId);
    const trails = new Map(get().trails);
    trails.set(id, trail);
    set({ trails });
    return trail;
  },

  removeTrail: (id: string) => {
    const trails = new Map(get().trails);
    trails.delete(id);
    set({ trails });
  },

  createAlarm: (position: Vector2D, severity: 'low' | 'medium' | 'high' | 'critical') => {
    const id = `alarm-${++alarmIdCounter}`;
    const alarm = new Alarm(id, position, severity);
    const alarms = new Map(get().alarms);
    alarms.set(id, alarm);
    set({ alarms });

    // Deposit alarm pheromone
    const pheromoneMap = get().pheromoneMap;
    if (pheromoneMap) {
      const amount = severity === 'critical' ? 1.0 : severity === 'high' ? 0.8 : 0.5;
      pheromoneMap.deposit(position, 'alarm', amount);
    }

    // Alert nearby soldiers
    for (const ant of get().ants.values()) {
      if (ant instanceof Soldier) {
        ant.respondToAlarm(position, alarm.intensity);
      }
    }

    return id;
  },

  removeAlarm: (id: string) => {
    const alarms = new Map(get().alarms);
    alarms.delete(id);
    set({ alarms });
  },

  // Viewport
  setViewport: (offset: Vector2D, zoom: number) => {
    set({ viewportOffset: offset, zoom: Math.max(0.1, Math.min(3, zoom)) });
  },

  panBy: (delta: Vector2D) => {
    const { viewportOffset } = get();
    set({
      viewportOffset: {
        x: viewportOffset.x + delta.x,
        y: viewportOffset.y + delta.y,
      },
    });
  },

  zoomBy: (factor: number, center?: Vector2D) => {
    const { zoom, viewportOffset } = get();
    const newZoom = Math.max(0.1, Math.min(3, zoom * factor));

    if (center) {
      // Zoom toward center point
      const zoomRatio = newZoom / zoom;
      set({
        zoom: newZoom,
        viewportOffset: {
          x: center.x - (center.x - viewportOffset.x) * zoomRatio,
          y: center.y - (center.y - viewportOffset.y) * zoomRatio,
        },
      });
    } else {
      set({ zoom: newZoom });
    }
  },

  // Selection
  selectAnt: (id: string | null) => set({ selectedAntId: id }),
  hoverAnt: (id: string | null) => set({ hoveredAntId: id }),
}));
