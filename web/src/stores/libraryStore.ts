import { create } from "zustand";
import type { ProjectInspection, LivePortMap } from "@deck/shared";

// Library-card enrichment: inspections (batch REST, refreshed lazily), live
// dev-server ports and screenshot mtimes (both pushed over /ws/events).
interface LibraryState {
  inspections: Record<string, ProjectInspection>;
  inspectionsLoaded: boolean;
  livePorts: LivePortMap;
  // projectId -> shot mtime; used to cache-bust the <img> URL.
  shots: Record<string, number>;

  setInspections: (m: Record<string, ProjectInspection>) => void;
  setInspection: (i: ProjectInspection) => void;
  setLivePorts: (m: LivePortMap) => void;
  setShots: (m: Record<string, number>) => void;
  bumpShot: (projectId: string, at: number) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  inspections: {},
  inspectionsLoaded: false,
  livePorts: {},
  shots: {},

  setInspections: (m) => set({ inspections: m, inspectionsLoaded: true }),
  setInspection: (i) =>
    set((s) => ({
      inspections: { ...s.inspections, [i.projectId]: i },
    })),
  setLivePorts: (m) => set({ livePorts: m }),
  setShots: (m) => set({ shots: m }),
  bumpShot: (projectId, at) =>
    set((s) => ({ shots: { ...s.shots, [projectId]: at } })),
}));
