import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ProjectSubtab = "agents" | "git" | "files" | "terminals";

export type Tab =
  | { id: string; kind: "home" }
  | {
      id: string;
      kind: "project";
      projectId: string;
      subtab: ProjectSubtab;
    }
  | { id: string; kind: "session"; sessionId: string }
  | { id: string; kind: "grid"; groupId: string };

const HOME_TAB: Tab = { id: "home", kind: "home" };

interface UIState {
  tabs: Tab[];
  activeTabId: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  search: string;
  terminalFontSize: number;
  notificationsEnabled: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  // Path the Files tab should open next (set by "Open in Files" from git), keyed
  // by project id so switching projects doesn't cross wires.
  pendingFile: Record<string, string>;

  setSearch: (s: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setTerminalFontSize: (n: number) => void;
  setNotificationsEnabled: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  setSettingsOpen: (b: boolean) => void;
  requestFile: (projectId: string, path: string) => void;
  consumeFile: (projectId: string) => string | null;

  openTab: (tab: Tab, opts?: { activate?: boolean }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  nextTab: (dir: 1 | -1) => void;
  activateIndex: (i: number) => void;
  setProjectSubtab: (tabId: string, subtab: ProjectSubtab) => void;
  openProject: (projectId: string, subtab?: ProjectSubtab) => void;
  openSession: (sessionId: string) => void;
  openGrid: (groupId: string) => void;
}

function tabKey(tab: Tab): string {
  switch (tab.kind) {
    case "home":
      return "home";
    case "project":
      return `project:${tab.projectId}`;
    case "session":
      return `session:${tab.sessionId}`;
    case "grid":
      return `grid:${tab.groupId}`;
  }
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeTabId: "home",
      sidebarCollapsed: false,
      sidebarWidth: 264,
      search: "",
      terminalFontSize: 13,
      notificationsEnabled: true,
      paletteOpen: false,
      settingsOpen: false,
      pendingFile: {},

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
      requestFile: (projectId, path) =>
        set((st) => ({ pendingFile: { ...st.pendingFile, [projectId]: path } })),
      consumeFile: (projectId) => {
        const p = get().pendingFile[projectId] ?? null;
        if (p) set((st) => {
          const next = { ...st.pendingFile };
          delete next[projectId];
          return { pendingFile: next };
        });
        return p;
      },

      openTab: (tab, opts = {}) => {
        const activate = opts.activate ?? true;
        const key = tabKey(tab);
        const existing = get().tabs.find((t) => tabKey(t) === key);
        if (existing) {
          if (activate) set({ activeTabId: existing.id });
          return;
        }
        set((st) => ({
          tabs: [...st.tabs, tab],
          activeTabId: activate ? tab.id : st.activeTabId,
        }));
      },

      closeTab: (id) => {
        if (id === "home") return; // home is permanent
        set((st) => {
          const idx = st.tabs.findIndex((t) => t.id === id);
          if (idx < 0) return st;
          const tabs = st.tabs.filter((t) => t.id !== id);
          let activeTabId = st.activeTabId;
          if (activeTabId === id) {
            const fallback = tabs[Math.min(idx, tabs.length - 1)] ?? HOME_TAB;
            activeTabId = fallback.id;
          }
          return { tabs, activeTabId };
        });
      },

      activateTab: (id) => set({ activeTabId: id }),

      nextTab: (dir) =>
        set((st) => {
          const idx = st.tabs.findIndex((t) => t.id === st.activeTabId);
          if (idx < 0) return st;
          const n = st.tabs.length;
          const nextIdx = (idx + dir + n) % n;
          return { activeTabId: st.tabs[nextIdx]!.id };
        }),

      activateIndex: (i) =>
        set((st) => {
          const tab = st.tabs[i];
          return tab ? { activeTabId: tab.id } : st;
        }),

      setProjectSubtab: (tabId, subtab) =>
        set((st) => ({
          tabs: st.tabs.map((t) =>
            t.id === tabId && t.kind === "project" ? { ...t, subtab } : t,
          ),
        })),

      openProject: (projectId, subtab = "agents") =>
        get().openTab({
          id: `project:${projectId}`,
          kind: "project",
          projectId,
          subtab,
        }),

      openSession: (sessionId) =>
        get().openTab({
          id: `session:${sessionId}`,
          kind: "session",
          sessionId,
        }),

      openGrid: (groupId) =>
        get().openTab({ id: `grid:${groupId}`, kind: "grid", groupId }),
    }),
    {
      name: "deck-ui",
      partialize: (st) => ({
        tabs: st.tabs,
        activeTabId: st.activeTabId,
        sidebarCollapsed: st.sidebarCollapsed,
        sidebarWidth: st.sidebarWidth,
        terminalFontSize: st.terminalFontSize,
        notificationsEnabled: st.notificationsEnabled,
      }),
    },
  ),
);
