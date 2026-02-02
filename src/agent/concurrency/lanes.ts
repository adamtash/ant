export enum TaskLane {
  Main = "main",
  Autonomous = "autonomous",
  Maintenance = "maintenance",
}

export interface LaneConfig {
  maxConcurrent: number;
}
