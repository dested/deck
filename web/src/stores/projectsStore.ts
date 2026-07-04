import { create } from "zustand";
import type { ProjectSummary } from "@deck/shared";

interface ProjectsState {
  byId: Record<string, ProjectSummary>;
  loaded: boolean;
  setAll: (projects: ProjectSummary[]) => void;
  upsert: (p: ProjectSummary) => void;
  remove: (id: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  byId: {},
  loaded: false,
  setAll: (projects) =>
    set(() => ({
      byId: Object.fromEntries(projects.map((p) => [p.id, p])),
      loaded: true,
    })),
  upsert: (p) => set((s) => ({ byId: { ...s.byId, [p.id]: p } })),
  remove: (id) =>
    set((s) => {
      const next = { ...s.byId };
      delete next[id];
      return { byId: next };
    }),
}));

// Sorted view: pinned first, then by filesystem activity, then name as a stable
// tie-break. Deliberately does NOT reorder on interaction — clicking a project
// must not make the list jump under the cursor. Hidden excluded unless asked.
export function selectSortedProjects(
  byId: Record<string, ProjectSummary>,
  opts: {
    includeHidden?: boolean;
    query?: string;
  } = {},
): ProjectSummary[] {
  const q = opts.query?.trim().toLowerCase();
  let list = Object.values(byId);
  if (!opts.includeHidden) list = list.filter((p) => !p.hidden);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.activityAt !== b.activityAt) return b.activityAt - a.activityAt;
    return a.name.localeCompare(b.name);
  });
}
