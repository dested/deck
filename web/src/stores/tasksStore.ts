import { useEffect } from "react";
import { create } from "zustand";
import type { TaskCard } from "@deck/shared";
import { api } from "../lib/api";

// M17 task-board cards, keyed by id. Bootstrapped from GET /tasks and updated
// by ws.ts on `tasks.updated` (replace-by-id).
interface TasksState {
  byId: Record<string, TaskCard>;
  loaded: boolean;
  setAll: (items: TaskCard[]) => void;
  upsert: (t: TaskCard) => void;
  remove: (id: string) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  byId: {},
  loaded: false,
  setAll: (items) =>
    set({ byId: Object.fromEntries(items.map((t) => [t.id, t])), loaded: true }),
  upsert: (t) => set((st) => ({ byId: { ...st.byId, [t.id]: t } })),
  remove: (id) =>
    set((st) => {
      const next = { ...st.byId };
      delete next[id];
      return { byId: next };
    }),
}));

export function useTasksBootstrap() {
  const setAll = useTasksStore((s) => s.setAll);
  useEffect(() => {
    api.tasks().then(setAll).catch(() => {});
  }, [setAll]);
}
