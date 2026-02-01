/**
 * Drone Ant Entity
 * Seasonal reproductive ant for scheduled tasks
 * Maps to cron jobs in the system
 */

import { Ant, type AntConfig } from './Ant';
import type { Vector2D } from '../../utils/vector';
import { fromAngle } from '../../utils/vector';
import { colors } from '../../utils/colors';

export type DronePhase = 'emerging' | 'active' | 'completed' | 'departing';

export interface DroneConfig extends Omit<AntConfig, 'caste'> {
  scheduleName?: string;
  scheduledTime?: number;
  duration?: number;
}

export interface DroneRenderData {
  id: string;
  position: Vector2D;
  direction: number;
  phase: DronePhase;
  progress: number;
  hasWings: boolean;
  wingPhase: number;
}

export class Drone extends Ant {
  // Drone-specific properties
  scheduleName: string;
  scheduledTime: number;
  duration: number;
  phase: DronePhase;
  progress: number; // 0-100

  // Appearance
  hasWings: boolean;
  wingPhase: number;

  // Lifecycle
  emergeTime: number;
  completeTime?: number;

  constructor(config: DroneConfig) {
    super({
      ...config,
      caste: 'drone',
      state: 'idle',
    });

    this.scheduleName = config.scheduleName ?? 'Unknown Job';
    this.scheduledTime = config.scheduledTime ?? Date.now();
    this.duration = config.duration ?? 10000; // 10 seconds default
    this.phase = 'emerging';
    this.progress = 0;

    this.hasWings = true;
    this.wingPhase = 0;

    this.emergeTime = Date.now();
  }

  /**
   * Get drone color
   */
  get color(): string {
    return colors.drone.violet;
  }

  /**
   * Update drone behavior
   */
  update(deltaTime: number, bounds: { width: number; height: number }): void {
    // Call base update for basic physics
    super.update(deltaTime, bounds);

    if (this.isDead) return;

    // Wing animation
    this.wingPhase += deltaTime * 0.5;

    // Phase-specific behavior
    switch (this.phase) {
      case 'emerging':
        this.updateEmerging(deltaTime);
        break;
      case 'active':
        this.updateActive(deltaTime);
        break;
      case 'completed':
        this.updateCompleted(deltaTime);
        break;
      case 'departing':
        this.updateDeparting(deltaTime);
        break;
    }
  }

  /**
   * Emerging phase - drone appears
   */
  protected updateEmerging(_deltaTime: number): void {
    const timeSinceEmerge = Date.now() - this.emergeTime;

    // Emerge animation lasts 1 second
    if (timeSinceEmerge < 1000) {
      // Rising up motion
      this.velocity = { x: 0, y: -1 };
    } else {
      // Transition to active
      this.phase = 'active';
      this.setState('exploring');
    }
  }

  /**
   * Active phase - performing scheduled task
   */
  protected updateActive(_deltaTime: number): void {
    const timeSinceEmerge = Date.now() - this.emergeTime;
    this.progress = Math.min(100, ((timeSinceEmerge - 1000) / this.duration) * 100);

    // Gentle hovering movement
    this.targetDirection += (Math.random() - 0.5) * 0.1;
    this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.5);

    // Check if task is complete
    if (this.progress >= 100) {
      this.complete();
    }
  }

  /**
   * Completed phase - task done, brief pause
   */
  protected updateCompleted(_deltaTime: number): void {
    // Slow down
    this.velocity = { x: this.velocity.x * 0.9, y: this.velocity.y * 0.9 };

    // After 1 second, start departing
    const timeSinceComplete = Date.now() - (this.completeTime ?? Date.now());
    if (timeSinceComplete > 1000) {
      this.phase = 'departing';
    }
  }

  /**
   * Departing phase - flying away
   */
  protected updateDeparting(_deltaTime: number): void {
    // Fly upward and away
    this.velocity = { x: Math.random() - 0.5, y: -2 };

    // Die after moving off screen
    if (this.position.y < -50) {
      this.die();
    }
  }

  /**
   * Mark task as complete
   */
  complete(): void {
    if (this.phase !== 'completed') {
      this.phase = 'completed';
      this.completeTime = Date.now();
      this.progress = 100;
    }
  }

  /**
   * Cancel the drone/task
   */
  cancel(): void {
    this.phase = 'departing';
  }

  /**
   * Check if drone is still active
   */
  isActive(): boolean {
    return this.phase === 'active' || this.phase === 'emerging';
  }

  /**
   * Get drone-specific render data
   */
  getDroneRenderData(): DroneRenderData {
    return {
      id: this.id,
      position: { ...this.position },
      direction: this.direction,
      phase: this.phase,
      progress: this.progress,
      hasWings: this.hasWings,
      wingPhase: this.wingPhase,
    };
  }
}
