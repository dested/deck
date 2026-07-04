import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Group } from "@deck/shared";

// Persisted linkage of an app-owned claude PTY to the transcript file it wrote.
export interface OwnedSessionRecord {
  id: string; // pty id (stable across restarts of the record, not the pty)
  kind: "claude" | "shell";
  projectId: string;
  projectPath: string;
  name: string;
  groupId: string | null;
  transcriptSessionId: string | null;
  createdAt: number;
}

export interface DeckState {
  version: 1;
  groups: Group[];
  // sessionId -> user-given name (external sessions too)
  sessionNames: Record<string, string>;
  // sessionId -> groupId (external sessions can be grouped too)
  sessionGroups: Record<string, string | null>;
  pinnedProjects: string[];
  hiddenProjects: string[];
  ownedSessions: OwnedSessionRecord[];
  mutedSessions: string[];
  // sessionId -> dismissedAt (ms). An external session is hidden while its
  // transcript hasn't been touched since this time; new activity un-hides it.
  dismissedSessions: Record<string, number>;
  prefs: {
    sidebarWidth: number;
    terminalFontSize: number;
    notifications: boolean;
    root: string | null;
  };
  openTabs: unknown[]; // opaque client tab state, round-tripped
}

const DEFAULT_STATE: DeckState = {
  version: 1,
  groups: [],
  sessionNames: {},
  sessionGroups: {},
  pinnedProjects: [],
  hiddenProjects: [],
  ownedSessions: [],
  mutedSessions: [],
  dismissedSessions: {},
  prefs: {
    sidebarWidth: 264,
    terminalFontSize: 13,
    notifications: true,
    root: null,
  },
  openTabs: [],
};

let current: DeckState = structuredClone(DEFAULT_STATE);

export function loadState(): DeckState {
  try {
    if (fs.existsSync(config.deckStateFile)) {
      const parsed = JSON.parse(
        fs.readFileSync(config.deckStateFile, "utf8"),
      ) as Partial<DeckState>;
      current = { ...structuredClone(DEFAULT_STATE), ...parsed };
      // ensure nested prefs object is complete
      current.prefs = { ...DEFAULT_STATE.prefs, ...(parsed.prefs ?? {}) };
    }
  } catch (err) {
    console.warn("[state] failed to load, using defaults:", err);
    current = structuredClone(DEFAULT_STATE);
  }
  return current;
}

export function getState(): DeckState {
  return current;
}

let saveTimer: NodeJS.Timeout | null = null;

function writeAtomic() {
  try {
    fs.mkdirSync(config.deckStateDir, { recursive: true });
    const tmp = path.join(
      config.deckStateDir,
      `state.tmp-${process.pid}-${current.version}`,
    );
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), "utf8");
    fs.renameSync(tmp, config.deckStateFile);
  } catch (err) {
    console.warn("[state] save failed:", err);
  }
}

// Mutate + schedule a debounced atomic save.
export function updateState(mutator: (s: DeckState) => void): DeckState {
  mutator(current);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeAtomic, 500);
  return current;
}

export function flushState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeAtomic();
}
