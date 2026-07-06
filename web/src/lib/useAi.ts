import { useQuery } from "@tanstack/react-query";
import type { AiConfigView, AiUsageReport } from "@deck/shared";
import { api } from "./api";

// 30s stale, like useCost — the admin surface doesn't need to be realtime.
export function useAiConfig(enabled = true) {
  return useQuery<AiConfigView>({
    queryKey: ["ai", "config"],
    queryFn: () => api.aiConfig(),
    enabled,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}

export function useAiUsage(days = 30, enabled = true) {
  return useQuery<AiUsageReport>({
    queryKey: ["ai", "usage", days],
    queryFn: () => api.aiUsage(days),
    enabled,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}
