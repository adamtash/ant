/**
 * Spatial Grid
 * Efficient spatial partitioning for ant proximity queries
 */

import type { Vector2D } from '../../utils/vector';

interface SpatialEntity {
  id: string;
  position: Vector2D;
}

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number;
  private cells: Map<string, T[]>;
  private entityCells: Map<string, string>;

  constructor(cellSize: number = 50) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityCells = new Map();
  }

  /**
   * Get cell key for a position
   */
  private getCellKey(position: Vector2D): string {
    const cellX = Math.floor(position.x / this.cellSize);
    const cellY = Math.floor(position.y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  /**
   * Insert or update entity in grid
   */
  insert(entity: T): void {
    const newCellKey = this.getCellKey(entity.position);
    const oldCellKey = this.entityCells.get(entity.id);

    // If entity moved to a new cell
    if (oldCellKey !== newCellKey) {
      // Remove from old cell
      if (oldCellKey) {
        const oldCell = this.cells.get(oldCellKey);
        if (oldCell) {
          const index = oldCell.findIndex((e) => e.id === entity.id);
          if (index !== -1) {
            oldCell.splice(index, 1);
          }
          if (oldCell.length === 0) {
            this.cells.delete(oldCellKey);
          }
        }
      }

      // Add to new cell
      let newCell = this.cells.get(newCellKey);
      if (!newCell) {
        newCell = [];
        this.cells.set(newCellKey, newCell);
      }
      newCell.push(entity);
      this.entityCells.set(entity.id, newCellKey);
    }
  }

  /**
   * Remove entity from grid
   */
  remove(entityId: string): void {
    const cellKey = this.entityCells.get(entityId);
    if (cellKey) {
      const cell = this.cells.get(cellKey);
      if (cell) {
        const index = cell.findIndex((e) => e.id === entityId);
        if (index !== -1) {
          cell.splice(index, 1);
        }
        if (cell.length === 0) {
          this.cells.delete(cellKey);
        }
      }
      this.entityCells.delete(entityId);
    }
  }

  /**
   * Query entities within radius of a position
   */
  queryRadius(position: Vector2D, radius: number): T[] {
    const results: T[] = [];
    const radiusSquared = radius * radius;

    // Calculate cell range to check
    const minCellX = Math.floor((position.x - radius) / this.cellSize);
    const maxCellX = Math.floor((position.x + radius) / this.cellSize);
    const minCellY = Math.floor((position.y - radius) / this.cellSize);
    const maxCellY = Math.floor((position.y + radius) / this.cellSize);

    // Check all cells in range
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const cellKey = `${cellX},${cellY}`;
        const cell = this.cells.get(cellKey);
        if (cell) {
          for (const entity of cell) {
            const dx = entity.position.x - position.x;
            const dy = entity.position.y - position.y;
            const distSquared = dx * dx + dy * dy;
            if (distSquared <= radiusSquared) {
              results.push(entity);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Query entities in a rectangular area
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const results: T[] = [];

    const minCellX = Math.floor(minX / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize);
    const maxCellY = Math.floor(maxY / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const cellKey = `${cellX},${cellY}`;
        const cell = this.cells.get(cellKey);
        if (cell) {
          for (const entity of cell) {
            if (
              entity.position.x >= minX &&
              entity.position.x <= maxX &&
              entity.position.y >= minY &&
              entity.position.y <= maxY
            ) {
              results.push(entity);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Get nearest entity to a position
   */
  findNearest(position: Vector2D, maxRadius: number = Infinity): T | null {
    let nearest: T | null = null;
    let nearestDistSquared = maxRadius * maxRadius;

    // Start with immediate cell and expand outward
    const cellX = Math.floor(position.x / this.cellSize);
    const cellY = Math.floor(position.y / this.cellSize);
    const maxCellRadius = Math.ceil(maxRadius / this.cellSize);

    for (let r = 0; r <= maxCellRadius && nearest === null; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // Only check border cells

          const cellKey = `${cellX + dx},${cellY + dy}`;
          const cell = this.cells.get(cellKey);
          if (cell) {
            for (const entity of cell) {
              const ex = entity.position.x - position.x;
              const ey = entity.position.y - position.y;
              const distSquared = ex * ex + ey * ey;
              if (distSquared < nearestDistSquared) {
                nearestDistSquared = distSquared;
                nearest = entity;
              }
            }
          }
        }
      }
    }

    return nearest;
  }

  /**
   * Clear all entities from grid
   */
  clear(): void {
    this.cells.clear();
    this.entityCells.clear();
  }

  /**
   * Get total entity count
   */
  get size(): number {
    return this.entityCells.size;
  }

  /**
   * Get all entities (for iteration)
   */
  getAllEntities(): T[] {
    const all: T[] = [];
    for (const cell of this.cells.values()) {
      all.push(...cell);
    }
    return all;
  }
}
