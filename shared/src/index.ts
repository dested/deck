// ============================================================================
// Deck shared types — the single source of truth for server <-> client shapes.
// Imported by both `server` and `web` via the `@deck/shared` workspace alias.
// ============================================================================

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface ProjectSummary {
  id: string; // folder name, e.g. "scenebeans2"
  path: string; // absolute win32 path
  name: string; // display name (== id for now)
  activityAt: number; // epoch ms
  branch: string | null;
  dirtyCount: number | null; // null == not yet computed
  aheadBehind: AheadBehind | null;
  runningSessionCount: number;
  pinned: boolean;
  hidden: boolean;
  groupId?: string | null; // project group assignment (null/undefined == ungrouped)
}

export interface ProjectDetail extends ProjectSummary {
  hasGit: boolean;
}

// ---------------------------------------------------------------------------
// File tree / editor
// ---------------------------------------------------------------------------

export interface TreeNode {
  name: string;
  path: string; // repo-relative, forward-slash
  type: "dir" | "file";
  ignored?: boolean; // node_modules/.git/dist/.next
  gitModified?: boolean;
}

export interface FileContent {
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  binary?: boolean;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type GitStatusCode = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "T";

export interface GitFileEntry {
  path: string; // repo-relative, forward-slash
  origPath?: string; // for renames
  code: GitStatusCode; // primary status glyph
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  aheadBehind: AheadBehind | null;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[]; // includes untracked (untracked flag set)
  conflicted: GitFileEntry[];
  clean: boolean;
}

export interface DiffLine {
  type: "context" | "add" | "del" | "meta";
  oldNo: number | null;
  newNo: number | null;
  text: string;
  // word-level intra-line highlight ranges (char offsets into `text`, sans prefix)
  intra?: [number, number][];
}

export interface Hunk {
  header: string; // the raw @@ ... @@ line
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  // exact raw text of this hunk (header + body) for byte-faithful `git apply`
  patch: string;
}

export interface DiffResult {
  path: string;
  fileHeader: string; // the "diff --git ... +++ ..." preamble lines
  hunks: Hunk[];
  raw: string;
  binary?: boolean;
}

export interface FileAtHead {
  content: string;
  exists: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: number; // epoch ms
  refs: string[];
}

export interface FileChange {
  path: string;
  origPath?: string;
  code: GitStatusCode;
}

export interface CommitShow {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: number;
  files: FileChange[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionKind = "claude" | "shell";

export type SessionStatus =
  | "working"
  | "attention"
  | "idle"
  | "stale"
  | "exited";

export type SessionSource = "owned" | "external";

// Cheap roll-up of a transcript-backed session for the Agents cards (§9.4).
export interface AgentStats {
  messages: number; // user + assistant turns
  tools: number; // tool calls
  edits: number; // edit/write tool calls (files changed-ish)
  model: string | null; // last model seen in the transcript
}

export interface Session {
  id: string; // owned: pty id; external: transcript session uuid
  kind: SessionKind;
  source: SessionSource;
  projectId: string;
  projectPath: string;
  name: string;
  groupId: string | null;
  status: SessionStatus;
  ptyId: string | null; // owned only
  transcriptSessionId: string | null; // uuid from filename, if linked
  transcriptPath: string | null;
  exitCode: number | null;
  createdAt: number;
  activityAt: number;
  lastActivityLine: string | null;
  unread: boolean;
  title: string | null; // ai-title if present
  stats?: AgentStats | null; // claude sessions with a parsed transcript
}

export interface Group {
  id: string;
  name: string;
  collapsed?: boolean;
}

// Restoring a tab whose session is no longer live (server bounced / transcript
// aged out / it was closed). Claude sessions come back as a read-only feed you
// can Resume; shell sessions come back as their last captured screen text.
export type SessionRestore =
  | { kind: "claude"; session: Session }
  | { kind: "shell"; scrollback: string; name: string | null }
  | { kind: "none" };

// ---------------------------------------------------------------------------
// Cost / token usage (via ccusage) — full dashboard
// ---------------------------------------------------------------------------

export interface CostModelBreakdown {
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Per-session cost, keyed by transcript uuid (== ccusage session `period`).
export interface SessionCost {
  sessionId: string;
  cost: number;
  totalTokens: number;
  lastActivity: number | null; // epoch ms
  models: string[];
}

// Cost rolled up per Deck project (sessions joined by transcript dir).
export interface ProjectCost {
  projectId: string;
  cost: number;
  totalTokens: number;
  sessionCount: number;
  byModel: CostModelBreakdown[];
  lastActivity: number | null;
}

export interface DailyCost {
  date: string; // YYYY-MM-DD
  cost: number;
  totalTokens: number;
}

// The current Claude 5-hour billing window (ccusage `blocks --active`).
export interface ActiveBlock {
  id: string;
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  costUSD: number;
  totalTokens: number;
  models: string[];
  burnRate: { costPerHour: number; tokensPerMinute: number } | null;
  projection: {
    remainingMinutes: number;
    totalCost: number;
    totalTokens: number;
  } | null;
}

export interface CostReport {
  generatedAt: number;
  available: boolean; // false when ccusage isn't installed / failed
  error?: string;
  totalCost: number;
  totalTokens: number;
  projects: ProjectCost[]; // sorted desc by cost
  daily: DailyCost[]; // chronological
  sessions: Record<string, SessionCost>; // by transcript session id
  activeBlock: ActiveBlock | null;
}

// ---------------------------------------------------------------------------
// Transcript events (the parsed agent feed) — §7.2
// ---------------------------------------------------------------------------

export interface MiniDiff {
  path: string;
  lines: DiffLine[];
}

export type ToolStatus = "ok" | "error" | "pending";

export interface TranscriptEventBase {
  id: string; // uuid
  ts: number; // epoch ms
}

export type TranscriptEvent =
  | (TranscriptEventBase & { kind: "user"; text: string; images?: number })
  | (TranscriptEventBase & { kind: "assistant"; markdown: string })
  | (TranscriptEventBase & { kind: "thinking"; chars: number; text: string })
  | (TranscriptEventBase & {
      kind: "tool";
      name: string;
      icon: string;
      title: string;
      detail: string;
      status: ToolStatus;
      input: unknown;
      resultPreview: string;
      isEdit?: MiniDiff | null;
    })
  | (TranscriptEventBase & {
      kind: "subagent";
      description: string;
      eventCount: number;
      events: TranscriptEvent[];
    })
  | (TranscriptEventBase & { kind: "meta"; label: string });

export interface TranscriptPage {
  events: TranscriptEvent[];
  hasMore: boolean;
  total: number;
  title: string | null;
}

// ---------------------------------------------------------------------------
// WebSocket event bus (/ws/events)
// ---------------------------------------------------------------------------

export type WsClientMsg =
  | { op: "sub"; topics: string[] }
  | { op: "unsub"; topics: string[] }
  | { op: "ping" };

export type WsServerMsg =
  | { t: "hello"; time: number }
  | { t: "pong" }
  | { t: "projects.updated"; payload: ProjectSummary }
  | { t: "projects.removed"; id: string }
  | { t: "project-groups.updated"; payload: Group[] }
  | { t: "sessions.updated"; payload: Session }
  | { t: "sessions.removed"; id: string }
  | { t: "git.updated"; projectId: string }
  | {
      t: "transcript.append";
      sessionId: string;
      events: TranscriptEvent[];
    }
  | { t: "session.attention"; sessionId: string; reason: string }
  | { t: "echo"; data: unknown };

// ---------------------------------------------------------------------------
// WebSocket terminal bridge (/ws/term/:ptyId)
// ---------------------------------------------------------------------------

export type WsTermClientMsg =
  | { op: "input"; data: string }
  | { op: "resize"; cols: number; rows: number };

// Server -> client for terminal is binary (raw PTY bytes), plus a small JSON
// control channel for exit notifications:
export type WsTermServerMsg =
  | { op: "exit"; code: number | null }
  | { op: "ready" };

// ---------------------------------------------------------------------------
// Settings / config surfaced to the client
// ---------------------------------------------------------------------------

export interface DeckClientConfig {
  root: string;
  port: number;
  claudeBin: string | null;
  defaultShell: string;
}
