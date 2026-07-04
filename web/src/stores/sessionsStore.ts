import { create } from "zustand";
import type { Session, Group } from "@deck/shared";

interface SessionsState {
  byId: Record<string, Session>;
  groups: Group[];
  loaded: boolean;
  setAll: (sessions: Session[]) => void;
  setGroups: (groups: Group[]) => void;
  addGroup: (g: Group) => void;
  updateGroupName: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  upsert: (s: Session) => void;
  remove: (id: string) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  byId: {},
  groups: [],
  loaded: false,
  setAll: (sessions) =>
    set(() => ({
      byId: Object.fromEntries(sessions.map((s) => [s.id, s])),
      loaded: true,
    })),
  setGroups: (groups) => set(() => ({ groups })),
  addGroup: (g) =>
    set((st) => (st.groups.some((x) => x.id === g.id) ? st : { groups: [...st.groups, g] })),
  updateGroupName: (id, name) =>
    set((st) => ({
      groups: st.groups.map((g) => (g.id === id ? { ...g, name } : g)),
    })),
  removeGroup: (id) =>
    set((st) => ({ groups: st.groups.filter((g) => g.id !== id) })),
  upsert: (s) => set((st) => ({ byId: { ...st.byId, [s.id]: s } })),
  remove: (id) =>
    set((st) => {
      const next = { ...st.byId };
      delete next[id];
      return { byId: next };
    }),
}));

const STATUS_RANK: Record<Session["status"], number> = {
  attention: 0,
  working: 1,
  idle: 2,
  stale: 3,
  exited: 4,
};

export function selectSessions(byId: Record<string, Session>): Session[] {
  return Object.values(byId).sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r !== 0) return r;
    return b.activityAt - a.activityAt;
  });
}

// Live sessions = anything not stale/exited (sidebar + overview headline set).
export function isLive(s: Session): boolean {
  return s.status !== "stale" && s.status !== "exited";
}
