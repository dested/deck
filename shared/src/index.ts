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
  id: string; // folder name, e.g. "my-app"
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
  // M10: "root" is the synthetic pseudo-project for `config.root` itself
  // (agents + terminals only; no git/files). Optional so old clients degrade.
  kind?: "normal" | "root";
}

export interface ProjectDetail extends ProjectSummary {
  hasGit: boolean;
}

// ---------------------------------------------------------------------------
// Project inspection (Library cards) — server-side enrichment scraped from
// README / cliffnotes / package.json, cached by file mtimes.
// ---------------------------------------------------------------------------

export interface ProjectScript {
  name: string;
  command: string;
}

export interface ProjectInspection {
  projectId: string;
  // Best one-liner we could find. Source priority: readme > package > cliffnotes > ai.
  blurb: string | null;
  blurbSource: "readme" | "package" | "cliffnotes" | "ai" | null;
  readmeTitle: string | null;
  hasReadme: boolean;
  packageName: string | null;
  frameworks: string[]; // detected stack badges, e.g. ["next", "electron"]
  scripts: ProjectScript[];
  workspaceGlobs: number; // package.json workspaces entries (0 = not a monorepo)
  staticPorts: number[]; // ports scraped from scripts / vite config / .env
  runner: "bun" | "pnpm" | "yarn" | "npm"; // lockfile-detected package manager
}

// Live dev-server detection: listening ports whose owning process belongs to a
// project (matched by command line). Keyed by projectId.
export type LivePortMap = Record<string, number[]>;

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
  // M8: last ~12 lines of the terminal when an owned claude session is
  // `attention` (waiting on a prompt), ANSI-stripped, for the Inbox card.
  promptTail?: string[] | null;
  // M12: AI-generated tab title + one-line live summary, refreshed on change.
  aiMeta?: { title: string; summary: string; at: number } | null;
  // The original ask: first real user message in the transcript (meta/command
  // noise skipped), single line, capped. Free — parsed, no AI call.
  firstPrompt?: string | null;
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
  // M15: Deck-internal AI spend for this day (subset of `cost` is NOT included;
  // this is a separate synthetic series stacked on top of the ccusage bars).
  aiCost?: number;
  // M15: per-model breakdown for this day (ccusage already returns it).
  byModel?: CostModelBreakdown[];
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
  // M15: Deck-internal AI usage as a synthetic project row.
  aiProject?: ProjectCost | null;
  // M15: spend budgets (echoed from state for the dashboard + inbox alert).
  budgets?: { monthlyUSD: number | null; blockUSD: number | null };
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
  | { t: "ports.updated"; payload: LivePortMap }
  | { t: "screenshot.updated"; projectId: string; at: number }
  | { t: "sessions.updated"; payload: Session }
  | { t: "sessions.removed"; id: string }
  | { t: "git.updated"; projectId: string }
  | {
      t: "transcript.append";
      sessionId: string;
      events: TranscriptEvent[];
    }
  | { t: "session.attention"; sessionId: string; reason: string }
  | { t: "reviews.updated"; payload: ReviewItem } // M11
  | { t: "tasks.updated"; payload: TaskCard } // M17
  | { t: "tasks.removed"; id: string } // M17
  | { t: "digest.ready"; name: string } // M14
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
  /** All scanned project roots: [root, ...deck.config.json `roots`, ...extraRoots]. */
  roots: string[];
  /** Roots declared in deck.config.json (read-only in the UI). */
  fileRoots: string[];
  /** Extra roots added from the UI (removable; persisted in state.json). */
  extraRoots: string[];
  port: number;
  claudeBin: string | null;
  defaultShell: string;
  /** True when the server runs under the supervisor, so the UI "restart
   * backend" button will actually respawn it (vs. a bare dev run). */
  supervised: boolean;
}

// ---------------------------------------------------------------------------
// M7 — AI service layer (usage ledger + admin)
// ---------------------------------------------------------------------------

export type AiFeatureId =
  | "blurb"
  | "tabTitle"
  | "liveSummary"
  | "reviewSummary"
  | "commitMessage"
  | "promptEnhancer"
  | "digest"
  | "runbook" // M18: generate deck.run.json from the repo
  | "dbQuery" // M20: natural language -> read-only SQL
  | "taskPrompt" // M17v2: draft a Claude Code prompt for a task card
  | "prAudit"; // PR audit: pre-merge risk/impact/bug report on the change

export type AiBackend = "claude-cli" | "api";

export interface AiUsageEntry {
  ts: number;
  feature: AiFeatureId;
  model: string;
  backend: AiBackend;
  ok: boolean;
  error?: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs: number;
}

export interface AiFeatureConfigView {
  feature: AiFeatureId;
  label: string;
  enabled: boolean;
  model: string;
  dailyBudgetUSD: number;
  spentTodayUSD: number;
  callsToday: number;
  capped: boolean;
}

export interface AiUsageReport {
  totalCost: number;
  days: number;
  byFeature: Record<string, { calls: number; cost: number; tokens: number }>;
  byModel: Record<string, { calls: number; cost: number }>;
  byDay: { date: string; cost: number; calls: number }[];
  recent: AiUsageEntry[];
}

export interface AiConfigView {
  backend: AiBackend;
  apiKeyPresent: boolean;
  globalDailyBudgetUSD: number;
  spentTodayUSD: number;
  features: AiFeatureConfigView[];
}

// Result of a single AI completion (returned by POST /ai/test).
export interface AiResult {
  text: string;
  model: string;
  backend: AiBackend;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// PR audit — AI pre-merge report on the current change (Git tab)
// ---------------------------------------------------------------------------

export type AuditRiskLevel = "low" | "medium" | "high";
export type AuditSeverity = "bug" | "risk" | "nit";
export type AuditImpactArea =
  | "db"
  | "api"
  | "ui"
  | "state"
  | "config"
  | "deps"
  | "infra"
  | "tests"
  | "docs"
  | "other";

export interface AuditFinding {
  severity: AuditSeverity; // bug = likely broken; risk = could break; nit = minor
  title: string; // one terse line
  detail: string; // 1–2 sentences max
  file: string | null; // repo-relative path when the finding is localized
  line: number | null; // new-side line number when citable
}

export interface AuditImpact {
  area: AuditImpactArea;
  summary: string; // one line, e.g. "state.json gains `tasks[].images` — needs restart"
  files: string[]; // the touched files behind this impact
}

export interface GitAuditReport {
  generatedAt: number;
  scope: "working" | "branch"; // dirty tree, or (clean) unpushed commits
  branch: string;
  headline: string; // ≤12 words: what this change IS
  verdict: string; // one sentence: overall take
  risk: { level: AuditRiskLevel; why: string };
  stats: { files: number; additions: number; deletions: number };
  impacts: AuditImpact[]; // total blast radius, grouped by area
  findings: AuditFinding[]; // bugs first, then risks, then nits
  features: string[]; // user-facing features/systems touched (per cliffnotes)
  checklist: string[]; // concrete before-merge actions
  model: string;
  costUSD: number;
  durationMs: number;
  diffSig: string; // sha1 of the audited diff — staleness detection
}

// GET /projects/:id/git/audit — cached report + whether the diff moved since.
export interface GitAuditState {
  report: GitAuditReport | null;
  stale: boolean; // report exists but the diff has changed since it ran
}

// ---------------------------------------------------------------------------
// M9 — transcript search
// ---------------------------------------------------------------------------

export interface SearchHit {
  sessionId: string;
  projectId: string;
  title: string | null;
  snippet: string; // sentinel-wrapped match spans (client renders <mark>)
  ts: number;
  eventIdx: number;
  kind: string;
}

// ---------------------------------------------------------------------------
// M11 — review queue ("what changed while I was away")
// ---------------------------------------------------------------------------

export interface ReviewItem {
  id: string; // == sessionId
  sessionId: string;
  projectId: string;
  ts: number;
  files: string[];
  summary: string | null;
  dismissed: boolean;
}

// ---------------------------------------------------------------------------
// M13 — prompt recipes
// ---------------------------------------------------------------------------

export interface Recipe {
  id: string;
  name: string;
  body: string;
  tags: string[];
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
}

// ---------------------------------------------------------------------------
// M17v2 — personal task board (pure kanban; NEVER launches sessions)
// ---------------------------------------------------------------------------

// Inbox = zero-friction brain dump. Next = short curated queue. Now = the one
// thing being worked on (soft limit, UI nags past 1). Done = wins pile
// (fades after 7d client-side, auto-pruned after 30d server-side).
export type TaskStatus = "inbox" | "next" | "now" | "done";

// The non-code bucket ("pay bills", errands). Not a real project — a sentinel
// TaskCard.projectId the client renders with its own first-class identity.
// Never a valid id for project routes; AI prompt drafting rejects it.
export const LIFE_PROJECT_ID = "__life__";

// An image attached to a card (pasted screenshot, dropped file). The bytes
// live on disk (~/.deck/task-images/<taskId>-<id>.<ext>); this is the index
// entry. Served at GET /tasks/:taskId/images/:id.
export interface TaskImage {
  id: string;
  ext: "png" | "jpg" | "gif" | "webp";
  name: string; // original filename, or "pasted image"
  addedAt: number;
  w?: number; // client-measured dimensions (best effort, for layout hints)
  h?: number;
}

export interface TaskCard {
  id: string;
  title: string;
  body: string; // free-form description / notes
  projectId: string | null; // capture first, assign later
  prompt: string | null; // AI-drafted Claude Code prompt (copy-paste, manual)
  images: TaskImage[]; // attached screenshots/mockups
  createdAt: number;
  doneAt: number | null;
  order: number;
  status: TaskStatus;
}

// ---------------------------------------------------------------------------
// M18 — runbook (deck.run.json: how to run/test a project) + embedded preview
// ---------------------------------------------------------------------------

export interface Runbook {
  // Relative dir under the repo root that runbook commands run in (monorepos:
  // "apps/web"). Absent/invalid = repo root.
  cwd?: string;
  // The dev server: command to start it and where it serves. `url` wins over
  // `port` for the preview iframe; port alone implies http://localhost:<port>.
  dev?: { command: string; port?: number; url?: string };
  test?: { command: string };
  install?: { command: string };
  notes?: string;
}

export interface RunbookInfo {
  runbook: Runbook;
  // true when deck.run.json exists at the repo root (runbook == its contents);
  // false means `runbook` is Deck's detection fallback (scripts/ports/runner).
  hasFile: boolean;
}

export interface RunbookStatus {
  port: number | null; // effective preview port (file > live-detected > static)
  url: string | null;
  listening: boolean; // TCP probe of the port, or HTTP probe for external URLs
  // The URL sends X-Frame-Options / CSP frame-ancestors, so the browser will
  // refuse to render it in the preview iframe (most public sites do this).
  frameBlocked: boolean;
  livePorts: number[]; // portWatcher's live ports for this project
}

// ---------------------------------------------------------------------------
// M19 — system suite (dev processes + listening ports, killable)
// ---------------------------------------------------------------------------

export interface SystemProcess {
  pid: number;
  ppid: number;
  name: string; // node.exe / bun.exe / python.exe …
  commandLine: string | null;
  memoryMB: number;
  startedAt: number | null; // epoch ms
  projectId: string | null; // matched by command-line path
  ports: number[]; // listening ports owned by this pid
  orphaned: boolean; // parent process no longer exists
}

export interface SystemPortEntry {
  port: number;
  pid: number;
  processName: string | null;
  projectId: string | null;
}

export interface SystemOverview {
  generatedAt: number;
  processes: SystemProcess[]; // dev runtimes (node/bun/python/deno)
  ports: SystemPortEntry[]; // ALL listening TCP ports (user range)
}

// ---------------------------------------------------------------------------
// M20 — env intelligence + database panel
// ---------------------------------------------------------------------------

// Rough classification of an env key so big files scan visually.
export type EnvVarCategory =
  | "ai"
  | "database"
  | "auth"
  | "payments"
  | "storage"
  | "email"
  | "urls"
  | "config"
  | "other";

export interface EnvVar {
  key: string;
  masked: string; // display-safe value; reveal endpoint returns the real one
  hasValue: boolean;
  category?: EnvVarCategory; // optional so pre-upgrade servers degrade
}

export interface EnvFile {
  path: string; // repo-relative, forward-slash (e.g. ".env", "server/.env")
  vars: EnvVar[];
  // Monorepo grouping: name of the nearest enclosing package.json (or its
  // relative dir when unnamed); null = the repo root itself.
  workspace?: string | null;
}

export type StackBadge =
  | "anthropic"
  | "openai"
  | "postgres"
  | "mysql"
  | "sqlite"
  | "prisma"
  | "drizzle"
  | "redis"
  | "supabase"
  | "stripe"
  | "s3";

export interface StackReport {
  projectId: string;
  files: EnvFile[];
  badges: StackBadge[];
  // First DATABASE_URL-ish var found (postgres wins), for the DB panel.
  databaseUrl: {
    file: string;
    key: string;
    masked: string;
    provider: "postgres" | "mysql" | "sqlite" | "other";
  } | null;
  prismaSchemaPath: string | null; // repo-relative, when a schema.prisma exists
}

export interface DbTable {
  schema: string;
  name: string;
  rows: number | null; // planner estimate; null = never analyzed
}

export interface DbOverview {
  ok: boolean;
  error?: string;
  serverVersion?: string;
  database?: string;
  tables: DbTable[];
}

export interface DbQueryResult {
  sql: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface StudioStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  error?: string;
}
