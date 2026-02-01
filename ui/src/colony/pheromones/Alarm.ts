/**
 * Alarm Pheromone
 * Visual representation of alarm signals
 */

import type { Vector2D } from '../../utils/vector';
import { distance } from '../../utils/vector';
import { colors } from '../../utils/colors';
import { PHEROMONE } from '../../utils/biology';

export interface AlarmWave {
  id: string;
  center: Vector2D;
  radius: number;
  maxRadius: number;
  intensity: number;
  timestamp: number;
}

export class Alarm {
  readonly id: string;
  readonly position: Vector2D;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';

  private _intensity: number = 0.6;
  private radius: number;
  private waves: AlarmWave[];
  private isActive: boolean;
  private createdAt: number;

  constructor(
    id: string,
    position: Vector2D,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ) {
    this.id = id;
    this.position = { ...position };
    this.severity = severity;

    // Initial intensity based on severity
    switch (severity) {
      case 'low':
        this._intensity = 0.3;
        break;
      case 'medium':
        this._intensity = 0.6;
        break;
      case 'high':
        this._intensity = 0.85;
        break;
      case 'critical':
        this._intensity = 1.0;
        break;
    }

    this.radius = 20;
    this.waves = [];
    this.isActive = true;
    this.createdAt = Date.now();

    // Create initial wave
    this.emitWave();
  }

  /**
   * Get current intensity
   */
  get intensity(): number {
    return this._intensity;
  }

  /**
   * Set intensity
   */
  set intensity(value: number) {
    this._intensity = value;
  }

  /**
   * Get color based on severity
   */
  get color(): string {
    switch (this.severity) {
      case 'critical':
        return colors.soldier.alert;
      case 'high':
        return colors.soldier.rust;
      case 'medium':
        return colors.forager.orange;
      case 'low':
        return colors.queen.amber;
    }
  }

  /**
   * Get max spread radius based on severity
   */
  get maxRadius(): number {
    switch (this.severity) {
      case 'critical':
        return 300;
      case 'high':
        return 200;
      case 'medium':
        return 120;
      case 'low':
        return 60;
    }
  }

  /**
   * Emit a new alarm wave
   */
  emitWave(): void {
    if (!this.isActive) return;

    this.waves.push({
      id: `${this.id}-wave-${this.waves.length}`,
      center: { ...this.position },
      radius: 0,
      maxRadius: this.maxRadius,
      intensity: this.intensity,
      timestamp: Date.now(),
    });

    // Limit wave count
    if (this.waves.length > 5) {
      this.waves.shift();
    }
  }

  /**
   * Update alarm state
   */
  update(deltaTime: number): void {
    const evaporationRate = PHEROMONE.evaporationRate.alarm;
    const timeScale = deltaTime / 16;

    // Evaporate intensity
    this.intensity *= 1 - evaporationRate * timeScale;

    // Expand radius
    this.radius = Math.min(this.maxRadius, this.radius + deltaTime * 0.2);

    // Update waves
    for (const wave of this.waves) {
      // Expand wave
      wave.radius += deltaTime * 0.5;

      // Decay intensity as wave expands
      const expansionRatio = wave.radius / wave.maxRadius;
      wave.intensity = this.intensity * (1 - expansionRatio * 0.8);
    }

    // Remove waves that have expanded fully or faded
    this.waves = this.waves.filter(
      (w) => w.radius < w.maxRadius && w.intensity > 0.05
    );

    // Emit new waves periodically if still active
    if (this.isActive && this.intensity > 0.2) {
      const timeSinceLastWave =
        this.waves.length > 0
          ? Date.now() - this.waves[this.waves.length - 1].timestamp
          : 1000;

      const waveInterval = this.severity === 'critical' ? 300 : 500;
      if (timeSinceLastWave > waveInterval) {
        this.emitWave();
      }
    }

    // Check if alarm should deactivate
    if (this.intensity < PHEROMONE.threshold) {
      this.isActive = false;
    }
  }

  /**
   * Check if a position is within the alarm zone
   */
  isInRange(position: Vector2D): boolean {
    return distance(this.position, position) <= this.radius;
  }

  /**
   * Get intensity at a position (falls off with distance)
   */
  getIntensityAt(position: Vector2D): number {
    const dist = distance(this.position, position);
    if (dist > this.radius) return 0;

    const falloff = 1 - dist / this.radius;
    return this.intensity * falloff;
  }

  /**
   * Check if alarm is still active
   */
  isVisible(): boolean {
    return this.intensity > PHEROMONE.threshold || this.waves.length > 0;
  }

  /**
   * Stop the alarm
   */
  stop(): void {
    this.isActive = false;
  }

  /**
   * Reinforce the alarm
   */
  reinforce(): void {
    this.intensity = Math.min(1.0, this.intensity + 0.3);
    this.isActive = true;
    this.emitWave();
  }

  /**
   * Get waves for rendering
   */
  getWaves(): AlarmWave[] {
    return this.waves;
  }

  /**
   * Get render data
   */
  getRenderData(): {
    position: Vector2D;
    color: string;
    intensity: number;
    radius: number;
    waves: AlarmWave[];
  } {
    return {
      position: this.position,
      color: this.color,
      intensity: this.intensity,
      radius: this.radius,
      waves: this.waves,
    };
  }

  /**
   * Get age of alarm in ms
   */
  getAge(): number {
    return Date.now() - this.createdAt;
  }
}
