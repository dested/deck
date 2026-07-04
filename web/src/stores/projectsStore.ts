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

// Sorted view: pinned first, then by when YOU last opened it in Deck (recency of
// your own interaction — filesystem activity alone put untouched repos on top),
// falling back to filesystem activity for never-opened projects. Hidden excluded
// unless asked.
export function selectSortedProjects(
  byId: Record<string, ProjectSummary>,
  opts: {
    includeHidden?: boolean;
    query?: string;
    lastOpenedAt?: Record<string, number>;
  } = {},
): ProjectSummary[] {
  const q = opts.query?.trim().toLowerCase();
  const lo = opts.lastOpenedAt ?? {};
  let list = Object.values(byId);
  if (!opts.includeHidden) list = list.filter((p) => !p.hidden);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const la = lo[a.id] ?? 0;
    const lb = lo[b.id] ?? 0;
    if (la !== lb) return lb - la;
    return b.activityAt - a.activityAt;
  });
}
