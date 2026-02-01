/**
 * Trail Pheromone
 * Visual representation of pheromone trails between points
 */

import type { Vector2D } from '../../utils/vector';
import { distance, lerp } from '../../utils/vector';
import { colors } from '../../utils/colors';
import { PHEROMONE } from '../../utils/biology';

export interface TrailPoint {
  position: Vector2D;
  concentration: number;
  timestamp: number;
}

export interface TrailSegment {
  from: Vector2D;
  to: Vector2D;
  concentration: number;
  width: number;
  color: string;
  opacity: number;
}

export class Trail {
  readonly id: string;
  readonly sourceId: string; // Ant that created this trail
  readonly color: string;

  private points: TrailPoint[];
  private maxPoints: number;
  private isActive: boolean;

  constructor(id: string, sourceId: string, color?: string) {
    this.id = id;
    this.sourceId = sourceId;
    this.color = color ?? colors.pheromone.trail;
    this.points = [];
    this.maxPoints = 200;
    this.isActive = true;
  }

  /**
   * Add a point to the trail
   */
  addPoint(position: Vector2D, concentration?: number): void {
    if (!this.isActive) return;

    // Check if we should add this point (not too close to last)
    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      if (distance(last.position, position) < 5) {
        return; // Too close, skip
      }
    }

    this.points.push({
      position: { ...position },
      concentration: concentration ?? 1.0,
      timestamp: Date.now(),
    });

    // Limit trail length
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }
  }

  /**
   * Update trail (evaporation)
   */
  update(deltaTime: number): void {
    const evaporationRate = PHEROMONE.evaporationRate.trail;
    const timeScale = deltaTime / 16;

    // Evaporate each point
    for (const point of this.points) {
      point.concentration *= 1 - evaporationRate * timeScale;
    }

    // Remove dead points
    this.points = this.points.filter(
      (p) => p.concentration > PHEROMONE.threshold
    );
  }

  /**
   * Get trail segments for rendering
   */
  getSegments(): TrailSegment[] {
    const segments: TrailSegment[] = [];

    for (let i = 1; i < this.points.length; i++) {
      const from = this.points[i - 1];
      const to = this.points[i];

      // Average concentration for segment
      const concentration = (from.concentration + to.concentration) / 2;

      if (concentration < PHEROMONE.threshold) continue;

      segments.push({
        from: from.position,
        to: to.position,
        concentration,
        width: 1 + concentration * 3,
        color: this.color,
        opacity: concentration * 0.8,
      });
    }

    return segments;
  }

  /**
   * Get all points
   */
  getPoints(): TrailPoint[] {
    return this.points;
  }

  /**
   * Check if trail is still visible
   */
  isVisible(): boolean {
    return this.points.some((p) => p.concentration > PHEROMONE.threshold);
  }

  /**
   * Stop adding to this trail
   */
  close(): void {
    this.isActive = false;
  }

  /**
   * Clear all points
   */
  clear(): void {
    this.points = [];
  }

  /**
   * Get length of trail
   */
  getLength(): number {
    let length = 0;
    for (let i = 1; i < this.points.length; i++) {
      length += distance(this.points[i - 1].position, this.points[i].position);
    }
    return length;
  }

  /**
   * Get average concentration
   */
  getAverageConcentration(): number {
    if (this.points.length === 0) return 0;
    const sum = this.points.reduce((acc, p) => acc + p.concentration, 0);
    return sum / this.points.length;
  }

  /**
   * Reinforce the trail (increase concentration)
   */
  reinforce(amount: number = 0.2): void {
    for (const point of this.points) {
      point.concentration = Math.min(
        PHEROMONE.maxConcentration,
        point.concentration + amount
      );
    }
  }

  /**
   * Get smoothed path for rendering
   */
  getSmoothedPath(segments: number = 50): Vector2D[] {
    if (this.points.length < 2) return [];

    const smoothed: Vector2D[] = [];
    const totalLength = this.getLength();

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const targetDist = t * totalLength;

      // Find the segment this distance falls into
      let currentDist = 0;
      for (let j = 1; j < this.points.length; j++) {
        const segmentLength = distance(
          this.points[j - 1].position,
          this.points[j].position
        );

        if (currentDist + segmentLength >= targetDist) {
          const segmentT = (targetDist - currentDist) / segmentLength;
          smoothed.push(
            lerp(this.points[j - 1].position, this.points[j].position, segmentT)
          );
          break;
        }

        currentDist += segmentLength;
      }
    }

    return smoothed;
  }
}
