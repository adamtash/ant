import type { Channel, CronContext } from "../agent/types.js";

export type RoutingTierName =
  | "fast"
  | "quality"
  | "background"
  | "backgroundImportant"
  | "maintenance";

export interface ResolveTierParams {
  query: string;
  channel: Channel;
  isSubagent?: boolean;
  cronContext?: CronContext;
}

const QUALITY_HINT_RE =
  /(?:\bdebug\b|\bdiagnose\b|\binvestigate\b|\broot cause\b|\brefactor\b|\bimplement\b|\barchitecture\b|\bdesign\b|\boptimi[sz]e\b|\btest\b|\bbenchmark\b|\bperformance\b|\bsecurity\b|\bfix\b)/i;

const MAINTENANCE_HINT_RE =
  /(?:\bhealth check\b|\bstartup health\b|\bmaintenance\b|\bself[- ]heal(?:ing)?\b|\bincident\b|\bpostmortem\b|\bprovider\b|\bfailover\b|\bcircuit breaker\b|\berror\b)/i;

export function resolveTierForIntent(params: ResolveTierParams): RoutingTierName {
  const text = params.query?.trim() ?? "";

  if (params.cronContext) return "background";

  if (params.isSubagent) {
    if (text && MAINTENANCE_HINT_RE.test(text)) return "maintenance";
    return "backgroundImportant";
  }

  if (text && MAINTENANCE_HINT_RE.test(text)) return "quality";

  if (text.length <= 160 && !QUALITY_HINT_RE.test(text)) return "fast";

  if (QUALITY_HINT_RE.test(text)) return "quality";

  if (params.channel === "whatsapp") return "fast";

  return "quality";
}

