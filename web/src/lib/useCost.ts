import { useQuery } from "@tanstack/react-query";
import type { CostReport, ProjectCost, SessionCost } from "@deck/shared";
import { api } from "./api";

// One shared query drives the whole cost surface (dashboard + sidebar/agent
// chips). React Query dedupes to a single request and refetches every 60s; the
// server already serves from a 60s background cache, so this is cheap.
export function useCostReport(enabled = true) {
  return useQuery<CostReport>({
    queryKey: ["cost"],
    queryFn: () => api.cost(),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useProjectCost(projectId: string): ProjectCost | undefined {
  const { data } = useCostReport();
  return data?.projects.find((p) => p.projectId === projectId);
}

export function useSessionCost(sessionId: string | null): SessionCost | undefined {
  const { data } = useCostReport();
  if (!sessionId) return undefined;
  return data?.sessions[sessionId];
}
