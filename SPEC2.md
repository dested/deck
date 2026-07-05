# SPEC2 — Deck v2: the AI layer (M7–M17)

> Companion to `SPEC.md` (locked, M0–M6 complete + verified). This spec covers
> the v2 batch: an AI service foundation with cost tracking + admin, the
> Attention Inbox, global transcript search + resume, a root pseudo-project,
> the agent review queue, AI tab titles/summaries, prompt recipes + enhancer +
> commit messages, digests, cost expansion, a cliffnotes tab, and the task
> board. Written 2026-07-05.
>
> **Implementer: read `cliffnotes.md` FIRST** — it is the map of everything
> referenced here. All conventions from SPEC.md carry over: shared types live
> ONLY in `shared/src/index.ts`; REST under `/api`; `/ws/events` pub-sub with
> refcounted topics; persistence in `~/.deck/state.json` via `state.ts`
> `updateState` (state-shape changes need a server restart and must degrade
> gracefully with optional fields); no CDN/network deps in the web bundle;
> `bun run typecheck` must pass for both packages after every milestone.
> **Update `cliffnotes.md` as part of finishing each milestone** (file map,
> routes, gotchas, status), same as M0–M6 did.
>
> NOTE: there is an **in-flight uncommitted Library feature** (project
> inspector / live ports / screenshots: `server/src/projects/{inspector,ports,
> screenshots}.ts`, `web/src/views/LibraryView.tsx`, `web/src/stores/
> libraryStore.ts`). Do not clobber it. It already established two patterns
> reused below: `CreateSessionInput.command` (run a shell command in a spawned
> terminal) and the `/projects/:id/blurb` route (an ad-hoc `claude -p` call
> that **M7 must absorb**).

---

## Build order

**M7 is the foundation — build it first.** Everything AI-flavored routes
through it. After M7, milestones are largely independent; recommended order
by user value:

```
M7  AI service + usage ledger + AI Admin        (foundation)
M12 AI tab titles + live summaries              (exercises M7, instant daily joy)
M8  Attention Inbox                             (biggest workflow change)
M13 Prompt recipes + enhancer + commit message
M9  Global transcript search + resume
M11 Review queue ("what changed while I was away")
M15 Cost expansion (budgets, trends, internal-AI row)
M10 Root pseudo-project (G:\code itself)
M16 Cliffnotes tab + generate
M14 Daily / on-demand digest
M17 Task board
```

Cross-milestone dependencies (hard): M12/M13(enhance,commit-msg)/M14/M11(summary)
→ M7. M17 → M13 (spawn-with-initial-prompt) and benefits from M12 (card
summaries) + M11 (Review column). M8 benefits from M12 titles but does not
require them.

---

## Global gotchas (read before writing any code)

1. **Model IDs are exact strings**: `claude-haiku-4-5` and `claude-sonnet-5`.
   Never append date suffixes. User mandate: default Deck-internal AI to
   **haiku** for high-frequency features and **sonnet** for quality-sensitive
   ones — never opus by default (cost).
2. **Sonnet 5 API quirks** (only relevant to the `api` backend): non-default
   `temperature`/`top_p`/`top_k` are **rejected with a 400** — never send
   them. Omitting `thinking` runs adaptive thinking; for Deck's cheap utility
   calls pass `thinking: {type: "disabled"}` explicitly to keep latency/cost
   down. Haiku 4.5 does not support the `effort` param — don't send
   `output_config` to it.
3. **`claude -p` writes a real transcript** into `~/.claude/projects/<encoded
   cwd>/`. Deck's transcript registry will surface it as an external "agent"
   card unless you (a) run with `cwd` outside `config.root` (default:
   `~/.deck/ai/`), or (b) when a repo cwd is required (blurb), **dismiss the
   returned `session_id` immediately** (same mechanism `forceClose` uses:
   `dismissedSessions[id] = Date.now()` + `publishRemoved`). The existing
   blurb route has this ghost-card bug today — M7 fixes it.
4. **Strip `CLAUDE_CODE_*` env on every spawned claude** — including `-p`
   calls. `cleanEnv()` exists (used by `pty/manager.ts` and the blurb route);
   export it from one shared place (`server/src/lib/cleanEnv.ts`) instead of
   duplicating.
5. **`claude` binary resolution**: always via `ptyManager.getClaudeBin()`
   (handles the `C:\nvm4w\nodejs\claude.cmd` shim); invoke through
   `cmd /c <bin> ...` on win32 like the blurb route does.
6. **Parse CLI JSON loosely.** `claude -p ... --output-format json` emits a
   JSON object with (verify once on this machine before relying on names —
   run `claude -p "say hi" --output-format json` and inspect): `result`
   (string), `total_cost_usd`, `usage` (`input_tokens`, `output_tokens`,
   `cache_creation_input_tokens`, `cache_read_input_tokens`), `duration_ms`,
   `session_id`, `is_error`. Tolerate every field being missing; reuse the
   `parseJsonLoose` pattern from `cost/service.ts` (scan from first `{`).
7. **Every new virtualized/scrolling list** needs `scrollbar-gutter: stable`
   (see the Feed freeze gotcha in cliffnotes).
8. **`better-sqlite3` (M9)** ships win32-x64 prebuilds — no native toolchain
   needed (same situation as node-pty). It must be a dependency of the
   `server` package (Node runtime, not bun).
9. **Charts (M15/M7 admin)**: read the `dataviz` skill before writing any
   chart code; keep to the §8 token palette.
10. **All UI work follows `theme/tokens.css` §8 tokens** and the existing
    component library (`components/ui/*`, `menuStyles`). No new colors.

---

## M7 — AI service foundation, usage ledger, AI Admin

Every AI call Deck makes on its own behalf goes through ONE choke point that:
picks the model per feature (user-adjustable), enforces a daily budget,
records cost/tokens/latency to a persistent ledger, and supports two
backends. This is what makes "add more AI everywhere" safe.

### Server — new directory `server/src/ai/`

**`server/src/ai/types.ts`** (server-only helpers; the wire types go in
`shared/`):

```ts
export type AiBackend = "claude-cli" | "api";

export interface AiRequest {
  feature: AiFeatureId;          // shared type, see below
  prompt: string;
  system?: string;               // api backend: system param; cli: prepended to prompt
  maxTokens?: number;            // default 1024
  timeoutMs?: number;            // default 60_000; cli first-run may be slow
  cwd?: string;                  // cli backend only — when claude needs repo access
  json?: boolean;                // caller wants JSON back; adds "Output only JSON" discipline + loose-parse helper
}

export interface AiResult {
  text: string;
  model: string;
  backend: AiBackend;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
```

**`server/src/ai/models.ts`** — feature registry + defaults:

```ts
export const AI_FEATURES: Record<AiFeatureId, {
  label: string;                // for the admin UI
  defaultModel: string;         // exact model id
  defaultEnabled: boolean;
  dailyBudgetUSD: number;       // per-feature soft cap
}> = {
  blurb:          { label: "Library blurbs",     defaultModel: "claude-haiku-4-5", defaultEnabled: true, dailyBudgetUSD: 0.25 },
  tabTitle:       { label: "Tab titles",         defaultModel: "claude-haiku-4-5", defaultEnabled: true, dailyBudgetUSD: 0.50 },
  liveSummary:    { label: "Session summaries",  defaultModel: "claude-haiku-4-5", defaultEnabled: true, dailyBudgetUSD: 0.50 },
  reviewSummary:  { label: "Review summaries",   defaultModel: "claude-haiku-4-5", defaultEnabled: true, dailyBudgetUSD: 0.25 },
  commitMessage:  { label: "Commit messages",    defaultModel: "claude-sonnet-5",  defaultEnabled: true, dailyBudgetUSD: 0.50 },
  promptEnhancer: { label: "Prompt enhancer",    defaultModel: "claude-sonnet-5",  defaultEnabled: true, dailyBudgetUSD: 0.50 },
  digest:         { label: "Digests",            defaultModel: "claude-sonnet-5",  defaultEnabled: true, dailyBudgetUSD: 1.00 },
};
export const GLOBAL_DAILY_BUDGET_USD_DEFAULT = 3.0;
```

**`server/src/ai/pricing.ts`** — per-MTok pricing table for the `api`
backend (the cli backend reports `total_cost_usd` itself). Sticker prices:

| model | input | output | cache write | cache read |
|---|---|---|---|---|
| `claude-haiku-4-5` | $1.00 | $5.00 | 1.25 × input | 0.1 × input |
| `claude-sonnet-5` | $3.00 | $15.00 | 1.25 × input | 0.1 × input |
| `claude-opus-4-8` | $5.00 | $25.00 | 1.25 × input | 0.1 × input |

Unknown model → cost 0 with a `priced: false` flag on the ledger entry (never
throw).

**`server/src/ai/usage.ts`** — the ledger:

- Append-only JSONL at `~/.deck/ai-usage.jsonl` (path via `config.deckStateDir`).
  One line per call (success AND failure):
  `{ ts, feature, model, backend, ok, error?, costUSD, inputTokens,
  outputTokens, cacheReadTokens, cacheCreationTokens, durationMs }`.
- On boot, read the file once and keep an in-memory array (cap: keep only the
  last 90 days in memory; the file itself is never truncated — if it exceeds
  5MB, rotate to `ai-usage.<year>.jsonl`).
- `recordUsage(entry)` — append + push in-memory.
- `spentToday(feature?)` — sum of `costUSD` since local midnight, optionally
  per feature. Used for budget gating.
- `usageReport(days)` — aggregates for the admin UI: `{ totalCost,
  byFeature: {feature → {calls, cost, tokens}}, byModel, byDay: [{date, cost,
  calls}], recent: last 100 entries }`.

**`server/src/ai/client.ts`** — the choke point:

```ts
export async function aiComplete(req: AiRequest): Promise<AiResult | null>
```

1. Resolve effective config: `state.aiConfig.features[feature]` overrides →
   `AI_FEATURES` defaults. If disabled → return null (callers must treat null
   as "feature off / over budget / failed" and degrade silently).
2. Budget gates: `spentToday() >= globalDailyBudget` OR
   `spentToday(feature) >= featureBudget` → record a `{ok:false,
   error:"budget"}` marker at most once per feature per day (do not spam the
   ledger) and return null.
3. Dispatch to backend (`state.aiConfig.backend`, default `"claude-cli"`;
   auto-fall back to `"claude-cli"` if `api` is selected but no key found):
   - **claude-cli**: `execFile("cmd", ["/c", bin, "-p", promptWithSystem,
     "--model", model, "--output-format", "json", "--max-turns", "1"],
     { cwd: req.cwd ?? config.aiScratchDir, env: cleanEnv(), windowsHide:
     true, timeout, maxBuffer: 4MB })`. `config.aiScratchDir` = new config
     entry `~/.deck/ai` (mkdir at boot). Parse loose. **Always** dismiss the
     returned `session_id` (gotcha #3) — even for scratch-cwd calls (cheap
     insurance). Cost = `total_cost_usd ?? 0`.
   - **api**: `@anthropic-ai/sdk` (add to `server/package.json`). Client
     constructed lazily once; key from `deck.config.json` `anthropicApiKey`
     ?? `process.env.ANTHROPIC_API_KEY`. `client.messages.create({ model,
     max_tokens, system, messages: [{role:"user", content: prompt}],
     ...(model === "claude-sonnet-5" ? { thinking: {type:"disabled"} } : {}) })`.
     No temperature/top_p ever (gotcha #2). Cost computed from
     `response.usage` × pricing table. Concatenate the `text` blocks.
4. `recordUsage` in a `finally`-style path (failures too, with `ok:false`).
5. Serialize calls per feature with a simple in-flight map (one concurrent
   call per feature; drop, don't queue, a second tick's request).

### State + config

- `state.ts` `DeckState`: add
  `aiConfig: { backend?: AiBackend; globalDailyBudgetUSD?: number;
  features: Record<string, { enabled?: boolean; model?: string;
  dailyBudgetUSD?: number }> }` — default `{ features: {} }` in
  `DEFAULT_STATE` (spread-merge in `loadState` keeps old state files valid).
- `config.ts`: add `aiScratchDir: path.join(home, ".deck", "ai")` and
  `anthropicApiKey: raw.anthropicApiKey ?? null` (extend `RawConfig`).

### Shared types (`shared/src/index.ts`)

```ts
export type AiFeatureId =
  | "blurb" | "tabTitle" | "liveSummary" | "reviewSummary"
  | "commitMessage" | "promptEnhancer" | "digest";

export interface AiUsageEntry { ts: number; feature: AiFeatureId; model: string;
  backend: "claude-cli" | "api"; ok: boolean; error?: string; costUSD: number;
  inputTokens: number; outputTokens: number; durationMs: number; }

export interface AiFeatureConfigView { feature: AiFeatureId; label: string;
  enabled: boolean; model: string; dailyBudgetUSD: number;
  spentTodayUSD: number; callsToday: number; capped: boolean; }

export interface AiUsageReport { totalCost: number; days: number;
  byFeature: Record<string, { calls: number; cost: number; tokens: number }>;
  byModel: Record<string, { calls: number; cost: number }>;
  byDay: { date: string; cost: number; calls: number }[];
  recent: AiUsageEntry[]; }

export interface AiConfigView { backend: "claude-cli" | "api";
  apiKeyPresent: boolean; globalDailyBudgetUSD: number;
  spentTodayUSD: number; features: AiFeatureConfigView[]; }
```

### Routes — `server/src/routes/ai.ts` (register in `index.ts`)

- `GET /ai/usage?days=30` → `AiUsageReport`
- `GET /ai/config` → `AiConfigView`
- `PATCH /ai/config` body `{ backend?, globalDailyBudgetUSD?, feature?,
  enabled?, model?, dailyBudgetUSD? }` (when `feature` present, the other
  fields apply to that feature) → `AiConfigView`. Validate `model` against
  an allowlist: `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-4-8`.
- `POST /ai/test` → runs `aiComplete({feature:"blurb", prompt:"Reply with
  exactly: ok"})` and returns the `AiResult` (or 502) — the admin "Test"
  button.

### Migrate the blurb route

`routes/projects.ts` `/projects/:id/blurb`: replace the inline `execFile`
with `aiComplete({ feature: "blurb", prompt, cwd: p.path, timeoutMs:
180_000 })`. Keep the same response shape. This gives blurbs cost tracking
and fixes the ghost-card bug via the session dismissal in the client.

### Client — AI Admin

- `web/src/views/AiAdminView.tsx`, wired as a top-level view exactly the way
  `LibraryView` is being wired (uiStore top-level view mechanism + Sidebar
  footer icon `Sparkles` + CommandPalette entry "AI Admin"). Content:
  - Header stat tiles: spent today / last 7d / last 30d, calls today,
    global budget with inline edit.
  - **Feature table** (the heart): one row per feature — label, enabled
    Switch, model `<select>` (haiku/sonnet/opus), per-day budget input,
    calls + spend today, amber "capped" chip when `capped`.
  - Daily spend bar chart (30d) — plain divs sized by value are fine, tokens
    palette, read `dataviz` skill first.
  - Recent-calls table (time, feature, model, tokens in/out, cost, ms,
    ok/error) — plain rows, cap 100, no virtualization needed.
  - Backend selector (claude-cli / API) with "API key detected: yes/no".
  - "Test" button → `POST /ai/test`, toast the round-trip result + cost.
- `web/src/lib/api.ts`: `aiUsage(days)`, `aiConfig()`, `patchAiConfig(body)`,
  `aiTest()`.
- `web/src/lib/useAi.ts`: `useAiConfig()` / `useAiUsage(days)` react-query
  hooks (30s stale, like `useCost`).

### Verify (M7)

`POST /ai/test` returns text + a nonzero-or-zero cost; the call appears in
`~/.deck/ai-usage.jsonl` and in the admin recent table; toggling a feature
off makes its `aiComplete` return null; regenerating a Library blurb leaves
NO new agent card in that project's Agents tab; typecheck passes.

---

## M8 — Attention Inbox

One global queue of "needs you": agents waiting on a permission prompt or
question, and sessions that finished while you weren't looking. Triage
without opening tabs.

### Server

- **Prompt-tail extraction (owned claude sessions only, v1).**
  `pty/manager.ts`: expose `tail(id: string, maxBytes = 4096): string`
  reading from the existing 2MB RingBuffer. `sessions/manager.ts`: in the 5s
  status ticker, when an owned claude session's status is `attention`,
  compute `promptTail`: strip ANSI (regex `/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g`
  — no new dep), split lines, drop empties/box-drawing-only lines, keep the
  last 12. Attach to the session and publish `sessions.updated` when it
  changes (compare joined string).
- **Shared type**: `Session.promptTail?: string[] | null`.
- No new routes: the inbox derives client-side from the sessions store
  (statuses + `unread` already stream over `/ws/events`).

### Client

- `web/src/components/inbox/InboxPanel.tsx` — right-side slide-over (fixed,
  width 380, border-l hairline, raised bg), toggled by:
  - a Bell `IconButton` in the Sidebar header with a count badge
    (`attention count + unread count`, accent dot style like the favicon
    badge), and
  - global key **Ctrl+I** (add to `useGlobalKeys`), Esc closes.
- Item derivation (a `useInboxItems()` selector in
  `web/src/lib/useInbox.ts`):
  - kind `attention`: `status === "attention"` (any source).
  - kind `finished`: owned sessions with `unread && status === "idle"`.
  - kind `exited`: owned sessions `status === "exited" && exitCode !== 0`.
  - (M11 adds kind `review`; M15 adds kind `budget` — design the card row to
    take a kind icon + accent color.)
  - Sort: attention first, then finished, then exited; newest `activityAt`
    first within a kind.
- Card contents: kind icon, project name (small, t3), session title
  (`aiMeta?.title ?? title ?? name` — M12-aware), `lastActivityLine`, and for
  `attention` items with `promptTail`: the tail rendered in a mono
  `bg-raised` block (max-height ~10 lines, overflow-y auto).
- **Quick respond** (attention + owned only): when the tail matches
  `/❯|Do you want|\by\/n\b|Yes.*No/i`, show buttons `1` `2` `3` `Esc` `y+⏎`
  plus a one-line text input. Each sends via the existing input path
  (`api.sendInput` / POST `/sessions/:id/input`): digits/letters as-is, Esc
  as `\x1b`, text input as `text + "\r"`. Answering from the card must NOT
  open the tab.
- Row actions: **Open** (existing open-session-tab path; clears unread),
  **Dismiss** (finished/exited: clear unread — add tiny route
  `POST /sessions/:id/read` that clears the unread flag and republishes;
  attention external: existing dismiss path).
- Keyboard: ↑/↓ or j/k moves focus ring, Enter opens, x dismisses.

### Verify (M8)

Spawn a claude, ask it to do something requiring a permission prompt → bell
badge within ~5s; the actual prompt text is readable in the card; pressing
`1` in the card answers it (terminal shows the selection) without the tab
opening; a session that finishes while you're elsewhere shows as `finished`
and Open clears it.

---

## M9 — Global transcript search + resume

Full-text search across every transcript on the machine (all 133+ and
growing), globally and per-project — and resume any hit as a live session.

### Server

- New dep (server): `better-sqlite3`. DB file `~/.deck/search.db`, WAL mode.
- **`server/src/search/indexer.ts`**:
  - Schema:
    ```sql
    CREATE TABLE IF NOT EXISTS files(file TEXT PRIMARY KEY, mtimeMs REAL, size INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(sessionId TEXT PRIMARY KEY, projectId TEXT,
      file TEXT, title TEXT, lastTs REAL, model TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS events USING fts5(
      text, sessionId UNINDEXED, projectId UNINDEXED, eventIdx UNINDEXED,
      kind UNINDEXED, ts UNINDEXED);
    ```
  - `indexFile(file, projectId)`: skip if `files` watermark (mtime+size)
    matches. Parse with the transcript **parser directly** (`parser.ts`), NOT
    `registry.getParsed` — don't evict the UI's LRU-24 cache. Delete existing
    rows for that sessionId, then insert one row per *searchable* event:
    user text, assistant text, tool titles, and edit file paths. Skip
    thinking bodies and raw tool_result dumps (index size). `eventIdx` = the
    event's index in `ParsedTranscript.events` (this is what the Feed jump
    uses). Update `sessions` row (title = ai-title, model, lastTs). Wrap each
    file in one transaction.
  - Boot: after `startServices`, walk every transcript file for every known
    project (locator) **incrementally** (`setImmediate`-chunked loop, ~5
    files per tick) so startup isn't blocked. Log a one-line summary when the
    initial sweep completes.
  - Live: hook the existing central change point —
    `transcriptRegistry.onFileChanged` — debounce 2s per file, re-index.
- **`server/src/routes/search.ts`** (register in `index.ts`):
  - `GET /search?q=&projectId=&limit=30` → `SearchHit[]`. Build the FTS query
    by quoting each whitespace-separated term (`"foo" "bar"` → AND) — never
    interpolate raw user input into fts5 syntax. Use `snippet(events, 0,
    '', '', '…', 12)` (private-use sentinels the client swaps for
    `<mark>` — avoids HTML injection). Order by `rank`. Join `sessions` for
    title/lastTs.
  - `GET /search/sessions?q=&projectId=` → title/name matches (LIKE over the
    `sessions` table + `state.sessionNames`), for "find that session called
    X".
- Shared: `SearchHit { sessionId, projectId, title: string | null,
  snippet: string, ts: number, eventIdx: number, kind: string }`.

### Client

- **`web/src/components/SearchDialog.tsx`** — a dedicated dialog (the palette
  stays snappy): opened via **Ctrl+Shift+F**, palette entry "Search
  transcripts…", and a search icon in the Sidebar header. Also reachable
  per-project (AgentsTab history header gets a search input that opens the
  dialog pre-scoped with `projectId`).
  - Debounced 200ms query; results grouped by session: group header =
    project · title · relTime + a **Resume** button; rows = snippet with the
    sentinel chars rendered as accent-tinted `<mark>` spans (build React
    nodes by splitting on sentinels — never `dangerouslySetInnerHTML`).
  - Enter/click on a row → open that session **at that event**:
    - If the session is live (in sessionsStore) → open its tab.
    - Else → the same read-only-feed restore path AgentsTab history rows use.
    - Jump: add an optional transient `feedJump: { sessionId, eventIdx } |
      null` to uiStore (NOT persisted); `Feed.tsx` consumes it after load —
      virtualizer `scrollToIndex(eventIdx)` + a 2s accent background flash on
      the row, then clears it.
  - **Resume** → existing adopt machinery (`claude --resume <transcriptId>` —
    `sessionManager.resumeTranscript` already does exactly this and works for
    arbitrary-age transcripts). Opens as a new owned session tab.
- `api.search(q, projectId?)`, `api.searchSessions(q, projectId?)`.

### Verify (M9)

Boot sweep indexes all transcripts with zero crashes (tolerant parser);
searching a phrase you remember from weeks ago in another project returns a
hit in <300ms; clicking lands the feed scrolled to the exact message with a
flash; Resume produces a live claude that remembers the conversation; editing
happens live (send a message in a session, search a word from it ~5s later).

---

## M10 — Root pseudo-project (`G:\code` itself)

Bespoke sessions run from the root dir get a home: a project card for
`config.root` with **agents + terminals only** — no git, no files.

### Server

- Shared: `ProjectSummary.kind?: "normal" | "root"` (optional → degrades).
- `projects/registry.ts`: synthesize a constant entry
  `{ id: "__root__", path: config.root, name: "~ code", kind: "root",
  branch: null, dirtyCount: null, aheadBehind: null, ... }` — present in
  `list()`/`getById()`/`getPath()` but **excluded** from git refresh, watcher
  tiers (root/repo/git-heartbeat), and the scanner (scanner never emits it;
  registry owns it). `activityAt`: max mtime of its *unclaimed* transcript
  dirs (below), else 0.
- **Transcript mapping — the subtle part.** `locator.ts`
  `transcriptDirsForProject(G:\code)` would prefix-match EVERY project's
  dirs. Add:
  ```ts
  // Dirs under claudeProjectsDir that match `encodePath(root)` but are NOT
  // claimed by any real project's longer prefix.
  export function unclaimedRootTranscriptDirs(realProjectPaths: string[]): string[]
  ```
  (build the encoded index from real projects only; a dir belongs to root iff
  `matchDirToProject(dir, realIndex) === null` and it matches
  `encodePath(config.root)` exactly-or-with-`-`). `transcripts/registry.ts`:
  when asked for `__root__`, use this instead of the normal per-project path.
  This automatically adopts past bespoke sessions run from `G:\code` AND from
  non-git subdirs like `G:\code\scratch`.
- Sessions: `sessionManager.create({projectId: "__root__"})` works because
  `getPath` returns `config.root` (pty cwd = G:\code). Nothing else changes.
- Routes: `routes/git.ts` + `routes/files.ts` → early `400 {error: "root
  project has no git/files"}` for `__root__`. `pin`/`hide` → 400.

### Client

- Sidebar: render a **fixed row** for the root project at the top of the
  PROJECTS section (above groups; excluded from grouping/DnD/hide/pin; still
  shows running-session count dot). Icon: `SquareTerminal`.
- `ProjectShell`: `const views: ProjectViewKind[] = p.kind === "root" ?
  ["agents"] : ["agents", "git", "files"]` — uiStore's default-tabs init
  takes an optional views list (extend `openProject(projectId, view?,
  views?)`); header hides branch/dirty/Explorer-WebStorm buttons for root
  (keep Explorer actually — opening G:\code in Explorer is useful; hide
  WebStorm + git chips).
- CommandPalette: root project appears like any project.

### Verify (M10)

"~ code" row present; spawning claude + shell there lands in `G:\code`; a
historical bespoke session run from `G:\code` shows in its Agents history and
resumes; no Git/Files tabs; no watcher errors in server log.

---

## M11 — Review queue ("what changed while I was away")

When an owned claude finishes a burst of work, capture *which files it
touched* and a one-line AI summary, and surface it as an inbox card that
jumps you into the Git tab.

### Server

- `server/src/reviews/service.ts`:
  - Hook: `sessions/manager.ts` status ticker — detect owned-claude
    transition `working → (idle | attention)` (the ticker already tracks
    per-session prior status via `lastKey`; extend it to remember prior
    status explicitly).
  - On transition: get the parsed transcript (registry cache is fine here),
    collect `filesTouched` = unique file paths from Edit/Write/MultiEdit
    events **since the last review checkpoint for this session** (store
    per-session `lastReviewedEventCount` on the item). If empty → no item.
  - Upsert `ReviewItem { id: sessionId, sessionId, projectId, ts,
    files: string[], summary: string | null, dismissed: false }` into
    `state.reviews: Record<string, ReviewItem>` (add to DeckState, cap 100 by
    ts). Fire `aiComplete({feature: "reviewSummary", prompt})` async — prompt
    = last assistant text (≤2000 chars) + file list → "One sentence, past
    tense, ≤120 chars, describing what was changed. Output only the
    sentence." Patch the item + rebroadcast when it lands.
  - Broadcast: `{t: "reviews.updated", payload: ReviewItem}` on the
    `sessions` topic (add to `WsServerMsg`).
- Routes (`routes/sessions.ts` or new `routes/reviews.ts`):
  `GET /reviews` → active (non-dismissed) items; `POST /reviews/:id/dismiss`.
- Shared: `ReviewItem` as above.

### Client

- Inbox (M8) gains kind `review`: card = "✏ {agent title} · {project}" +
  summary + file chips (mono, first 4 + "+N"). Buttons: **Review** → opens
  the project's Git tab with the first file focused; **Dismiss**.
- Git-tab focus: transient `uiStore.gitFocusPath: {projectId, path} | null`
  (not persisted); `GitTab` consumes it → selects that file in StatusList /
  opens its diff, then clears.
- Small store `web/src/stores/reviewsStore.ts` (replace-by-id, bootstrapped
  from `GET /reviews`, updated by `ws.ts` on `reviews.updated`).

### Verify (M11)

Ask an agent to edit two files; when it goes idle, a review card appears
within ~10s listing exactly those files; the summary sentence arrives shortly
after (haiku); Review opens the Git tab focused on the file; Dismiss persists
across a reload.

---

## M12 — AI tab titles + live session summaries

Tabs that rename themselves to what's *actually happening*, refreshed every
~2 minutes, only when content changed, only for sessions you're looking at.
Haiku; every call in the M7 ledger.

### Server — `server/src/ai/liveMeta.ts`

- Shared: `Session.aiMeta?: { title: string; summary: string; at: number } |
  null`.
- Ticker: every **120s** (constant), started in `services.ts`:
  1. Candidates: all live **owned** sessions + external sessions whose
     `transcript:<id>` topic currently has subscribers (add
     `eventHub.hasSubscribers(topic)` — the refcounts already exist). This
     bounds spend to sessions with an open tab/feed.
  2. Change gate: claude-backed → compare `status.ts eventSignature` with the
     last one this ticker saw (separate map — do NOT touch `emittedSigs`, see
     M4 critical fix #2). Shell terminals → hash (`crypto` sha1) of the last
     4KB of ring-buffer tail. Unchanged → skip.
  3. Context: claude → last 25 events rendered compactly (`role: first 300
     chars`, tool events as `tool: <title>`); shell → ANSI-stripped last 3KB
     of tail.
  4. `aiComplete({feature: "tabTitle", json: true, maxTokens: 200, prompt})`:
     "You label a terminal tab in a dev dashboard. From this recent session
     activity, output JSON: {\"title\": string (≤5 words, telegraphic, no
     quotes/emoji/trailing period), \"summary\": string (one present-tense
     sentence ≤140 chars: what is happening right now)}. Output ONLY the
     JSON." Loose-parse; on parse failure skip (no retry).
  5. Store: owned → a map in sessionManager folded into `toSession`;
     external → a map in transcriptRegistry keyed by transcript id, folded
     into its `toSession`/`describe`. Publish `sessions.updated`.
- One feature (`tabTitle`) covers both title+summary — a single call returns
  both; `liveSummary` remains a separate ledger feature ONLY if you later
  split cadence; v1: use `tabTitle` for the combined call and delete
  `liveSummary` from M7's registry if unused (implementer's choice — keep the
  registry honest).

### Client

- Tab strip (`ProjectShell`): session tab label = user rename wins, else
  `aiMeta.title`, else `name`. **User-rename detection**: the auto-generated
  default name matches `/ (sh|cc)·[0-9a-f]{4}$/` — if `session.name` does NOT
  match that pattern, the user (or ai-title) named it → still prefer aiMeta
  only when name matches the default pattern. Tooltip on the tab: summary +
  full default name.
- `AgentsTab` live cards: summary as the activity line's fallback (keep the
  real `lastActivityLine` when status is `working`; show summary when idle).
- `SessionHeader`: summary as a t3 subtitle under the title.
- Sidebar `SessionRow`: same title precedence.

### Verify (M12)

Two sessions doing different things get distinct, sensible titles within
2.5 min; an idle untouched session triggers NO further calls (check admin
recent-calls); per-call cost shows fractions of a cent at haiku pricing; the
daily budget cap flips the feature to "capped" in admin when exceeded (test
by setting budget to $0.001).

---

## M13 — Prompt recipes, prompt enhancer, commit-message generation

### Recipes (no AI — pure CRUD + insertion)

- State: `state.recipes: Recipe[]` — `Recipe { id, name, body, tags:
  string[], createdAt, lastUsedAt: number | null, useCount: number }`. Shared
  type + routes: `GET/POST /recipes`, `PATCH/DELETE /recipes/:id`,
  `POST /recipes/:id/used` (bumps counters). Broadcast not needed (single
  client; refetch on mutate via react-query invalidation).
- Client:
  - `web/src/components/recipes/RecipesDialog.tsx` — manage: list sorted by
    useCount, inline rename, body textarea (mono), tags chips, delete with
    confirm. Opened from Settings + palette ("Manage recipes").
  - **Composer** (`components/session/Composer.tsx`): a `BookMarked` icon
    button → dropdown (fuzzy filter input at top) → inserts recipe body at
    cursor. Plus a "Save draft as recipe…" item when the textarea is
    non-empty.
  - **Palette**: `Recipe: <name>` entries. If the active tab is a claude
    session → insert into its composer. Otherwise → sub-prompt to pick a
    project → **spawn claude with the recipe as the initial prompt** (below).
- **Spawn-with-initial-prompt** (needed here + M16 + M17):
  `CreateSessionInput.initialPrompt?: string`. Implementation: pass the
  prompt as a **positional CLI argument** — `claude "<prompt>"` starts the
  interactive TUI with that prompt submitted as the first message. In
  `pty/manager.ts` claude spawn, append the prompt as the final argv element
  (after any `claudeArgs`). NO pty-typing hacks. Verify once manually that
  the installed claude version submits a positional prompt in interactive
  mode; if it doesn't, fallback: write `prompt + "\r"` to the pty 2500ms
  after the first output chunk (flag which path was used in a code comment).
  Expose through `POST /sessions` body + `api.createSession` +
  `lib/sessions.ts spawnSession(projectId, kind, {initialPrompt})`.

### Prompt enhancer (sonnet)

- Route: `POST /ai/enhance` body `{ prompt, projectId? }` →
  `aiComplete({feature: "promptEnhancer", maxTokens: 1500, system, prompt})`.
  System: "You rewrite rough prompts into clear instructions for a coding
  agent. Preserve the author's intent exactly — do not invent requirements
  or expand scope. Add structure only where it helps: goal, key constraints,
  acceptance criteria if clearly implied. Match the original's language.
  Output ONLY the rewritten prompt text." When `projectId` present, prefix
  the user content with one line: `Project: <name> (<path>)`.
- Client (Composer): a `Sparkles` button beside send. Click → spinner →
  result opens in a popover: original (dim) above, enhanced below, buttons
  **Use enhanced** (replaces textarea) / **Keep mine** / **Retry**. Do not
  auto-replace.

### Commit-message generation (sonnet)

- Route: `POST /projects/:id/git/commit-message` body `{ style: "terse" |
  "conventional" | "verbose" }` → `{ message: string }`.
  - Context build (in `git/service.ts`, new fn `diffForAi()`): if staged
    changes exist → `git diff --cached`, else `git diff` + untracked file
    list from status. Truncate: 300 lines per file, 60KB total (mark
    truncations with `…[truncated]`). Plus `git log -10 --pretty=%s` as
    style reference, plus `git status --porcelain=v2` summary line counts.
  - System per style — terse: "Output a single-line commit subject, ≤60
    chars, imperative, matching the style of the recent subjects provided.
    No body, no quotes." conventional: "Output a Conventional Commits
    message: `type(scope): subject` ≤72 chars, then a blank line and a 1–3
    bullet body only if the change is non-trivial." verbose: "Output a
    commit subject ≤72 chars, a blank line, then a bullet-point body
    describing each meaningful change (what + why), one bullet per concern."
  - Prompt: the diff + recent subjects. Feature `commitMessage`.
- Client (`components/git/CommitBox.tsx`): a `Sparkles` **split button**
  next to Commit — main click uses the last style, chevron opens
  Terse / Conventional / Verbose (persist last style in uiStore prefs).
  Fills the message textarea (replacing content, keeping focus), shows
  spinner while generating, and a small regenerate icon appears after. If
  nothing is staged AND worktree is clean → button disabled.

### Verify (M13)

Save a recipe, insert it from the composer AND launch it from the palette
into a fresh claude (first message pre-submitted); enhance turns "fix the
tab thing" into a structured prompt without inventing scope; stage one hunk
→ terse message accurately names the change and matches repo subject style;
all three features itemized in AI admin.

---

## M14 — Daily / on-demand digest

"What got done" across all projects — on demand, and optionally at a
scheduled time.

### Server — `server/src/digest/service.ts`

- `generateDigest(fromMs, toMs): Promise<{markdown, path}>`:
  1. Per visible project: commits in window (`git log --since=<iso>
     --until=<iso> --pretty=format:%h|%s|%an` — via git service, skip
     projects with none quickly), sessions active in window (transcript
     files with mtime in window → title/aiMeta/stats/filesTouched), project
     cost (from `getCostReport()` projects + daily rows in window).
  2. Skip projects with no commits AND no sessions.
  3. Single `aiComplete({feature: "digest", maxTokens: 4000, prompt})` with
     all gathered context rendered compactly (cap total prompt ~40KB;
     per-project cap 2KB, most-active first). System: "Write a standup-style
     digest in Markdown. Sections: `## Highlights` (3–6 bullets, most
     important first), `## By project` (### per project: commits, agent
     work, unfinished threads), `## Spend` (one line per notable cost).
     Be concrete — name files, commits, sessions. No filler, no praise."
  4. Write `~/.deck/digests/<YYYY-MM-DD>-<n>.md`; return markdown + path.
- Routes: `POST /digest` body `{range: "today" | "yesterday" | {hours: n}}`;
  `GET /digests` → `[{name, ts}]`; `GET /digests/:name` → markdown.
- Schedule (optional, config-gated): `deck.config.json` `digestAt: "18:00"`
  → a minute-interval check in `services.ts`; on fire, generate for `today`
  and broadcast `{t: "digest.ready", name}` (projects topic).

### Client

- `web/src/views/DigestView.tsx` — top-level view (palette "Daily digest" +
  Sidebar footer `Newspaper` icon). Left rail: history list from
  `GET /digests`. Main: rendered markdown (lib/markdown + .deck-md). Header:
  **Generate** split button (Today / Yesterday / Last 24h) with progress
  state (digest can take ~30–60s — show an inline "reading N projects…"
  shimmer; the POST resolves when done).
- `digest.ready` WS → toast + (if M8 landed) an inbox card kind `digest`
  linking to the view.

### Verify (M14)

After a day with real commits + agent sessions, Today's digest names actual
commit subjects, session titles, and per-project costs; file lands in
`~/.deck/digests/`; the sonnet call (one) shows in AI admin at its real cost.

---

## M15 — Cost expansion

Builds on the committed cost feature (`server/src/cost/service.ts`,
`routes/cost.ts`, `web/src/lib/useCost.ts`,
`web/src/components/cost/CostsDashboard.tsx`). Verify what the dashboard
already renders before adding — extend, don't duplicate.

1. **Budgets.** `state.budgets: { monthlyUSD: number | null; blockUSD:
   number | null }` + `PATCH /cost/budgets`. Dashboard: month-to-date total
   (sum `daily` for current month) vs `monthlyUSD` as a progress bar (amber
   >80%, red >100%). Active-block chip (wherever it lives — Sidebar footer):
   same tinting vs `blockUSD` using `activeBlock.projection.totalCost`.
2. **Block alert → Inbox.** When `activeBlock.projection.totalCost >
   blockUSD` (and budget set), emit ONE inbox item per block id (client-side
   derivation in `useInbox` from the cost report — no server change): kind
   `budget`, "Current block projected $X by {endTime}".
3. **Block countdown.** The active-block chip shows `mm` remaining to
   `endTime` (tick locally, no extra fetches); tooltip: cost so far, burn
   $/h, projected total.
4. **Deck-internal AI as a row.** `cost/service.ts`: after building the
   report, append a synthetic `ProjectCost` `{projectId: "__deck_ai__",
   cost, totalTokens, sessionCount: callCount}` from M7's
   `usageReport(30)`, and add its per-day costs into a new
   `DailyCost.aiCost?: number` field (keep `cost` as-is; render stacked).
   Dashboard renders the row with a `Sparkles` icon + link to AI Admin.
5. **Trends.** Extend `DailyCost` with `byModel?: CostModelBreakdown[]`
   (ccusage `daily` already returns modelBreakdowns — currently discarded).
   Dashboard: 30-day bars stacked by model (read `dataviz` skill; tokens
   palette; legend chips). Add a per-model mix donut only if trivial —
   otherwise skip.
6. **Cost chips in context.** SessionHeader: session cost chip via
   `useSessionCost(transcriptSessionId)` (if not already). Library card /
   ProjectRow hover: month-to-date project cost via `useProjectCost`.

### Verify (M15)

Set `blockUSD` to $0.01 → chip goes red + one inbox card; `__deck_ai__` row
total matches AI admin's 30-day total; stacked daily bars sum to the same
totals as before the change.

---

## M16 — Cliffnotes tab + generate

`cliffnotes.md` is the user's convention in every repo — render it as a
first-class project view, and bootstrap it with a visible agent session when
missing.

### Client (this is mostly client work)

- `ProjectViewKind` += `"notes"`; `VIEW_META.notes = { label: "Notes",
  icon: BookOpen }`. Default views for normal projects become
  `["agents", "notes", "git", "files"]`? **No — keep default tab creation as
  is** and add `notes` to `DEFAULT_VIEWS` only if uiStore migration is
  trivial (persisted projectTabs won't have it; add an idempotent
  ensure-view-tabs step in `openProject` that appends missing view tabs).
  Root project (M10) excludes it.
- `web/src/components/project/NotesTab.tsx`:
  - Load via existing files API: try `cliffnotes.md`, `CLIFFNOTES.md`
    (`api.file` 404 → next). A `ui.md` / `UI.md` toggle chip appears when
    that file exists.
  - Render with `lib/markdown` into a `.deck-md` container (max-w readable,
    padding, own scroll with `scrollbar-gutter: stable`).
  - Refetch on tab activation and on `git.updated` for the project (cheap
    invalidation — the repo watcher is already live while the project is
    open).
  - Header row: file name, relTime of last fetch, **Edit** button → opens
    the Files tab with the file selected (reuse `gitFocusPath`-style
    transient: `filesFocusPath`).
  - **Missing state**: EmptyState — "No cliffnotes.md — the living map of
    this repo." Button **Generate cliffnotes** →
    `spawnSession(projectId, "claude", { initialPrompt })` (M13 mechanism)
    with:
    > "Read the cliffnotes skill at `~/.claude/skills/cliffnotes/SKILL.md`
    > and its templates, then generate `cliffnotes.md` (and `ui.md` if this
    > project has a real UI) for this repository, following the skill's
    > create-from-scratch workflow (§5)."
    The session opens as a normal tab — that's the "stream in": you watch it
    work. NotesTab remembers the spawned session id (component state) and
    shows "Generating — watching <tab>…" with a poll (`api.file` every 5s)
    that flips to the rendered doc when the file appears.
- This intentionally uses a **visible interactive session** (user's own
  subscription/tools), NOT the M7 ledger — note it in the UI copy ("runs as
  a normal agent session").

### Verify (M16)

Project with cliffnotes → Notes tab renders it, ui.md toggle works, edits in
another editor show after a git touch or tab re-focus; project without →
Generate spawns a claude tab you can watch, and Notes flips to the rendered
file when it's written.

---

## M17 — Task board

### Design exploration (decide, then build the MVP below)

Three flavors were considered:

- **A. Manual kanban** (Trello-like; sessions optionally attached). Max
  control, but you'd maintain the board by hand — Deck becomes chores.
- **B. Fully derived board** (columns are just session status; zero new
  state). Zero maintenance, but no Backlog — can't queue work that hasn't
  started, which is the whole point.
- **C. Hybrid (CHOSEN):** you only hand-manage the *pre-run* columns
  (Backlog, Queued); every column after that is **derived from the linked
  session's live status**. A card is a prompt waiting to run; starting it
  spawns an agent; from then on the board updates itself. The "do even
  less" lever is an opt-in autopilot that drains the queue.

Columns: `Backlog → Queued → Running → Needs you → Review → Done`.
- Backlog/Queued: manual (DnD between them; order persisted).
- Running: card has `sessionId` and session status is `working`/`idle`.
- Needs you: session status `attention` (mirrors Inbox).
- Review: session idle AND an active M11 ReviewItem exists for it.
- Done: session exited/closed, review dismissed/committed, or manual drag
  (manual drag to Done also closes the session if still alive — confirm
  first).

### Server

- Shared: `TaskCard { id, title, body, projectId, recipeId: string | null,
  sessionId: string | null, createdAt, startedAt: number | null,
  doneAt: number | null, order: number, status: "backlog" | "queued" |
  "done" | "linked" }` — note only pre-run + done are stored; `"linked"`
  means "derive my column from the session".
- State: `state.tasks: TaskCard[]` (cap 200; prune oldest done).
- Routes `routes/tasks.ts`: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`
  (title/body/project/order/status for manual moves), `DELETE /tasks/:id`,
  and **`POST /tasks/:id/start`** → `sessionManager.create({ projectId,
  kind: "claude", name: task.title, initialPrompt: task.body })` (M13),
  set `sessionId`, `status: "linked"`, `startedAt`. Broadcast
  `{t: "tasks.updated", payload: TaskCard}` on the sessions topic.
- Autopilot (config-gated, default OFF): `state.autopilot: { enabled:
  boolean; maxRunning: number }` (default `{enabled:false, maxRunning:2}`).
  A 15s check in services.ts: if enabled and
  `count(linked tasks with live working sessions) < maxRunning` and a queued
  task exists → start the top one. PATCH via `/tasks/autopilot`.

### Client

- `web/src/views/BoardView.tsx` — top-level view (palette "Task board" +
  Sidebar footer `Kanban` icon). Six columns, horizontal scroll on narrow.
  Native HTML5 DnD exactly like Sidebar groups (dragRef + drop rings) —
  legal drops: Backlog↔Queued (+ reorder within), anything → Done.
  Illegal drops no-op with a shake.
- Card: title, project chip, status dot (linked), `aiMeta.summary` line
  (M12), cost chip (`useSessionCost`), file-count chip when a ReviewItem
  exists. Click → opens the session tab (linked) or an edit popover
  (backlog/queued). Right-click: Start now / Edit / Delete.
- New-card composer (top of Backlog): title input, project picker
  (fuzzy), body textarea with the M13 recipe-insert + enhance buttons
  reused from Composer (extract those into
  `components/prompt/PromptToolbar.tsx` shared by both).
- "Needs you" column cards get the M8 quick-respond row inline.
- Autopilot toggle in the board header with `maxRunning` stepper; when ON,
  show a subtle pulsing dot — this thing spends money on its own.
- `tasksStore.ts` (replace-by-id + `tasks.updated` in ws.ts).

### Verify (M17)

Create 3 backlog cards → queue 2 → Start one manually: claude spawns with
the card body pre-submitted and the card slides to Running by itself; when
the agent asks a question the card moves to "Needs you" and answering from
the card works; when it finishes with edits it lands in Review with the
file-count chip; autopilot ON with maxRunning=1 starts the next queued card
only after the first finishes.

---

## Deferred (explicitly out of scope for v2)

- **Worktree fan-out** (agents in `git worktree`s under the project) — user
  wants it *later*; when it lands it should slot into M17 as per-card
  isolation.
- Phone remote / push notifications; Electron tray tier; session replay;
  auto-answering permission prompts (never without an explicit opt-in
  design).
