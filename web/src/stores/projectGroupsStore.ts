import { create } from "zustand";
import type { Group } from "@deck/shared";

// Ordered list of sidebar project groups. The server broadcasts the whole list
// on any mutation (project-groups.updated), so we just replace it wholesale.
interface ProjectGroupsState {
  groups: Group[];
  setAll: (groups: Group[]) => void;
}

export const useProjectGroupsStore = create<ProjectGroupsState>((set) => ({
  groups: [],
  setAll: (groups) => set({ groups }),
}));
