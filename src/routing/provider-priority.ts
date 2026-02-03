export type ProviderPriorityGroup = "configured" | "local" | "discovered";

export type ProviderPriorityCandidate = {
  id: string;
  group: ProviderPriorityGroup;
  coolingDown: boolean;
  failures: number;
};

function groupRank(group: ProviderPriorityGroup): number {
  switch (group) {
    case "configured":
      return 0;
    case "local":
      return 1;
    case "discovered":
      return 2;
  }
}

export function prioritizeProviderCandidates(
  candidates: ProviderPriorityCandidate[]
): string[] {
  const rows = candidates.slice();
  rows.sort((a, b) => {
    const groupDiff = groupRank(a.group) - groupRank(b.group);
    if (groupDiff !== 0) return groupDiff;
    if (a.coolingDown !== b.coolingDown) return a.coolingDown ? 1 : -1;
    if (a.failures !== b.failures) return a.failures - b.failures;
    return a.id.localeCompare(b.id);
  });
  return rows.map((r) => r.id);
}

