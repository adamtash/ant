/**
 * Drone Flights Initializer - Sets up scheduled maintenance tasks
 *
 * This module registers all drone flights with the scheduler on startup.
 */

import { getAllDroneFlights, droneFlightToScheduledJob } from "./drone-flights.js";
import type { Scheduler } from "./scheduler.js";
import type { Logger } from "../log.js";

export async function initializeDroneFlights(
  scheduler: Scheduler,
  logger: Logger,
  options: { emitEvents?: boolean } = {}
): Promise<number> {
  const log = logger.child({ component: "drone-flights-init" });
  const enabledFlights = getAllDroneFlights();
  const shouldEmitEvents = options.emitEvents ?? false;
  let registered = 0;

  for (const flight of enabledFlights) {
    try {
      const job = droneFlightToScheduledJob(flight);
      const existing = scheduler.getJob(job.id);
      if (existing) {
        if (shouldEmitEvents) {
          await scheduler.updateJob(job.id, {
            ...job,
            enabled: flight.enabled,
          });
        } else {
          await scheduler.syncJob(job.id, {
            ...job,
            enabled: flight.enabled,
          });
        }
      } else if (shouldEmitEvents) {
        await scheduler.addJob({
          ...job,
          enabled: flight.enabled,
        });
      } else {
        await scheduler.addJob({
          ...job,
          enabled: flight.enabled,
          emitEvent: false,
        });
      }

      log.info(
        { flightId: flight.id, schedule: flight.schedule },
        `Drone Flight scheduled: ${flight.name}`
      );
      registered++;
    } catch (err) {
      log.warn(
        {
          flightId: flight.id,
          error: err instanceof Error ? err.message : String(err),
        },
        `Failed to register Drone Flight: ${flight.name}`
      );
    }
  }

  log.info({ count: registered }, "Drone Flights initialized");
  return registered;
}
