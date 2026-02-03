import blessed from "blessed";

export interface TuiOptions {
  baseUrl: string;
  refreshMs?: number;
  onExit?: () => void;
}

type StatusResponse = {
  ok: true;
  time: number;
  running?: Array<{ status: string }>;
  subagents?: Array<{ label?: string; task: string; status: string }>;
  mainAgent?: { enabled: boolean; running: boolean };
  health?: {
    uptime: number;
    queueDepth: number;
    activeConnections: number;
  };
};

type JobResponse = {
  ok: true;
  jobs: Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    lastRunAt?: number;
    nextRunAt: number;
    executionHistory: Array<{
      runAt: number;
      duration: number;
      status: "success" | "error" | "cancelled";
      error?: string;
    }>;
  }>;
};

const DEFAULT_REFRESH_MS = 2000;

export async function startTui(options: TuiOptions): Promise<() => void> {
  const screen = blessed.screen({
    smartCSR: true,
    title: "ANT TUI",
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    style: { fg: "white", bg: "blue" },
  });

  const statusBox = blessed.box({
    top: 3,
    left: 0,
    width: "60%",
    height: "50%",
    label: " Status ",
    border: "line",
    tags: false,
  });

  const subagentsBox = blessed.box({
    top: "53%",
    left: 0,
    width: "60%",
    height: "47%",
    label: " Subagents ",
    border: "line",
    tags: false,
  });

  const flightsBox = blessed.box({
    top: 3,
    left: "60%",
    width: "40%",
    height: "97%",
    label: " Drone Flights ",
    border: "line",
    tags: false,
  });

  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { fg: "gray" },
  });

  const helpBox = blessed.box({
    top: "center",
    left: "center",
    width: "50%",
    height: "50%",
    label: " Help ",
    border: "line",
    hidden: true,
    content: [
      "Keys:",
      "  q / Ctrl+C  Quit",
      "  p           Pause refresh",
      "  ?           Toggle help",
    ].join("\n"),
  });

  screen.append(header);
  screen.append(statusBox);
  screen.append(subagentsBox);
  screen.append(flightsBox);
  screen.append(footer);
  screen.append(helpBox);

  let paused = false;
  let connected = false;
  let lastError: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  const setHeader = () => {
    const status = connected ? "connected" : "disconnected";
    const pauseLabel = paused ? "paused" : "live";
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    const error = lastError ? ` | ${lastError}` : "";
    header.setContent(` ANT TUI | ${status} | ${pauseLabel} | ${time}${error}`);
  };

  const updateFooter = () => {
    footer.setContent(" q: quit  p: pause  ?: help ");
  };

  const renderStatus = (status: StatusResponse | null) => {
    if (!status) {
      statusBox.setContent("No status available.");
      return;
    }

    const mainAgent = status.mainAgent?.enabled
      ? status.mainAgent.running
        ? "running"
        : "idle"
      : "disabled";

    const lines = [
      `Uptime: ${formatDuration(status.health?.uptime ?? 0)}`,
      `Queue depth: ${status.health?.queueDepth ?? 0}`,
      `Active connections: ${status.health?.activeConnections ?? 0}`,
      `Running tasks: ${status.running?.length ?? 0}`,
      `Subagents: ${status.subagents?.length ?? 0}`,
      `Main agent: ${mainAgent}`,
    ];

    statusBox.setContent(lines.join("\n"));
  };

  const renderSubagents = (status: StatusResponse | null) => {
    const subagents = status?.subagents ?? [];
    if (subagents.length === 0) {
      subagentsBox.setContent("No active subagents.");
      return;
    }

    const lines = subagents.slice(0, 12).map((subagent) => {
      const label = subagent.label?.trim() || subagent.task.slice(0, 40);
      return `• ${label} (${subagent.status})`;
    });

    if (subagents.length > 12) {
      lines.push(`...and ${subagents.length - 12} more`);
    }

    subagentsBox.setContent(lines.join("\n"));
  };

  const renderFlights = (jobs: JobResponse | null) => {
    const flights = (jobs?.jobs ?? []).filter((job) => job.id.startsWith("flight:"));
    if (flights.length === 0) {
      flightsBox.setContent("No drone flights scheduled.");
      return;
    }

    const enabledCount = flights.filter((flight) => flight.enabled).length;
    const lines = [`Total: ${flights.length} | Enabled: ${enabledCount}`, ""];

    for (const flight of flights) {
      const lastExec = flight.executionHistory[flight.executionHistory.length - 1];
      const lastStatus = lastExec ? lastExec.status : "never";
      const nextRun = formatRelative(flight.nextRunAt);
      const lastRun = formatRelative(flight.lastRunAt);
      const enabled = flight.enabled ? "on" : "off";

      lines.push(`• ${flight.name} [${enabled}]`);
      lines.push(`  next: ${nextRun} | last: ${lastRun} (${lastStatus})`);
    }

    flightsBox.setContent(lines.join("\n"));
  };

  const refresh = async () => {
    if (paused) return;

    try {
      const [status, jobs] = await Promise.all([
        fetchJson<StatusResponse>(`${options.baseUrl}/api/status`),
        fetchJson<JobResponse>(`${options.baseUrl}/api/jobs`),
      ]);
      connected = Boolean(status.ok);
      lastError = null;
      renderStatus(status);
      renderSubagents(status);
      renderFlights(jobs);
    } catch (err) {
      connected = false;
      lastError = err instanceof Error ? err.message : "fetch failed";
      renderStatus(null);
      renderSubagents(null);
      renderFlights(null);
    }

    setHeader();
    updateFooter();
    screen.render();
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    screen.destroy();
  };

  screen.key(["q", "C-c"], () => {
    stop();
    options.onExit?.();
  });

  screen.key(["p"], () => {
    paused = !paused;
    refresh().catch(() => {});
  });

  screen.key(["?"], () => {
    helpBox.hidden = !helpBox.hidden;
    screen.render();
  });

  screen.on("resize", () => {
    screen.render();
  });

  await refresh();
  timer = setInterval(refresh, options.refreshMs ?? DEFAULT_REFRESH_MS);

  return stop;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return "0s";
  if (abs < 60_000) return `${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h`;
  return `${Math.round(abs / 86_400_000)}d`;
}

function formatRelative(timestamp?: number): string {
  if (!timestamp) return "never";
  const diff = timestamp - Date.now();
  const label = formatDuration(diff);
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}
