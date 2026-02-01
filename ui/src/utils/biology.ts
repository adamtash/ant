/**
 * Ant Biology Constants
 * Scientifically-grounded values for realistic simulation
 */

// Caste types mapped to system roles
export type AntCaste = 'queen' | 'worker' | 'soldier' | 'nurse' | 'forager' | 'architect' | 'drone';

// Ant lifecycle states
export type AntState =
  | 'idle'
  | 'exploring'
  | 'following_trail'
  | 'carrying_load'
  | 'recruiting'
  | 'alarmed'
  | 'nursing'
  | 'building'
  | 'defending'
  | 'laying_eggs'
  | 'resting';

// Pheromone types
export type PheromoneType = 'trail' | 'alarm' | 'queen' | 'recruitment' | 'territorial' | 'waste';

/**
 * Lifespan in simulation ticks (1 tick ≈ 16ms at 60fps)
 * Mapped from real ant lifespans to reasonable simulation durations
 */
export const LIFESPAN = {
  queen: Infinity, // Queens are persistent (main agent)
  worker: 180000,  // ~50 minutes (3-5 task cycles)
  soldier: 360000, // ~100 minutes (longer for monitoring)
  nurse: 240000,   // ~66 minutes
  forager: 120000, // ~33 minutes (shorter, risky work)
  architect: 200000, // ~55 minutes
  drone: 30000,    // ~8 minutes (short, scheduled)
} as const;

/**
 * Movement speeds (pixels per tick)
 */
export const SPEED = {
  queen: 0, // Queen doesn't move
  worker: 1.5,
  soldier: 2.0, // Fast for defense
  nurse: 0.8, // Slow, careful
  forager: 2.5, // Fast for efficiency
  architect: 1.0,
  drone: 1.8,
  carrying: 0.6, // Multiplier when carrying load
} as const;

/**
 * Size multipliers (relative to base worker size)
 */
export const SIZE = {
  queen: 3.0,
  worker: 1.0,
  soldier: 2.0,
  nurse: 0.9,
  forager: 1.1,
  architect: 1.0,
  drone: 1.3,
} as const;

/**
 * Pheromone behavior constants
 */
export const PHEROMONE = {
  // Deposition rate (concentration per tick)
  depositionRate: {
    trail: 0.1,
    alarm: 0.8,
    queen: 0.05,
    recruitment: 0.3,
    territorial: 0.02,
    waste: 0.1,
  },
  // Evaporation rate (decay per tick, 0-1)
  evaporationRate: {
    trail: 0.001,      // Slow decay for paths
    alarm: 0.01,       // Fast decay for urgency
    queen: 0.0001,     // Very slow (constant presence)
    recruitment: 0.005,
    territorial: 0.0005,
    waste: 0.002,
  },
  // Detection threshold (minimum to sense)
  threshold: 0.01,
  // Maximum concentration
  maxConcentration: 1.0,
  // Spread radius (pixels)
  spreadRadius: 20,
} as const;

/**
 * ACO (Ant Colony Optimization) parameters
 */
export const ACO = {
  // Probability of random exploration (epsilon-greedy)
  explorationRate: 0.1,
  // Influence of pheromone on path choice (alpha)
  pheromoneInfluence: 1.0,
  // Influence of distance on path choice (beta)
  distanceInfluence: 2.0,
  // Reinforcement multiplier for successful paths
  reinforcement: 2.0,
} as const;

/**
 * Animation timing (in ms)
 */
export const ANIMATION = {
  antennaTwitchInterval: 200,
  legCycleSpeed: 100,
  queenPulseRate: 2000,
  pheromoneShimmer: 500,
  alarmFlashRate: 150,
  spawnDuration: 500,
  retireDuration: 300,
} as const;

/**
 * Chamber types for nest architecture
 */
export type ChamberType =
  | 'royal'
  | 'nursery'
  | 'foraging'
  | 'archive'
  | 'builders'
  | 'war'
  | 'seasonal'
  | 'storage'
  | 'trash';

/**
 * Chamber configuration
 */
export const CHAMBERS = {
  royal: {
    name: 'Royal Chamber',
    color: '#F59E0B',
    size: 150,
    depth: 1,
  },
  nursery: {
    name: 'Nursery',
    color: '#84CC16',
    size: 100,
    depth: 1,
  },
  foraging: {
    name: 'Foraging Gallery',
    color: '#EA8A3A',
    size: 200,
    depth: 2,
  },
  archive: {
    name: 'Archive Chambers',
    color: '#06B6D4',
    size: 120,
    depth: 3,
  },
  builders: {
    name: "Builder's Workshop",
    color: '#0EA5E9',
    size: 100,
    depth: 3,
  },
  war: {
    name: 'War Room',
    color: '#DC2626',
    size: 80,
    depth: 2,
  },
  seasonal: {
    name: 'Seasonal Cycles',
    color: '#A855F7',
    size: 80,
    depth: 3,
  },
  storage: {
    name: 'Storage',
    color: '#8B7355',
    size: 60,
    depth: 4,
  },
  trash: {
    name: 'Midden',
    color: '#6B7280',
    size: 40,
    depth: 4,
  },
} as const;

/**
 * Map system components to ant castes
 */
export const SYSTEM_TO_CASTE: Record<string, AntCaste> = {
  'main_agent': 'queen',
  'subagent': 'worker',
  'error_handler': 'soldier',
  'memory_manager': 'nurse',
  'active_task': 'forager',
  'skill_creator': 'architect',
  'cron_job': 'drone',
};

/**
 * Age-based appearance (temporal polyethism)
 * Returns opacity/wear multiplier based on age
 */
export function getAgeAppearance(currentAge: number, maxLifespan: number): {
  opacity: number;
  wear: number;
} {
  const ageRatio = currentAge / maxLifespan;

  if (ageRatio < 0.2) {
    // Young: bright, pristine
    return { opacity: 1.0, wear: 0 };
  } else if (ageRatio < 0.6) {
    // Mid-age: normal
    return { opacity: 0.95, wear: 0.2 };
  } else {
    // Old: faded, worn
    return { opacity: 0.8, wear: 0.5 + (ageRatio - 0.6) };
  }
}
