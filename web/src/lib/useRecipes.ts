import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Recipe } from "@deck/shared";
import { api } from "./api";

export function useRecipes() {
  return useQuery<Recipe[]>({
    queryKey: ["recipes"],
    queryFn: () => api.recipes(),
    staleTime: 10_000,
  });
}

export function useInvalidateRecipes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["recipes"] });
}
