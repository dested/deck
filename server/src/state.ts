import fs from "node:fs";
import path from "node:path";
import { config, setRuntimeExtraRoots } from "./config.js";
import type {
  Group,
  ReviewItem,
  Recipe,
  TaskCard,
  TaskStatus,
} from "@deck/shared";

// M7: per-feature + global AI config overrides (defaults live in ai/models.ts).
export interface AiConfigState {
  backend?: "claude-cli" | "api";
  globalDailyBudgetUSD?: number;
  features: Record<
    string,
    { enabled?: boolean; model?: string; dailyBudgetUSD?: number }
  >;
}

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
  // Named, ordered, collapsible project groups (sidebar). Array order = display
  // order. Separate from session `groups` above.
  projectGroups: Group[];
  // projectId -> groupId assignment (null == ungrouped)
  projectGroupOf: Record<string, string | null>;
  pinnedProjects: string[];
  hiddenProjects: string[];
  ownedSessions: OwnedSessionRecord[];
  mutedSessions: string[];
  // sessionId -> dismissedAt (ms). An external session is hidden while its
  // transcript hasn't been touched since this time; new activity un-hides it.
  dismissedSessions: Record<string, number>;
  // projectId -> AI-generated one-line description (Library card ✨ button).
  projectBlurbs: Record<string, { text: string; at: number }>;
  // M7: AI service config overrides (backend / budgets / per-feature).
  aiConfig: AiConfigState;
  // M11: review-queue items keyed by sessionId (cap 100 by ts).
  reviews: Record<string, ReviewItem>;
  // M13: saved prompt recipes.
  recipes: Recipe[];
  // M15: spend budgets (null == unset).
  budgets: { monthlyUSD: number | null; blockUSD: number | null };
  // M17v2: personal task-board cards (cap 200; done pruned after 30d).
  tasks: TaskCard[];
  // Extra project roots added from the UI (besides `config.root` and any
  // deck.config.json `roots`). Seeds config.setRuntimeExtraRoots on boot so they
  // are scanned without a restart. Normalized win32 absolute paths.
  extraRoots: string[];
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
  projectGroups: [],
  projectGroupOf: {},
  pinnedProjects: [],
  hiddenProjects: [],
  ownedSessions: [],
  mutedSessions: [],
  dismissedSessions: {},
  projectBlurbs: {},
  aiConfig: { features: {} },
  reviews: {},
  recipes: [],
  budgets: { monthlyUSD: null, blockUSD: null },
  tasks: [],
  extraRoots: [],
  prefs: {
    sidebarWidth: 264,
    terminalFontSize: 13,
    notifications: true,
    root: null,
  },
  openTabs: [],
};

// M17v2 migration: old cards had backlog/queued/linked statuses plus session
// linkage fields. Map to the new manual columns and strip the dead fields.
const OLD_STATUS_MAP: Record<string, TaskStatus> = {
  backlog: "inbox",
  queued: "next",
  linked: "now",
};

function migrateTask(raw: TaskCard): TaskCard {
  const t = raw as TaskCard & Record<string, unknown>;
  const status: TaskStatus =
    t.status === "done" ? "done" : OLD_STATUS_MAP[t.status] ?? t.status;
  return {
    id: t.id,
    title: t.title,
    body: t.body ?? "",
    projectId: t.projectId ?? null,
    prompt: typeof t.prompt === "string" ? t.prompt : null,
    images: Array.isArray(t.images) ? t.images : [],
    createdAt: t.createdAt,
    doneAt: t.doneAt ?? null,
    order: t.order ?? 0,
    status,
  };
}

let current: DeckState = structuredClone(DEFAULT_STATE);

const bakFile = () => `${config.deckStateFile}.bak`;

function parseStateFile(file: string): Partial<DeckState> | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DeckState>;
  } catch {
    return null;
  }
}

export function loadState(): DeckState {
  // Corruption fallback: a truncated/garbled state.json (disk trouble, crash
  // mid-write) must NOT silently reset to defaults — that loses every group,
  // pin, and owned-session record. writeAtomic keeps a .bak of the last good
  // file; try it before giving up.
  let parsed = parseStateFile(config.deckStateFile);
  if (!parsed && fs.existsSync(config.deckStateFile)) {
    parsed = parseStateFile(bakFile());
    if (parsed) console.warn("[state] state.json unreadable — recovered from .bak");
  } else if (!parsed) {
    parsed = parseStateFile(bakFile());
  }
  try {
    if (parsed) {
      current = { ...structuredClone(DEFAULT_STATE), ...parsed };
      // ensure nested objects are complete (old state files predate these)
      current.prefs = { ...DEFAULT_STATE.prefs, ...(parsed.prefs ?? {}) };
      current.aiConfig = {
        ...parsed.aiConfig,
        features: { ...(parsed.aiConfig?.features ?? {}) },
      };
      current.budgets = { ...DEFAULT_STATE.budgets, ...(parsed.budgets ?? {}) };
      current.reviews = parsed.reviews ?? {};
      current.recipes = parsed.recipes ?? [];
      current.tasks = (parsed.tasks ?? []).map(migrateTask);
      current.extraRoots = Array.isArray(parsed.extraRoots)
        ? parsed.extraRoots.filter((r): r is string => typeof r === "string")
        : [];
    }
  } catch (err) {
    console.warn("[state] failed to load, using defaults:", err);
    current = structuredClone(DEFAULT_STATE);
  }
  // Push the persisted UI roots into config so the scanner sees them this boot.
  setRuntimeExtraRoots(current.extraRoots);
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
    // Keep the previous good file as .bak before swapping in the new one, so a
    // corrupted state.json is recoverable (see loadState).
    try {
      if (fs.existsSync(config.deckStateFile)) {
        fs.copyFileSync(config.deckStateFile, bakFile());
      }
    } catch {
      /* backup is best-effort */
    }
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
