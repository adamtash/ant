/**
 * Worker Ant Entity
 * General-purpose labor ant with age-based specialization
 * Maps to subagents/task executors in the system
 */

import { Ant, type AntConfig } from './Ant';
import type { Vector2D } from '../../utils/vector';
import { distance, normalize, angle, fromAngle } from '../../utils/vector';
import type { AntCaste, AntState } from '../../utils/biology';
import { colors } from '../../utils/colors';

export type WorkerRole = 'forager' | 'nurse' | 'builder' | 'cleaner' | 'scout';

export interface WorkerConfig extends Omit<AntConfig, 'caste'> {
  role?: WorkerRole;
  homePosition?: Vector2D;
}

export interface WorkerRenderData {
  id: string;
  position: Vector2D;
  direction: number;
  role: WorkerRole;
  state: AntState;
  progress: number; // Task progress 0-100
  isCarrying: boolean;
  carryColor?: string;
}

export class Worker extends Ant {
  // Worker-specific properties
  role: WorkerRole;
  homePosition: Vector2D;
  targetPosition?: Vector2D;
  progress: number;
  successCount: number;
  failureCount: number;

  // Foraging
  foundResource: boolean;
  resourceValue: number;

  // Pheromone laying
  lastPheromoneTime: number;
  pheromoneInterval: number;

  constructor(config: WorkerConfig) {
    // Determine caste based on role
    const caste = config.role === 'forager' ? 'forager' : 'worker';

    super({
      ...config,
      caste: caste as AntCaste,
      state: config.state ?? 'idle',
    });

    this.role = config.role ?? 'forager';
    this.homePosition = config.homePosition ?? { ...config.position };
    this.progress = 0;
    this.successCount = 0;
    this.failureCount = 0;

    this.foundResource = false;
    this.resourceValue = 0;

    this.lastPheromoneTime = 0;
    this.pheromoneInterval = 100; // ms between pheromone deposits
  }

  /**
   * Get color based on role and state
   */
  get color(): string {
    switch (this.role) {
      case 'forager':
        return colors.forager.ochre;
      case 'nurse':
        return colors.nurse.green;
      case 'builder':
        return colors.architect.sky;
      case 'cleaner':
        return colors.worker.worn;
      case 'scout':
        return colors.forager.gold;
      default:
        return colors.worker.earth;
    }
  }

  /**
   * Specialized role based on age (temporal polyethism)
   */
  updateRoleByAge(): void {
    const ageRatio = this.age / this.maxLifespan;

    if (ageRatio < 0.2) {
      // Young workers do safe internal tasks
      if (this.role !== 'nurse' && this.role !== 'cleaner') {
        this.role = 'nurse';
      }
    } else if (ageRatio < 0.5) {
      // Mid-age workers do construction
      if (this.role === 'nurse') {
        this.role = 'builder';
      }
    } else {
      // Older workers do risky foraging
      if (this.role !== 'forager' && this.role !== 'scout') {
        this.role = 'forager';
      }
    }
  }

  /**
   * Start foraging for a resource
   */
  startForaging(target: Vector2D): void {
    this.targetPosition = target;
    this.setState('exploring');
    this.foundResource = false;
  }

  /**
   * Found a resource, start returning home
   */
  foundResourceAt(value: number): void {
    this.foundResource = true;
    this.resourceValue = value;
    this.targetPosition = this.homePosition;
    this.setState('carrying_load');
    this.isCarrying = true;
  }

  /**
   * Delivered resource, ready for next task
   */
  deliveredResource(): void {
    this.successCount++;
    this.foundResource = false;
    this.resourceValue = 0;
    this.isCarrying = false;
    this.setState('idle');
    this.progress = 0;
  }

  /**
   * Update worker behavior
   */
  update(deltaTime: number, bounds: { width: number; height: number }): void {
    // Call base update
    super.update(deltaTime, bounds);

    if (this.isDead) return;

    // Update role based on age (less frequent check)
    if (Math.random() < 0.001) {
      this.updateRoleByAge();
    }

    // Update progress if moving toward target
    if (this.targetPosition) {
      const dist = this.distanceTo(this.targetPosition);
      const initialDist = distance(this.homePosition, this.targetPosition);

      if (this.foundResource) {
        // Returning home
        this.progress = Math.max(0, Math.min(100, (1 - dist / initialDist) * 100));
      } else {
        // Going to target
        this.progress = Math.max(0, Math.min(100, (1 - dist / initialDist) * 100));
      }

      // Check if reached target
      if (dist < 20) {
        if (this.foundResource) {
          // Reached home with resource
          this.deliveredResource();
        } else {
          // Reached target, find resource
          this.foundResourceAt(1.0);
        }
      }
    }
  }

  /**
   * Override behavior based on role
   */
  protected updateBehavior(deltaTime: number): void {
    switch (this.role) {
      case 'forager':
      case 'scout':
        this.behaviorForager(deltaTime);
        break;
      case 'nurse':
        this.behaviorNurse(deltaTime);
        break;
      case 'builder':
        this.behaviorBuilder(deltaTime);
        break;
      case 'cleaner':
        this.behaviorCleaner(deltaTime);
        break;
      default:
        super.updateBehavior(deltaTime);
    }
  }

  /**
   * Forager/Scout behavior
   */
  protected behaviorForager(_deltaTime: number): void {
    if (this.targetPosition) {
      // Move toward target
      const dir = normalize({
        x: this.targetPosition.x - this.position.x,
        y: this.targetPosition.y - this.position.y,
      });
      this.targetDirection = angle(dir);
      this.velocity = fromAngle(this.targetDirection, this.currentSpeed);
    } else {
      // Random exploration
      this.behaviorExplore(_deltaTime);
    }
  }

  /**
   * Nurse behavior - stay near nursery, slow careful movements
   */
  protected behaviorNurse(_deltaTime: number): void {
    // Tend to stay near home
    const homeDistance = this.distanceTo(this.homePosition);

    if (homeDistance > 100) {
      // Return home
      const dir = normalize({
        x: this.homePosition.x - this.position.x,
        y: this.homePosition.y - this.position.y,
      });
      this.targetDirection = angle(dir);
      this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.5);
    } else {
      // Small movements around home
      if (Math.random() < 0.02) {
        this.targetDirection += (Math.random() - 0.5) * Math.PI * 0.3;
      }
      this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.3);
    }
  }

  /**
   * Builder behavior - purposeful movement to construction sites
   */
  protected behaviorBuilder(_deltaTime: number): void {
    if (this.targetPosition) {
      const dir = normalize({
        x: this.targetPosition.x - this.position.x,
        y: this.targetPosition.y - this.position.y,
      });
      this.targetDirection = angle(dir);
      this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.8);
    } else {
      // Patrol around home
      this.behaviorNurse(_deltaTime);
    }
  }

  /**
   * Cleaner behavior - move around collecting waste
   */
  protected behaviorCleaner(_deltaTime: number): void {
    // Random patrol with occasional changes
    if (Math.random() < 0.03) {
      this.targetDirection += (Math.random() - 0.5) * Math.PI * 0.5;
    }
    this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.6);
  }

  /**
   * Should this worker deposit pheromone?
   */
  shouldDepositPheromone(): boolean {
    const now = Date.now();
    if (now - this.lastPheromoneTime > this.pheromoneInterval) {
      // Only deposit when carrying or found resource
      if (this.foundResource || this.state === 'carrying_load') {
        this.lastPheromoneTime = now;
        return true;
      }
    }
    return false;
  }

  /**
   * Get worker-specific render data
   */
  getWorkerRenderData(): WorkerRenderData {
    return {
      id: this.id,
      position: { ...this.position },
      direction: this.direction,
      role: this.role,
      state: this.state,
      progress: this.progress,
      isCarrying: this.isCarrying,
      carryColor: this.isCarrying ? colors.forager.gold : undefined,
    };
  }

  /**
   * Set home position
   */
  setHome(position: Vector2D): void {
    this.homePosition = { ...position };
  }

  /**
   * Set target position
   */
  setTarget(target: Vector2D): void {
    this.targetPosition = { ...target };
    super.setTarget(target);
  }
}
