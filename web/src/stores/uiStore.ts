import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSessionsStore } from "./sessionsStore";

// A project's functional views live in the SAME per-project tab strip as the
// agent/terminal sessions you open. Views are permanent (non-closable); session
// tabs are opened and closed freely.
export type ProjectViewKind =
  | "agents"
  | "notes"
  | "preview"
  | "stack"
  | "git"
  | "files";

// Full-window takeover views (not tied to a project). Transient — cleared by any
// navigation to a project / home / session.
export type TopView = "costs" | "ai" | "digest" | "board" | "system";

export type ProjectTab =
  | { id: string; kind: "view"; view: ProjectViewKind }
  | { id: string; kind: "session"; sessionId: string };

interface ProjectTabState {
  tabs: ProjectTab[];
  activeTabId: string;
}

const DEFAULT_VIEWS: ProjectViewKind[] = [
  "agents",
  "notes",
  "preview",
  "stack",
  "git",
  "files",
];
// M10: the root pseudo-project has agents + terminals only.
const ROOT_VIEWS: ProjectViewKind[] = ["agents"];
const ROOT_PROJECT_ID = "__root__";

function defaultViewsFor(projectId: string): ProjectViewKind[] {
  return projectId === ROOT_PROJECT_ID ? ROOT_VIEWS : DEFAULT_VIEWS;
}

function viewTabId(view: ProjectViewKind) {
  return `view:${view}`;
}
function sessionTabId(sessionId: string) {
  return `session:${sessionId}`;
}

function initialTabState(views: ProjectViewKind[] = DEFAULT_VIEWS): ProjectTabState {
  const tabs: ProjectTab[] = views.map((v) => ({
    id: viewTabId(v),
    kind: "view",
    view: v,
  }));
  return { tabs, activeTabId: tabs[0]!.id };
}

interface UIState {
  // null = Home (no project selected). Tabs are scoped per-project: switching
  // the active project swaps the whole tab strip.
  activeProjectId: string | null;
  projectTabs: Record<string, ProjectTabState>;
  // When YOU last opened a project in Deck — drives sidebar ordering.
  lastOpenedAt: Record<string, number>;
  // Projects currently "open" in the rail (Discord-server style). Ordered by
  // when you opened them; closing removes from the rail only (tabs persist).
  openProjects: string[];

  sidebarCollapsed: boolean;
  sidebarWidth: number;
  search: string;
  terminalFontSize: number;
  notificationsEnabled: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  // M13: recipes management dialog.
  recipesOpen: boolean;
  // M9: transcript search dialog (+ optional project scope).
  searchOpen: boolean;
  searchProjectId: string | null;
  // Full-window takeover view (transient — not persisted). Cleared by any
  // navigation to a project / home / session.
  topView: TopView | null;
  // M8: right-side Attention Inbox slide-over.
  inboxOpen: boolean;
  // Path the Files view should open next (set by "Open in Files" from git),
  // keyed by project id so switching projects doesn't cross wires.
  pendingFile: Record<string, string>;
  // M9: jump the feed to a specific event after load (transient).
  feedJump: { sessionId: string; eventIdx: number } | null;
  // M11: focus a file in the Git tab after opening it (transient).
  gitFocusPath: { projectId: string; path: string } | null;
  // M13: last-used AI commit-message style (persisted).
  commitStyle: "terse" | "conventional" | "verbose";

  setSearch: (s: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setTerminalFontSize: (n: number) => void;
  setNotificationsEnabled: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  setSettingsOpen: (b: boolean) => void;
  setRecipesOpen: (b: boolean) => void;
  openSearch: (projectId?: string | null) => void;
  setSearchOpen: (b: boolean) => void;
  setTopView: (v: TopView | null) => void;
  setInboxOpen: (b: boolean) => void;
  setFeedJump: (j: { sessionId: string; eventIdx: number } | null) => void;
  setGitFocusPath: (j: { projectId: string; path: string } | null) => void;
  setCommitStyle: (s: "terse" | "conventional" | "verbose") => void;
  requestFile: (projectId: string, path: string) => void;
  consumeFile: (projectId: string) => string | null;

  goHome: () => void;
  openProject: (projectId: string, view?: ProjectViewKind) => void;
  // M16/M10: ensure a project's tab strip has exactly the given view tabs
  // present (append missing, preserve user order + session tabs).
  ensureProjectViews: (projectId: string, views: ProjectViewKind[]) => void;
  // Remove a project from the rail; if it was active, fall back to Home.
  closeRailProject: (projectId: string) => void;
  openSession: (sessionId: string, projectId?: string) => void;
  closeTab: (tabId: string, projectId?: string) => void;
  closeActiveTab: () => void;
  removeSessionTabs: (sessionId: string) => void;
  activateTab: (tabId: string) => void;
  // Reorder within the active project's tab strip: move `draggedId` to sit
  // immediately before `targetId` (drop past the end → last position).
  reorderTab: (draggedId: string, targetId: string | null) => void;
  nextTab: (dir: 1 | -1) => void;
  activateIndex: (i: number) => void;
  // The session id of the active project's active tab, if it's a session tab.
  activeSessionId: () => string | null;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      activeProjectId: null,
      projectTabs: {},
      lastOpenedAt: {},
      openProjects: [],
      sidebarCollapsed: false,
      sidebarWidth: 264,
      search: "",
      terminalFontSize: 13,
      notificationsEnabled: true,
      paletteOpen: false,
      settingsOpen: false,
      recipesOpen: false,
      searchOpen: false,
      searchProjectId: null,
      topView: null,
      inboxOpen: false,
      pendingFile: {},
      feedJump: null,
      gitFocusPath: null,
      commitStyle: "terse",

      setSearch: (s) => set({ search: s }),
      toggleSidebar: () =>
        set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed })),
      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.max(200, Math.min(420, w)) }),
      setTerminalFontSize: (n) =>
        set({ terminalFontSize: Math.max(12, Math.min(15, n)) }),
      setNotificationsEnabled: (b) => set({ notificationsEnabled: b }),
      setPaletteOpen: (b) => set({ paletteOpen: b }),
      setSettingsOpen: (b) => set({ settingsOpen: b }),
      setRecipesOpen: (b) => set({ recipesOpen: b }),
      openSearch: (projectId) =>
        set({ searchOpen: true, searchProjectId: projectId ?? null }),
      setSearchOpen: (b) => set({ searchOpen: b }),
      setTopView: (v) => set({ topView: v }),
      setInboxOpen: (b) => set({ inboxOpen: b }),
      setFeedJump: (j) => set({ feedJump: j }),
      setGitFocusPath: (j) => set({ gitFocusPath: j }),
      setCommitStyle: (s) => set({ commitStyle: s }),
      requestFile: (projectId, path) =>
        set((st) => ({ pendingFile: { ...st.pendingFile, [projectId]: path } })),
      consumeFile: (projectId) => {
        const p = get().pendingFile[projectId] ?? null;
        if (p)
          set((st) => {
            const next = { ...st.pendingFile };
            delete next[projectId];
            return { pendingFile: next };
          });
        return p;
      },

      goHome: () => set({ activeProjectId: null, topView: null }),

      ensureProjectViews: (projectId, views) =>
        set((st) => {
          const state = st.projectTabs[projectId];
          if (!state) {
            return {
              projectTabs: {
                ...st.projectTabs,
                [projectId]: initialTabState(views),
              },
            };
          }
          const have = new Set(
            state.tabs.filter((t) => t.kind === "view").map((t) => (t as { view: ProjectViewKind }).view),
          );
          const missing = views.filter((v) => !have.has(v));
          if (missing.length === 0) return st;
          // Insert missing view tabs right after the last existing view tab so
          // they sit with the other views, ahead of any session tabs.
          let lastViewIdx = -1;
          state.tabs.forEach((t, i) => {
            if (t.kind === "view") lastViewIdx = i;
          });
          const inserted: ProjectTab[] = missing.map((v) => ({
            id: viewTabId(v),
            kind: "view",
            view: v,
          }));
          const tabs = [
            ...state.tabs.slice(0, lastViewIdx + 1),
            ...inserted,
            ...state.tabs.slice(lastViewIdx + 1),
          ];
          return {
            projectTabs: { ...st.projectTabs, [projectId]: { ...state, tabs } },
          };
        }),

      openProject: (projectId, view) =>
        set((st) => {
          const existing =
            st.projectTabs[projectId] ??
            initialTabState(defaultViewsFor(projectId));
          const activeTabId = view ? viewTabId(view) : existing.activeTabId;
          return {
            activeProjectId: projectId,
            topView: null,
            projectTabs: {
              ...st.projectTabs,
              [projectId]: { ...existing, activeTabId },
            },
            lastOpenedAt: { ...st.lastOpenedAt, [projectId]: Date.now() },
            openProjects: st.openProjects.includes(projectId)
              ? st.openProjects
              : [...st.openProjects, projectId],
          };
        }),

      closeRailProject: (projectId) =>
        set((st) => ({
          openProjects: st.openProjects.filter((id) => id !== projectId),
          ...(st.activeProjectId === projectId
            ? { activeProjectId: null }
            : {}),
        })),

      openSession: (sessionId, projectId) => {
        const pid =
          projectId ??
          useSessionsStore.getState().byId[sessionId]?.projectId ??
          null;
        if (!pid) return;
        set((st) => {
          const existing =
            st.projectTabs[pid] ?? initialTabState(defaultViewsFor(pid));
          const id = sessionTabId(sessionId);
          const tabs = existing.tabs.some((t) => t.id === id)
            ? existing.tabs
            : [...existing.tabs, { id, kind: "session" as const, sessionId }];
          return {
            activeProjectId: pid,
            topView: null,
            projectTabs: {
              ...st.projectTabs,
              [pid]: { tabs, activeTabId: id },
            },
            lastOpenedAt: { ...st.lastOpenedAt, [pid]: Date.now() },
            openProjects: st.openProjects.includes(pid)
              ? st.openProjects
              : [...st.openProjects, pid],
          };
        });
      },

      closeTab: (tabId, projectId) => {
        const pid = projectId ?? get().activeProjectId;
        if (!pid) return;
        set((st) => {
          const state = st.projectTabs[pid];
          if (!state) return st;
          const target = state.tabs.find((t) => t.id === tabId);
          if (!target || target.kind === "view") return st; // views are permanent
          const idx = state.tabs.findIndex((t) => t.id === tabId);
          const tabs = state.tabs.filter((t) => t.id !== tabId);
          let activeTabId = state.activeTabId;
          if (activeTabId === tabId) {
            const fallback = tabs[Math.min(idx, tabs.length - 1)] ?? tabs[0]!;
            activeTabId = fallback.id;
          }
          return {
            projectTabs: { ...st.projectTabs, [pid]: { tabs, activeTabId } },
          };
        });
      },

      closeActiveTab: () => {
        const pid = get().activeProjectId;
        if (!pid) return;
        const state = get().projectTabs[pid];
        if (state) get().closeTab(state.activeTabId, pid);
      },

      // Drop any session tab for this session across ALL projects (used when a
      // session is killed/dismissed/removed so no dangling tab is left behind).
      removeSessionTabs: (sessionId) =>
        set((st) => {
          const id = sessionTabId(sessionId);
          const nextTabs: Record<string, ProjectTabState> = {};
          let changed = false;
          for (const [pid, state] of Object.entries(st.projectTabs)) {
            if (!state.tabs.some((t) => t.id === id)) {
              nextTabs[pid] = state;
              continue;
            }
            changed = true;
            const idx = state.tabs.findIndex((t) => t.id === id);
            const tabs = state.tabs.filter((t) => t.id !== id);
            let activeTabId = state.activeTabId;
            if (activeTabId === id) {
              const fallback = tabs[Math.min(idx, tabs.length - 1)] ?? tabs[0]!;
              activeTabId = fallback.id;
            }
            nextTabs[pid] = { tabs, activeTabId };
          }
          return changed ? { projectTabs: nextTabs } : st;
        }),

      activateTab: (tabId) =>
        set((st) => {
          const pid = st.activeProjectId;
          if (!pid) return st;
          const state = st.projectTabs[pid];
          if (!state) return st;
          return {
            projectTabs: {
              ...st.projectTabs,
              [pid]: { ...state, activeTabId: tabId },
            },
          };
        }),

      reorderTab: (draggedId, targetId) =>
        set((st) => {
          const pid = st.activeProjectId;
          if (!pid || draggedId === targetId) return st;
          const state = st.projectTabs[pid];
          if (!state) return st;
          const from = state.tabs.findIndex((t) => t.id === draggedId);
          if (from < 0) return st;
          const dragged = state.tabs[from]!;
          const without = state.tabs.filter((t) => t.id !== draggedId);
          let insertAt =
            targetId == null
              ? without.length
              : without.findIndex((t) => t.id === targetId);
          if (insertAt < 0) insertAt = without.length;
          const tabs = [
            ...without.slice(0, insertAt),
            dragged,
            ...without.slice(insertAt),
          ];
          return {
            projectTabs: { ...st.projectTabs, [pid]: { ...state, tabs } },
          };
        }),

      nextTab: (dir) =>
        set((st) => {
          const pid = st.activeProjectId;
          if (!pid) return st;
          const state = st.projectTabs[pid];
          if (!state) return st;
          const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
          if (idx < 0) return st;
          const n = state.tabs.length;
          const nextId = state.tabs[(idx + dir + n) % n]!.id;
          return {
            projectTabs: {
              ...st.projectTabs,
              [pid]: { ...state, activeTabId: nextId },
            },
          };
        }),

      activateIndex: (i) =>
        set((st) => {
          const pid = st.activeProjectId;
          if (!pid) return st;
          const state = st.projectTabs[pid];
          const tab = state?.tabs[i];
          if (!state || !tab) return st;
          return {
            projectTabs: {
              ...st.projectTabs,
              [pid]: { ...state, activeTabId: tab.id },
            },
          };
        }),

      activeSessionId: () => {
        const pid = get().activeProjectId;
        if (!pid) return null;
        const state = get().projectTabs[pid];
        if (!state) return null;
        const t = state.tabs.find((x) => x.id === state.activeTabId);
        return t && t.kind === "session" ? t.sessionId : null;
      },
    }),
    {
      name: "deck-ui",
      version: 2,
      migrate: (persisted: unknown) => {
        // v1 kept a single global `tabs`/`activeTabId` — drop them; the new
        // per-project model starts fresh (sidebar/prefs are preserved).
        if (persisted && typeof persisted === "object") {
          const { tabs, activeTabId, ...rest } = persisted as Record<
            string,
            unknown
          >;
          void tabs;
          void activeTabId;
          return rest;
        }
        return persisted;
      },
      partialize: (st) => ({
        activeProjectId: st.activeProjectId,
        projectTabs: st.projectTabs,
        lastOpenedAt: st.lastOpenedAt,
        openProjects: st.openProjects,
        sidebarCollapsed: st.sidebarCollapsed,
        sidebarWidth: st.sidebarWidth,
        terminalFontSize: st.terminalFontSize,
        notificationsEnabled: st.notificationsEnabled,
        commitStyle: st.commitStyle,
      }),
    },
  ),
);
