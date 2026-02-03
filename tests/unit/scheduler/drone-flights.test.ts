import { describe, it, expect } from "vitest";

import {
  FLIGHT_LIGHT_CHECK,
  FLIGHT_HOURLY_MAINTENANCE,
  FLIGHT_WEEKLY_REVIEW,
  getDroneFlightPrompt,
  getAllDroneFlights,
  getEnabledDroneFlights,
  droneFlightToScheduledJob,
  getDroneFlightSessionKey,
  isDroneFlightSession,
  getFlightIdFromSession,
} from "../../../src/scheduler/drone-flights.js";

describe("drone-flights", () => {
  it("getDroneFlightPrompt() returns prompts for known flight types", () => {
    expect(getDroneFlightPrompt("light-check")).toContain("light health check");
    expect(getDroneFlightPrompt("hourly-maintenance")).toContain("hourly deep maintenance");
    expect(getDroneFlightPrompt("weekly-review")).toContain("weekly comprehensive review");
  });

  it("getDroneFlightPrompt() throws for unknown flight types", () => {
    expect(() => getDroneFlightPrompt("unknown" as any)).toThrow("Unknown flight type");
  });

  it("getAllDroneFlights() and getEnabledDroneFlights() include predefined flights", () => {
    const all = getAllDroneFlights();
    expect(all.map((f) => f.id)).toEqual([
      FLIGHT_LIGHT_CHECK.id,
      FLIGHT_HOURLY_MAINTENANCE.id,
      FLIGHT_WEEKLY_REVIEW.id,
    ]);

    const enabled = getEnabledDroneFlights();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((f) => f.enabled)).toBe(true);
  });

  it("droneFlightToScheduledJob() maps definition to scheduled job shape", () => {
    const job = droneFlightToScheduledJob(FLIGHT_LIGHT_CHECK);
    expect(job.id).toBe(FLIGHT_LIGHT_CHECK.id);
    expect(job.schedule).toBe(FLIGHT_LIGHT_CHECK.schedule);
    expect(job.trigger.type).toBe("agent_ask");
    expect(job.actions[0]).toEqual(
      expect.objectContaining({ type: "log_event", level: "info" })
    );
  });

  it("session key helpers behave consistently", () => {
    const sessionKey = getDroneFlightSessionKey(FLIGHT_LIGHT_CHECK);
    expect(isDroneFlightSession(sessionKey)).toBe(true);
    expect(getFlightIdFromSession(sessionKey)).toBe(FLIGHT_LIGHT_CHECK.id);
    expect(getFlightIdFromSession("cli:test")).toBeNull();
  });
});

