import { create } from "zustand";
import type { Session } from "@deck/shared";

interface SessionsState {
  byId: Record<string, Session>;
  loaded: boolean;
  setAll: (sessions: Session[]) => void;
  upsert: (s: Session) => void;
  remove: (id: string) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  byId: {},
  loaded: false,
  setAll: (sessions) =>
    set(() => ({
      byId: Object.fromEntries(sessions.map((s) => [s.id, s])),
      loaded: true,
    })),
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

// Live sessions = anything not stale/exited (sidebar counts + overview set).
export function isLive(s: Session): boolean {
  return s.status !== "stale" && s.status !== "exited";
}

// Per-project live-session stats for the sidebar: how many agents are running
// and whether any need attention.
export interface ProjectSessionStats {
  running: number; // working + attention (live and doing/needing something)
  attention: boolean;
}

export function selectProjectStats(
  byId: Record<string, Session>,
): Map<string, ProjectSessionStats> {
  const map = new Map<string, ProjectSessionStats>();
  for (const s of Object.values(byId)) {
    if (s.status !== "working" && s.status !== "attention") continue;
    const cur = map.get(s.projectId) ?? { running: 0, attention: false };
    cur.running += 1;
    if (s.status === "attention") cur.attention = true;
    map.set(s.projectId, cur);
  }
  return map;
}
