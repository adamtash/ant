/**
 * Pheromone Map
 * 2D grid for tracking pheromone concentrations
 * Implements deposition, evaporation, and sensing
 */

import type { Vector2D } from '../../utils/vector';
import type { PheromoneType } from '../../utils/biology';
import { PHEROMONE } from '../../utils/biology';
import { colors } from '../../utils/colors';

export interface PheromoneCell {
  trail: number;
  alarm: number;
  queen: number;
  recruitment: number;
  territorial: number;
  waste: number;
}

export interface PheromonePoint {
  position: Vector2D;
  type: PheromoneType;
  concentration: number;
  direction?: number; // Direction this pheromone leads to
  timestamp: number;
}

export class PheromoneMap {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly gridWidth: number;
  readonly gridHeight: number;

  private grid: PheromoneCell[][];
  private directionGrid: Map<string, number>[][]; // Direction hints per cell per type

  // Active pheromone points for rendering
  private activePoints: PheromonePoint[];

  constructor(width: number, height: number, cellSize: number = 20) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.gridWidth = Math.ceil(width / cellSize);
    this.gridHeight = Math.ceil(height / cellSize);

    this.grid = this.createGrid();
    this.directionGrid = this.createDirectionGrid();
    this.activePoints = [];
  }

  /**
   * Create empty grid
   */
  private createGrid(): PheromoneCell[][] {
    const grid: PheromoneCell[][] = [];
    for (let y = 0; y < this.gridHeight; y++) {
      const row: PheromoneCell[] = [];
      for (let x = 0; x < this.gridWidth; x++) {
        row.push({
          trail: 0,
          alarm: 0,
          queen: 0,
          recruitment: 0,
          territorial: 0,
          waste: 0,
        });
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Create direction grid
   */
  private createDirectionGrid(): Map<string, number>[][] {
    const grid: Map<string, number>[][] = [];
    for (let y = 0; y < this.gridHeight; y++) {
      const row: Map<string, number>[] = [];
      for (let x = 0; x < this.gridWidth; x++) {
        row.push(new Map());
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Convert world position to grid coordinates
   */
  private toGridCoords(pos: Vector2D): { x: number; y: number } {
    return {
      x: Math.floor(pos.x / this.cellSize),
      y: Math.floor(pos.y / this.cellSize),
    };
  }

  /**
   * Check if grid coordinates are valid
   */
  private isValidCell(x: number, y: number): boolean {
    return x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight;
  }

  /**
   * Deposit pheromone at a position
   */
  deposit(
    position: Vector2D,
    type: PheromoneType,
    amount?: number,
    direction?: number
  ): void {
    const { x, y } = this.toGridCoords(position);
    if (!this.isValidCell(x, y)) return;

    const depositAmount = amount ?? PHEROMONE.depositionRate[type];
    const cell = this.grid[y][x];

    // Add to concentration (capped at max)
    cell[type] = Math.min(
      PHEROMONE.maxConcentration,
      cell[type] + depositAmount
    );

    // Store direction if provided
    if (direction !== undefined) {
      this.directionGrid[y][x].set(type, direction);
    }

    // Add to active points for rendering
    this.activePoints.push({
      position: { ...position },
      type,
      concentration: depositAmount,
      direction,
      timestamp: Date.now(),
    });

    // Limit active points
    if (this.activePoints.length > 1000) {
      this.activePoints.shift();
    }
  }

  /**
   * Deposit along a path (line of pheromone)
   */
  depositPath(
    from: Vector2D,
    to: Vector2D,
    type: PheromoneType,
    amount?: number
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(distance / (this.cellSize / 2)));
    const direction = Math.atan2(dy, dx);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = {
        x: from.x + dx * t,
        y: from.y + dy * t,
      };
      this.deposit(pos, type, amount, direction);
    }
  }

  /**
   * Sense pheromone at a position
   */
  sense(position: Vector2D, type: PheromoneType): number {
    const { x, y } = this.toGridCoords(position);
    if (!this.isValidCell(x, y)) return 0;

    return this.grid[y][x][type];
  }

  /**
   * Sense pheromone with direction
   */
  senseWithDirection(
    position: Vector2D,
    type: PheromoneType
  ): { concentration: number; direction?: number } {
    const { x, y } = this.toGridCoords(position);
    if (!this.isValidCell(x, y)) {
      return { concentration: 0 };
    }

    return {
      concentration: this.grid[y][x][type],
      direction: this.directionGrid[y][x].get(type),
    };
  }

  /**
   * Find strongest pheromone direction from a position
   */
  findStrongestDirection(
    position: Vector2D,
    type: PheromoneType,
    senseRadius: number = 2
  ): { direction: number; strength: number } | null {
    const { x, y } = this.toGridCoords(position);

    let maxStrength: number = PHEROMONE.threshold;
    let bestDirection = 0;
    let found = false;

    // Check surrounding cells
    for (let dy = -senseRadius; dy <= senseRadius; dy++) {
      for (let dx = -senseRadius; dx <= senseRadius; dx++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (!this.isValidCell(nx, ny)) continue;

        const strength = this.grid[ny][nx][type];
        if (strength > maxStrength) {
          maxStrength = strength;
          bestDirection = Math.atan2(dy, dx);
          found = true;
        }
      }
    }

    return found ? { direction: bestDirection, strength: maxStrength } : null;
  }

  /**
   * Update pheromone map (evaporation)
   */
  update(deltaTime: number): void {
    const timeScale = deltaTime / 16; // Normalize to 60fps

    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const cell = this.grid[y][x];

        // Evaporate each pheromone type
        for (const type of Object.keys(cell) as PheromoneType[]) {
          const rate = PHEROMONE.evaporationRate[type] ?? 0.001;
          cell[type] = Math.max(0, cell[type] * (1 - rate * timeScale));

          // Clear direction if concentration is too low
          if (cell[type] < PHEROMONE.threshold) {
            this.directionGrid[y][x].delete(type);
          }
        }
      }
    }

    // Clean up old active points
    const now = Date.now();
    const maxAge = 30000; // 30 seconds
    this.activePoints = this.activePoints.filter(
      (p) => now - p.timestamp < maxAge && p.concentration > 0.01
    );

    // Decay active point concentrations
    for (const point of this.activePoints) {
      const rate = PHEROMONE.evaporationRate[point.type] ?? 0.001;
      point.concentration *= 1 - rate * timeScale * 2;
    }
  }

  /**
   * Clear all pheromones
   */
  clear(): void {
    this.grid = this.createGrid();
    this.directionGrid = this.createDirectionGrid();
    this.activePoints = [];
  }

  /**
   * Clear specific type
   */
  clearType(type: PheromoneType): void {
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        this.grid[y][x][type] = 0;
        this.directionGrid[y][x].delete(type);
      }
    }
    this.activePoints = this.activePoints.filter((p) => p.type !== type);
  }

  /**
   * Get active points for rendering
   */
  getActivePoints(): PheromonePoint[] {
    return this.activePoints;
  }

  /**
   * Get color for pheromone type
   */
  static getColor(type: PheromoneType): string {
    switch (type) {
      case 'trail':
        return colors.pheromone.trail;
      case 'alarm':
        return colors.pheromone.alarm;
      case 'queen':
        return colors.pheromone.queen;
      case 'recruitment':
        return colors.pheromone.recruitment;
      default:
        return colors.pheromone.trail;
    }
  }

  /**
   * Get heatmap data for visualization
   */
  getHeatmap(type: PheromoneType): { x: number; y: number; value: number }[] {
    const data: { x: number; y: number; value: number }[] = [];

    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const value = this.grid[y][x][type];
        if (value > PHEROMONE.threshold) {
          data.push({
            x: x * this.cellSize + this.cellSize / 2,
            y: y * this.cellSize + this.cellSize / 2,
            value,
          });
        }
      }
    }

    return data;
  }

  /**
   * Get total concentration of a type
   */
  getTotalConcentration(type: PheromoneType): number {
    let total = 0;
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        total += this.grid[y][x][type];
      }
    }
    return total;
  }
}
