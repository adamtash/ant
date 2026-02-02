/**
 * Queen Ant Entity
 * The reproductive center and decision-maker of the colony
 * Maps to the main agent in the system
 */

import { Ant, type AntConfig } from './Ant';
import type { Vector2D } from '../../utils/vector';
import { colors } from '../../utils/colors';

export interface QueenConfig extends Omit<AntConfig, 'caste'> {
  isActive?: boolean;
}

export interface QueenRenderData {
  id: string;
  position: Vector2D;
  pulsePhase: number;
  isActive: boolean;
  isLayingEggs: boolean;
  auraIntensity: number;
  attendantPositions: Vector2D[];
}

export class Queen extends Ant {
  // Queen-specific properties
  isActive: boolean;
  isThinking: boolean;
  isLayingEggs: boolean;
  pulsePhase: number;
  auraIntensity: number;
  lastEggTime: number;
  eggsLaid: number;

  // Attendant tracking
  attendantIds: string[];
  readonly maxAttendants: number = 4;

  constructor(config: QueenConfig) {
    super({
      ...config,
      caste: 'queen',
      state: 'laying_eggs',
    });

    this.isActive = config.isActive ?? false;
    this.isThinking = false;
    this.isLayingEggs = false;
    this.pulsePhase = 0;
    this.auraIntensity = 0.5;
    this.lastEggTime = 0;
    this.eggsLaid = 0;
    this.attendantIds = [];

    // Queen never moves
    this.velocity = { x: 0, y: 0 };
  }

  /**
   * Override base color
   */
  get color(): string {
    return colors.queen.amber;
  }

  /**
   * Queen's pheromone aura radius
   */
  get auraRadius(): number {
    return 100 + this.auraIntensity * 50;
  }

  /**
   * Update queen state
   */
  update(deltaTime: number, _bounds: { width: number; height: number }): void {
    // Queen doesn't die from age
    this.age += deltaTime;

    // Update pulse animation
    this.pulsePhase += deltaTime * 0.003;

    // Update aura intensity based on activity
    if (this.isActive) {
      this.auraIntensity = Math.min(1, this.auraIntensity + 0.01);
    } else {
      this.auraIntensity = Math.max(0.3, this.auraIntensity - 0.005);
    }

    // Update egg-laying animation
    if (this.isLayingEggs) {
      // Egg laying pulse
      if (Date.now() - this.lastEggTime > 2000) {
        this.lastEggTime = Date.now();
        this.eggsLaid++;
        this.isLayingEggs = false;
      }
    }

    // Update antenna animation
    this.antennaPhase += deltaTime * 0.05;
  }

  /**
   * Start laying an egg (spawning a worker)
   */
  layEgg(): void {
    this.isLayingEggs = true;
    this.lastEggTime = Date.now();
  }

  /**
   * Activate the queen (main agent processing)
   */
  activate(): void {
    this.isActive = true;
    this.auraIntensity = 0.8;
  }

  /**
   * Deactivate the queen (main agent idle)
   */
  deactivate(): void {
    this.isActive = false;
  }
  
  /**
   * Set thinking state (main agent processing)
   */
  setThinking(thinking: boolean): void {
    this.isThinking = thinking;
    if (thinking) {
      this.auraIntensity = 1.0;
      this.pulsePhase += 0.5; // Speed up pulse when thinking
    }
  }

  /**
   * Add an attendant ant
   */
  addAttendant(antId: string): boolean {
    if (this.attendantIds.length < this.maxAttendants) {
      this.attendantIds.push(antId);
      return true;
    }
    return false;
  }

  /**
   * Remove an attendant ant
   */
  removeAttendant(antId: string): void {
    this.attendantIds = this.attendantIds.filter((id) => id !== antId);
  }

  /**
   * Calculate attendant positions around the queen
   */
  getAttendantPositions(): Vector2D[] {
    const positions: Vector2D[] = [];
    const radius = 40;
    const count = this.attendantIds.length;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.pulsePhase * 0.1;
      positions.push({
        x: this.position.x + Math.cos(angle) * radius,
        y: this.position.y + Math.sin(angle) * radius,
      });
    }

    return positions;
  }

  /**
   * Get queen-specific render data
   */
  getQueenRenderData(): QueenRenderData {
    return {
      id: this.id,
      position: { ...this.position },
      pulsePhase: this.pulsePhase,
      isActive: this.isActive,
      isLayingEggs: this.isLayingEggs,
      auraIntensity: this.auraIntensity,
      attendantPositions: this.getAttendantPositions(),
    };
  }

  /**
   * Queen doesn't move - override
   */
  protected move(): void {
    // Queen stays in place
    this.velocity = { x: 0, y: 0 };
  }
}
