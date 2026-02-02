/**
 * Drone Flights - Scheduled Maintenance Tasks (Cron Jobs)
 *
 * Defines self-maintenance tasks that the ant platform runs on a schedule.
 * Each "drone flight" is a scheduled maintenance task that performs system health checks,
 * log analysis, error fixing, and continuous improvements.
 *
 * Available Flight Types:
 * - Light Check: Every 5 minutes (quick health check)
 * - Hourly Deep Maintenance: Every hour (detailed analysis & fixes)
 * - Weekly Deep Dive: Every Monday 00:00 (comprehensive review)
 */

import type { ScheduledJob, AgentAskTrigger, LogEventAction } from "./types.js";

// ============================================================================
// Drone Flight Types
// ============================================================================

export type DroneFlightType = "light-check" | "hourly-maintenance" | "weekly-review";

export interface DroneFlightDefinition {
  id: string;
  name: string;
  description: string;
  flightType: DroneFlightType;
  schedule: string; // Cron expression
  enabled: boolean;
  timeout?: number; // milliseconds
  maxRetries?: number;
}

// ============================================================================
// Predefined Drone Flights
// ============================================================================

/**
 * Light Check Flight - Quick health check every 5 minutes
 *
 * Quick system scan:
 * - Monitor error rate
 * - Check subagent health
 * - Verify provider connectivity
 * - Alert if critical issues found
 */
export const FLIGHT_LIGHT_CHECK: DroneFlightDefinition = {
  id: "flight:light-check",
  name: "Light Check",
  description: "Quick health check - monitor errors and subagents",
  flightType: "light-check",
  schedule: "*/5 * * * *", // Every 5 minutes
  enabled: true,
  timeout: 1200000, // 20 minutes
  maxRetries: 1,
};

/**
 * Hourly Deep Maintenance Flight - Detailed analysis every hour
 *
 * Comprehensive system maintenance:
 * 1. Log Analysis (read last 1000 lines, count errors by type)
 * 2. Issue Detection (search for patterns, match against KNOWN_ISSUES.md)
 * 3. Auto-Fix Application (parse errors, fix code, rebuild, verify)
 * 4. Learning System Update (add new issues to KNOWN_ISSUES.md)
 */
export const FLIGHT_HOURLY_MAINTENANCE: DroneFlightDefinition = {
  id: "flight:hourly-maintenance",
  name: "Hourly Deep Maintenance",
  description: "Detailed analysis, error detection, and auto-fixes",
  flightType: "hourly-maintenance",
  schedule: "0 * * * *", // Every hour at :00
  enabled: true,
  timeout: 600000, // 10 minutes
  maxRetries: 2,
};

/**
 * Weekly Deep Dive Flight - Comprehensive review every Monday 00:00
 *
 * Full system archaeology and optimization:
 * 1. Log Archaeology (analyze week's logs, plot error trends)
 * 2. Performance Analysis (context window, token efficiency, response times)
 * 3. Learning Review (review improvements, measure impact)
 * 4. Proactive Fixes (fix common issues before user hits them)
 * 5. Report Generation (weekly summary to AGENT_LOG.md)
 */
export const FLIGHT_WEEKLY_REVIEW: DroneFlightDefinition = {
  id: "flight:weekly-review",
  name: "Weekly Deep Dive",
  description: "Comprehensive system review and optimization",
  flightType: "weekly-review",
  schedule: "0 0 * * 1", // Every Monday at 00:00
  enabled: true,
  timeout: 3600000, // 60 minutes
  maxRetries: 1,
};

// ============================================================================
// Flight Prompts
// ============================================================================

/**
 * Get the prompt for executing a drone flight
 */
export function getDroneFlightPrompt(flightType: DroneFlightType): string {
  switch (flightType) {
    case "light-check":
      return `Execute a light health check:

1. Analyze the last 100 lines of ~/.ant/ant.log
2. Count ERROR, WARN, and critical error events
3. Check if any subagents are running
4. Verify we can reach at least one provider
5. If error rate > 5 errors per hour in the last hour, alert owner

Format your response as:
- Error count: X
- Warning count: Y
- Subagents active: X
- Providers reachable: X/X
- Status: HEALTHY | WARNING | CRITICAL
- Recommendation: [action if needed]`;

    case "hourly-maintenance":
      return `Execute hourly deep maintenance:

1. Read and analyze the last 500 lines of ~/.ant/ant.log
2. Identify error patterns (repeated 3+ times)
3. For each pattern found:
   - Search KNOWN_ISSUES.md for a match
   - If found, apply the documented fix
   - If new, note as investigation item
4. Update KNOWN_ISSUES.md with any new patterns
5. List all fixes applied and issues investigated

Format response as:
## Hourly Maintenance Report
- Files Analyzed: ~/.ant/ant.log
- Errors Found: X patterns
- Fixes Applied: X
- New Issues: X
- Status: <success|partial|failed>
- Details:
  * [Pattern]: [Fix Applied] ✅
  * [New Pattern]: [Under investigation] 🔍`;

    case "weekly-review":
      return `Execute weekly comprehensive review:

1. Analyze entire week's logs (or last 5000 lines)
2. Plot error trends (increasing/stable/decreasing)
3. Identify top 3 most common error types
4. Read AGENT_LOG.md to see what improvements were implemented
5. Measure the impact of improvements
6. Review system performance metrics
7. Generate recommendations for next week

Write a comprehensive report to AGENT_LOG.md with:
- Weekly Summary (errors, fixes, improvements)
- Trends (what's getting better/worse)
- Impact Analysis (which improvements helped most)
- Next Week Priorities
- Performance metrics

Use format:
## Weekly Review - [Week of DATE]
- Total Errors: X
- Error Trends: [graph]
- Top Issues: [list]
- Improvements Applied: [count]
- Impact Score: X/10
- Next Week Focus: [priorities]`;

    default:
      throw new Error(`Unknown flight type: ${flightType}`);
  }
}

// ============================================================================
// Flight Registration
// ============================================================================

/**
 * Get all available drone flights
 */
export function getAllDroneFlights(): DroneFlightDefinition[] {
  return [FLIGHT_LIGHT_CHECK, FLIGHT_HOURLY_MAINTENANCE, FLIGHT_WEEKLY_REVIEW];
}

/**
 * Get enabled drone flights
 */
export function getEnabledDroneFlights(): DroneFlightDefinition[] {
  return getAllDroneFlights().filter((flight) => flight.enabled);
}

/**
 * Convert drone flight definition to a scheduled job
 */
export function droneFlightToScheduledJob(
  flight: DroneFlightDefinition
): Omit<ScheduledJob, "createdAt" | "updatedAt" | "lastRun" | "lastResult"> {
  const trigger: AgentAskTrigger = {
    type: "agent_ask",
    prompt: getDroneFlightPrompt(flight.flightType),
  };

  const actions: LogEventAction[] = [
    {
      type: "log_event",
      level: "info",
      prefix: `🚁 Drone Flight [${flight.name}]`,
    },
  ];

  return {
    id: flight.id,
    name: flight.name,
    enabled: flight.enabled,
    schedule: flight.schedule,
    trigger,
    actions,
    retryOnFailure: true,
    maxRetries: flight.maxRetries ?? 2,
    timeout: flight.timeout ?? 300000,
  };
}

/**
 * Create a session key for a drone flight
 */
export function getDroneFlightSessionKey(flight: DroneFlightDefinition): string {
  return `drone-flight:${flight.id}`;
}

/**
 * Check if a session belongs to a drone flight
 */
export function isDroneFlightSession(sessionKey: string): boolean {
  return sessionKey.startsWith("drone-flight:");
}

/**
 * Get flight ID from session key
 */
export function getFlightIdFromSession(sessionKey: string): string | null {
  if (!isDroneFlightSession(sessionKey)) return null;
  return sessionKey.replace("drone-flight:", "");
}
