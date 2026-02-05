/**
 * Base Ant Entity
 * Foundation class for all ant types in the colony simulation
 */

import type { Vector2D } from '../../utils/vector';
import {
  add,
  scale,
  normalize,
  magnitude,
  wander,
  fromAngle,
  angle,
  distance,
} from '../../utils/vector';
import type { AntCaste, AntState, PheromoneType } from '../../utils/biology';
import {
  SPEED,
  SIZE,
  LIFESPAN,
  PHEROMONE,
  ACO,
  getAgeAppearance,
} from '../../utils/biology';
import { colors } from '../../utils/colors';

export interface AntConfig {
  id: string;
  caste: AntCaste;
  position: Vector2D;
  direction?: number; // radians
  state?: AntState;
  taskId?: string; // Associated system task
  parentId?: string; // Parent ant (for genealogy)
}

export interface AntRenderData {
  id: string;
  caste: AntCaste;
  position: Vector2D;
  direction: number;
  state: AntState;
  size: number;
  color: string;
  opacity: number;
  wear: number;
  isCarrying: boolean;
  antennaPhase: number;
  legPhase: number;
}

export class Ant {
  readonly id: string;
  readonly caste: AntCaste;
  readonly parentId?: string;
  readonly createdAt: number;

  // Position and movement
  position: Vector2D;
  velocity: Vector2D;
  direction: number; // radians
  targetDirection: number;

  // State
  state: AntState;
  previousState: AntState;
  stateStartTime: number;

  // Task association
  taskId?: string;
  isCarrying: boolean;
  carryingData?: unknown;
  
  // Entity tracking (link to backend entity)
  entityType?: 'task' | 'subagent' | 'error' | 'cron' | 'memory' | 'tool';
  entityId?: string;

  // Lifecycle
  age: number; // ticks since spawn
  energy: number; // 0-100
  isDead: boolean;

  // Animation
  antennaPhase: number;
  legPhase: number;
  lastTwitchTime: number;

  // Pheromone sensing
  sensedPheromones: Map<PheromoneType, number>;

  constructor(config: AntConfig) {
    this.id = config.id;
    this.caste = config.caste;
    this.parentId = config.parentId;
    this.createdAt = Date.now();

    // Position
    this.position = { ...config.position };
    this.velocity = { x: 0, y: 0 };
    this.direction = config.direction ?? Math.random() * Math.PI * 2;
    this.targetDirection = this.direction;

    // State
    this.state = config.state ?? 'idle';
    this.previousState = this.state;
    this.stateStartTime = Date.now();

    // Task
    this.taskId = config.taskId;
    this.isCarrying = false;

    // Lifecycle
    this.age = 0;
    this.energy = 100;
    this.isDead = false;

    // Animation
    this.antennaPhase = Math.random() * Math.PI * 2;
    this.legPhase = Math.random() * Math.PI * 2;
    this.lastTwitchTime = 0;

    // Sensing
    this.sensedPheromones = new Map();
  }

  /**
   * Get base movement speed for this ant's caste
   */
  get baseSpeed(): number {
    return SPEED[this.caste] ?? SPEED.worker;
  }

  /**
   * Get current movement speed (modified by state)
   */
  get currentSpeed(): number {
    let speed = this.baseSpeed;

    if (this.isCarrying) {
      speed *= SPEED.carrying;
    }

    if (this.state === 'alarmed') {
      speed *= 1.5; // Faster when alarmed
    } else if (this.state === 'exploring') {
      speed *= 0.7; // Slower when exploring
    } else if (this.state === 'idle') {
      speed *= 0.2; // Very slow when idle
    }

    // Reduce speed with age
    const ageRatio = this.age / this.maxLifespan;
    if (ageRatio > 0.7) {
      speed *= 1 - (ageRatio - 0.7) * 0.5;
    }

    return speed;
  }

  /**
   * Get size multiplier for this ant's caste
   */
  get sizeMultiplier(): number {
    return SIZE[this.caste] ?? SIZE.worker;
  }

  /**
   * Get maximum lifespan in ticks
   */
  get maxLifespan(): number {
    return LIFESPAN[this.caste] ?? LIFESPAN.worker;
  }

  /**
   * Get color for this ant's caste
   */
  get color(): string {
    switch (this.caste) {
      case 'queen':
        return colors.queen.amber;
      case 'soldier':
        return colors.soldier.rust;
      case 'nurse':
        return colors.nurse.green;
      case 'forager':
        return colors.forager.ochre;
      case 'architect':
        return colors.architect.sky;
      case 'drone':
        return colors.drone.violet;
      default:
        return colors.worker.earth;
    }
  }

  /**
   * Update ant state for one simulation tick
   */
  update(deltaTime: number, bounds: { width: number; height: number }): void {
    if (this.isDead) return;

    // Age the ant
    this.age += deltaTime;

    // Check for death
    if (this.age >= this.maxLifespan && this.maxLifespan !== Infinity) {
      this.die();
      return;
    }

    // Reduce energy over time
    this.energy = Math.max(0, this.energy - 0.01 * deltaTime);

    // Update animation phases
    this.updateAnimation(deltaTime);

    // State-specific behavior
    this.updateBehavior(deltaTime);

    // Apply movement
    this.move(deltaTime, bounds);
  }

  /**
   * Update animation phases (staccato movement, antennae twitching)
   */
  protected updateAnimation(deltaTime: number): void {
    // Leg animation (continuous when moving, 6-leg alternating pattern)
    if (magnitude(this.velocity) > 0.1) {
      // Faster leg cycle for more realistic ant locomotion
      this.legPhase += deltaTime * 0.4;
    }

    // Constant antenna sensing animation
    this.antennaPhase += deltaTime * 0.15;

    // Random antenna twitch (independent twitching)
    const timeSinceLastTwitch = Date.now() - this.lastTwitchTime;
    const twitchInterval = this.state === 'exploring' ? 100 : 250;

    if (timeSinceLastTwitch > twitchInterval + Math.random() * twitchInterval) {
      // Sharp antenna twitch
      this.antennaPhase += (Math.random() - 0.5) * 1.5;
      this.lastTwitchTime = Date.now();
    }

    // More frequent twitches when alarmed
    if (this.state === 'alarmed' && Math.random() < 0.1) {
      this.antennaPhase += (Math.random() - 0.5) * 2;
    }
  }

  /**
   * Update behavior based on current state
   */
  protected updateBehavior(deltaTime: number): void {
    switch (this.state) {
      case 'idle':
        this.behaviorIdle(deltaTime);
        break;
      case 'exploring':
        this.behaviorExplore(deltaTime);
        break;
      case 'following_trail':
        this.behaviorFollowTrail(deltaTime);
        break;
      case 'alarmed':
        this.behaviorAlarmed(deltaTime);
        break;
      case 'carrying_load':
        this.behaviorCarrying(deltaTime);
        break;
      default:
        this.behaviorIdle(deltaTime);
    }
  }

  /**
   * Idle behavior - slight random movement
   */
  protected behaviorIdle(_deltaTime: number): void {
    // Small random direction changes
    if (Math.random() < 0.02) {
      this.targetDirection += (Math.random() - 0.5) * Math.PI * 0.5;
    }

    // Very slow movement
    const dir = fromAngle(this.targetDirection, this.currentSpeed * 0.1);
    this.velocity = dir;
  }

  /**
   * Exploration behavior - random walk
   */
  protected behaviorExplore(_deltaTime: number): void {
    // Wander randomly
    const currentDir = fromAngle(this.direction, 1);
    const newDir = wander(currentDir, 0.4);
    this.targetDirection = angle(newDir);

    // Move forward
    const dir = fromAngle(this.targetDirection, this.currentSpeed);
    this.velocity = dir;
  }

  /**
   * Trail following behavior
   */
  protected behaviorFollowTrail(_deltaTime: number): void {
    // Check for pheromone direction
    const trailStrength = this.sensedPheromones.get('trail') ?? 0;

    if (trailStrength > PHEROMONE.threshold) {
      // Follow trail with some randomness (epsilon-greedy)
      if (Math.random() > ACO.explorationRate) {
        // Follow pheromone (direction should be set by pheromone sensing)
        const dir = fromAngle(this.targetDirection, this.currentSpeed);
        this.velocity = dir;
      } else {
        // Random exploration
        this.behaviorExplore(_deltaTime);
      }
    } else {
      // No trail detected, switch to exploration
      this.setState('exploring');
    }
  }

  /**
   * Alarmed behavior - fast, erratic movement
   */
  protected behaviorAlarmed(_deltaTime: number): void {
    // Erratic direction changes
    this.targetDirection += (Math.random() - 0.5) * Math.PI;

    // Fast movement
    const dir = fromAngle(this.targetDirection, this.currentSpeed);
    this.velocity = dir;
  }

  /**
   * Carrying load behavior - move toward destination
   */
  protected behaviorCarrying(_deltaTime: number): void {
    // Move toward target (should be set externally)
    const dir = fromAngle(this.targetDirection, this.currentSpeed);
    this.velocity = dir;
  }

  /**
   * Apply movement with collision handling and staccato motion
   */
  protected move(deltaTime: number, bounds: { width: number; height: number }): void {
    // Staccato movement: ants move in short bursts, not smoothly
    const staccatoPhase = Math.sin(this.legPhase * 6);
    const staccatoMultiplier = 0.5 + 0.5 * Math.max(0, staccatoPhase);

    // Gradually turn toward target direction
    const turnRate = 0.1;
    let angleDiff = this.targetDirection - this.direction;

    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    this.direction += angleDiff * turnRate;

    // Apply velocity with staccato effect
    const movement = scale(this.velocity, deltaTime * staccatoMultiplier);
    this.position = add(this.position, movement);

    // Small random micro-movements (ant jitter)
    if (Math.random() < 0.1) {
      this.position.x += (Math.random() - 0.5) * 0.5;
      this.position.y += (Math.random() - 0.5) * 0.5;
    }

    // Boundary handling
    const margin = 20;
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;
    const minX = -halfWidth + margin;
    const maxX = halfWidth - margin;
    const minY = -halfHeight + margin;
    const maxY = halfHeight - margin;

    if (this.position.x < minX) {
      this.position.x = minX;
      this.targetDirection = Math.PI - this.targetDirection;
    }
    if (this.position.x > maxX) {
      this.position.x = maxX;
      this.targetDirection = Math.PI - this.targetDirection;
    }
    if (this.position.y < minY) {
      this.position.y = minY;
      this.targetDirection = -this.targetDirection;
    }
    if (this.position.y > maxY) {
      this.position.y = maxY;
      this.targetDirection = -this.targetDirection;
    }
  }

  /**
   * Change ant state
   */
  setState(newState: AntState): void {
    if (this.state !== newState) {
      this.previousState = this.state;
      this.state = newState;
      this.stateStartTime = Date.now();
    }
  }

  /**
   * Sense pheromones at current position
   */
  sensePheromone(type: PheromoneType, concentration: number, direction?: number): void {
    this.sensedPheromones.set(type, concentration);

    // If direction provided, consider moving toward it
    if (direction !== undefined && concentration > PHEROMONE.threshold) {
      const influence = concentration * ACO.pheromoneInfluence;
      this.targetDirection = this.targetDirection * (1 - influence) + direction * influence;
    }
  }

  /**
   * Pick up a load
   */
  pickUp(data: unknown): void {
    this.isCarrying = true;
    this.carryingData = data;
    this.setState('carrying_load');
  }

  /**
   * Drop current load
   */
  drop(): unknown {
    const data = this.carryingData;
    this.isCarrying = false;
    this.carryingData = undefined;
    return data;
  }

  /**
   * Mark ant as dead
   */
  die(): void {
    this.isDead = true;
    this.velocity = { x: 0, y: 0 };
  }

  /**
   * Get render data for visualization
   */
  getRenderData(): AntRenderData {
    const { opacity, wear } = getAgeAppearance(this.age, this.maxLifespan);

    return {
      id: this.id,
      caste: this.caste,
      position: { ...this.position },
      direction: this.direction,
      state: this.state,
      size: this.sizeMultiplier,
      color: this.color,
      opacity,
      wear,
      isCarrying: this.isCarrying,
      antennaPhase: this.antennaPhase,
      legPhase: this.legPhase,
    };
  }

  /**
   * Set target for movement
   */
  setTarget(target: Vector2D): void {
    const dir = normalize({
      x: target.x - this.position.x,
      y: target.y - this.position.y,
    });
    this.targetDirection = angle(dir);
  }

  /**
   * Get distance to a point
   */
  distanceTo(point: Vector2D): number {
    return distance(this.position, point);
  }
}
