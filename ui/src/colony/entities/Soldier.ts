/**
 * Soldier Ant Entity
 * Defense and error handling specialist
 * Maps to error handlers and system monitors
 */

import { Ant, type AntConfig } from './Ant';
import type { Vector2D } from '../../utils/vector';
import { distance, normalize, angle, fromAngle } from '../../utils/vector';
import { colors } from '../../utils/colors';

export type SoldierMode = 'patrol' | 'alert' | 'attack' | 'guard';

export interface SoldierConfig extends Omit<AntConfig, 'caste'> {
  patrolCenter?: Vector2D;
  patrolRadius?: number;
}

export interface SoldierRenderData {
  id: string;
  position: Vector2D;
  direction: number;
  mode: SoldierMode;
  alertLevel: number; // 0-1
  mandiblesOpen: boolean;
}

export class Soldier extends Ant {
  // Soldier-specific properties
  mode: SoldierMode;
  alertLevel: number; // 0-1, intensity of alarm response
  mandiblesOpen: boolean;

  // Patrol behavior
  patrolCenter: Vector2D;
  patrolRadius: number;
  patrolAngle: number;

  // Alert response
  threatPosition?: Vector2D;
  lastAlertTime: number;
  alertDuration: number;

  constructor(config: SoldierConfig) {
    super({
      ...config,
      caste: 'soldier',
      state: 'idle',
    });

    this.mode = 'patrol';
    this.alertLevel = 0;
    this.mandiblesOpen = false;

    this.patrolCenter = config.patrolCenter ?? { ...config.position };
    this.patrolRadius = config.patrolRadius ?? 100;
    this.patrolAngle = Math.random() * Math.PI * 2;

    this.lastAlertTime = 0;
    this.alertDuration = 5000; // 5 seconds of alert response
  }

  /**
   * Get soldier color based on alert level
   */
  get color(): string {
    if (this.alertLevel > 0.5) {
      return colors.soldier.alert;
    }
    return colors.soldier.rust;
  }

  /**
   * Respond to alarm pheromone
   */
  respondToAlarm(threatPos: Vector2D, intensity: number): void {
    this.alertLevel = Math.max(this.alertLevel, intensity);
    this.threatPosition = threatPos;
    this.mode = 'alert';
    this.lastAlertTime = Date.now();
    this.setState('alarmed');
    this.mandiblesOpen = true;
  }

  /**
   * Update soldier behavior
   */
  update(deltaTime: number, bounds: { width: number; height: number }): void {
    // Call base update
    super.update(deltaTime, bounds);

    if (this.isDead) return;

    // Decay alert level over time
    if (this.alertLevel > 0) {
      const timeSinceAlert = Date.now() - this.lastAlertTime;
      if (timeSinceAlert > this.alertDuration) {
        this.alertLevel = Math.max(0, this.alertLevel - 0.01);
        if (this.alertLevel < 0.1) {
          this.returnToPatrol();
        }
      }
    }

    // Mode-specific updates
    switch (this.mode) {
      case 'patrol':
        this.updatePatrol(deltaTime);
        break;
      case 'alert':
        this.updateAlert(deltaTime);
        break;
      case 'attack':
        this.updateAttack(deltaTime);
        break;
      case 'guard':
        this.updateGuard(deltaTime);
        break;
    }
  }

  /**
   * Patrol behavior - circle around perimeter
   */
  protected updatePatrol(deltaTime: number): void {
    // Increment patrol angle
    this.patrolAngle += deltaTime * 0.0005;

    // Calculate patrol position
    const targetX = this.patrolCenter.x + Math.cos(this.patrolAngle) * this.patrolRadius;
    const targetY = this.patrolCenter.y + Math.sin(this.patrolAngle) * this.patrolRadius;

    const target = { x: targetX, y: targetY };
    const dir = normalize({
      x: target.x - this.position.x,
      y: target.y - this.position.y,
    });

    this.targetDirection = angle(dir);
    this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.7);

    // Random mandible movement
    if (Math.random() < 0.01) {
      this.mandiblesOpen = !this.mandiblesOpen;
    }
  }

  /**
   * Alert behavior - rush toward threat
   */
  protected updateAlert(_deltaTime: number): void {
    if (this.threatPosition) {
      const dist = distance(this.position, this.threatPosition);

      if (dist > 30) {
        // Rush toward threat
        const dir = normalize({
          x: this.threatPosition.x - this.position.x,
          y: this.threatPosition.y - this.position.y,
        });
        this.targetDirection = angle(dir);
        this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 1.3);
      } else {
        // Reached threat, switch to attack
        this.mode = 'attack';
      }
    } else {
      // No threat, return to patrol
      this.returnToPatrol();
    }

    // Mandibles open during alert
    this.mandiblesOpen = true;
  }

  /**
   * Attack behavior - aggressive stance at threat location
   */
  protected updateAttack(_deltaTime: number): void {
    // Aggressive movement around threat
    if (this.threatPosition) {
      const dist = distance(this.position, this.threatPosition);

      if (dist < 50) {
        // Circle aggressively
        this.targetDirection += 0.1;
        this.velocity = fromAngle(this.targetDirection, this.currentSpeed * 0.8);
      } else {
        // Return to alert mode if threat moved
        this.mode = 'alert';
      }
    }

    // Mandibles always open during attack
    this.mandiblesOpen = true;

    // Erratic direction changes
    if (Math.random() < 0.1) {
      this.targetDirection += (Math.random() - 0.5) * Math.PI * 0.5;
    }
  }

  /**
   * Guard behavior - stand still, watch
   */
  protected updateGuard(_deltaTime: number): void {
    // Minimal movement
    this.velocity = { x: 0, y: 0 };

    // Occasional direction changes
    if (Math.random() < 0.02) {
      this.targetDirection += (Math.random() - 0.5) * Math.PI * 0.3;
    }

    // Alert mandibles based on alert level
    this.mandiblesOpen = this.alertLevel > 0.3;
  }

  /**
   * Return to patrol mode
   */
  returnToPatrol(): void {
    this.mode = 'patrol';
    this.alertLevel = 0;
    this.threatPosition = undefined;
    this.mandiblesOpen = false;
    this.setState('idle');
  }

  /**
   * Set guard position
   */
  setGuardPosition(position: Vector2D): void {
    this.patrolCenter = position;
    this.mode = 'guard';
  }

  /**
   * Set patrol parameters
   */
  setPatrol(center: Vector2D, radius: number): void {
    this.patrolCenter = center;
    this.patrolRadius = radius;
    this.mode = 'patrol';
  }

  /**
   * Get soldier-specific render data
   */
  getSoldierRenderData(): SoldierRenderData {
    return {
      id: this.id,
      position: { ...this.position },
      direction: this.direction,
      mode: this.mode,
      alertLevel: this.alertLevel,
      mandiblesOpen: this.mandiblesOpen,
    };
  }
}
