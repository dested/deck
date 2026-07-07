# Deck — CliffNotes

> Living map of Deck, a localhost mission-control web app for projects + Claude
> Code agents. Read this before any coding session. Spec of record: `SPEC.md`
> (locked). Build order: milestones M0→M6 in SPEC §13.

Last updated: M0–M6 complete + verified (2026-07-04); **V2 M7–M17 built**
(2026-07-05, typecheck + prod build green, live UI unverified — see V2 section).
**V3 M18–M20 built** (2026-07-05, no spec — built direct; see V3 section).
**Task board rewritten to v3 "Focus Stack"** (2026-07-07: kanban columns
replaced by NOW-hero/on-deck/grouped-pile stack + triage mode + edit side-panel
+ Life bucket + rail Focus block — see its section).
**Bulletproofed** (2026-07-06): crash guard + supervisor auto-restart + durable
scrollback/state — see the Bulletproofing section.
**Expanded mission-control sidebar** (2026-07-07): two-mode rail + per-agent
original-prompt (`Session.firstPrompt`) — see its section.
**PR Audit** (2026-07-07): AI pre-merge report + Q&A in the Git tab — see its
section.
**Transcript feed → CC terminal look** (2026-07-07): the read-only agent feed
now renders like Claude Code's own terminal (monospace, `●` bullets, `⎿` result
branches) — see its section.
**Public-release prep** (2026-07-07): real README + LICENSE + mocked
screenshots + PII scrub — see its section.

**V2 feature spec: `SPEC2.md`** (2026-07-05) — M7–M17: **all built** (typecheck
+ prod web build green; live UI not yet exercised). See the V2 section below.

---

## V2 — the AI layer (M7–M17) built 2026-07-05

All eleven milestones implemented. Both packages `bun run typecheck` clean and
`web` prod-builds. **Needs a server restart** (new `state.json` shape — degrades
gracefully via spread-merge + `loadState` backfill of `aiConfig/budgets/
autopilot/reviews/recipes/tasks`) and a `bun install` (added deps below). Live
browser flows not yet verified.

**New deps:** `@anthropic-ai/sdk`, `better-sqlite3`, `@types/better-sqlite3`
(server); `@radix-ui/react-popover` (web).

**M7 — AI service choke point.** Every Deck-internal AI call goes through
`server/src/ai/client.ts` `aiComplete(req)`: per-feature model (`ai/models.ts`
registry — haiku for high-freq, sonnet for quality; never opus by default),
daily budget gates (per-feature + global), append-only JSONL ledger
(`ai/usage.ts` → `~/.deck/ai-usage.jsonl`, 90d in memory, rotates at 5MB), two
backends (`claude-cli` default; `api` via SDK, auto-falls back to cli w/o key).
**CLI prompt goes via STDIN** (`claude -p` reads stdin) to dodge Windows' ~8KB
cmd-line limit + quoting — deviation from SPEC2's arg-passing, needed for big
commit-diff/digest prompts. Always dismisses the `-p` transcript's `session_id`
(no ghost card). `cleanEnv()` now lives in `server/src/lib/cleanEnv.ts` (pty
re-exports). Routes `routes/ai.ts`: `GET /ai/usage|config`, `PATCH /ai/config`,
`POST /ai/test|enhance`. Blurb route migrated onto `aiComplete`. Admin UI
`web/src/views/AiAdminView.tsx` (top-level view). Config: `aiScratchDir`
(`~/.deck/ai`), `anthropicApiKey`, `digestAt`.

**M12 — AI tab titles/summaries.** `ai/liveMeta.ts` **20s** ticker (was 120s +
open-tab-only, revised 2026-07-07) labels **every live session the sidebar
shows**: owned live sessions + **all `externalSessions()` (<30min)** — no longer
gated on a subscribed feed, so a card never sits on its raw `proj cc·1a2b`
default while active. Kept cheap by: haiku (`tabTitle` feature, budget bumped
0.5→$1.0/day), a change-gate (transcript sig), a **per-session 60s cooldown**
(`shouldLabel`, so a busy session isn't re-billed every tick), and a lean
context (last 12 events ≤200 chars each, anchored with `goal:` = `firstPrompt`).
**Shell terminals are one-and-done** — labelled ONCE from their pty tail
(`terminalDone` set, marked only on a real label), then never re-run (a
terminal's purpose doesn't drift). `Session.aiMeta`. Client title precedence via `lib/sessions.ts
displayTitle()` (user rename > aiMeta.title > default name matching
`/ (sh|cc)·[0-9a-f]{4}$/`). Budget trip is graceful — card keeps its last title.

**M8 — Attention Inbox.** `pty/manager.tail()`, prompt-tail extraction in the 5s
status ticker (`Session.promptTail`), `POST /sessions/:id/read`. Client
`components/inbox/InboxPanel.tsx` (right slide-over, Ctrl+I, Rail bell badge),
`lib/useInbox.ts` derives items (attention/finished/exited + M11 review + M15
budget) client-side. Quick-respond sends via `sendInput`.

**M9 — transcript search.** `search/indexer.ts` (better-sqlite3 FTS5 at
`~/.deck/search.db`, boot sweep 5-files/tick, live re-index debounced 2s off the
transcript change hook). `routes/search.ts` (`GET /search`, `/search/sessions`).
Snippet sentinels **U+E000/U+E001** (client → `<mark>`, no innerHTML).
`components/SearchDialog.tsx` (Ctrl+Shift+F / palette / AgentsTab history).
`uiStore.feedJump` → `Feed.tsx` scrolls to the event + 2s flash. Resume =
`resumeTranscript`.

**M11 — review queue.** `reviews/service.ts` hooked into the status ticker
(owned claude `working → idle/attention`); collects Edit/Write files since a
per-session checkpoint, upserts `state.reviews`, fires `reviewSummary`.
Broadcasts `reviews.updated`. `routes/reviews.ts`. `stores/reviewsStore.ts`,
inbox `review` kind, `uiStore.gitFocusPath` → `GitTab` focuses the file.

**M13 — recipes/enhancer/commit-msg.** `state.recipes` + `routes/recipes.ts`;
`components/recipes/RecipesDialog.tsx`; shared `components/prompt/PromptToolbar.
tsx` (recipe insert + enhance) in Composer + board composer. `POST /ai/enhance`.
`POST /projects/:id/git/commit-message` (+ `git/service.diffForAi`), CommitBox
AI split button (`uiStore.commitStyle`). **Spawn-with-initialPrompt**:
`CreateSessionInput.initialPrompt` → appended as the LAST positional claude argv
(interactive TUI submits it). Palette `Recipe: <name>` launches into a fresh
claude.

**M14 — digest.** `digest/service.ts generateDigest(from,to)` (commits +
sessions + cost per project → one `digest` call → `~/.deck/digests/`), optional
`digestAt` scheduler → `digest.ready`. `routes/digest.ts`, `views/DigestView.tsx`.

**M15 — cost expansion.** `state.budgets` + `PATCH /cost/budgets`; cost report
gains `aiProject` (`__deck_ai__`), `DailyCost.aiCost`/`byModel`. Dashboard:
BudgetBar (MTD vs monthly, amber>80/red>100), active-block red tint + live
countdown, stacked-by-model daily bars + Deck-AI segment, `__deck_ai__` row →
AI Admin, SessionHeader cost chip. Budget-over inbox card in `useInbox`.

**M10 — root pseudo-project (`__root__`).** `projectRegistry` synthesizes it in
`getAll/getById/getPath` (id `__root__`, path `config.root`, `kind:"root"`,
activity = newest unclaimed root transcript-dir mtime, 30s cache);
`locator.unclaimedRootTranscriptDirs`. Excluded from git-heartbeat + refreshTopGit;
git/files routes 404 for it, pin/hide 400. Client: fixed Rail entry
(SquareTerminal), agents-only tabs (`ROOT_VIEWS`), header hides branch/dirty/
WebStorm, excluded from Library grid.

**M16 — cliffnotes tab.** `ProjectViewKind += "notes"`;
`uiStore.ensureProjectViews` appends missing view tabs (adds notes to old
projects; keeps root agents-only). `components/project/NotesTab.tsx` renders
cliffnotes.md/ui.md; Generate = visible `spawnSession(initialPrompt)` + poll.

**M17 — task board.** REWRITTEN 2026-07-06 into M17v2 (see "Task board v2"
section below). The original hybrid board (6 columns, session linkage,
autopilot, startTask) is gone.

**Top-level view mechanism:** `uiStore.topView: "costs"|"ai"|"digest"|"board"`
(replaced the old `costsOpen` bool) routed in `App.tsx`; Rail footer icons +
palette entries. New small primitives: `components/ui/Switch.tsx`,
`components/ui/Toast.tsx` (`toast()` + `<Toaster/>`), `deck-shake` anim.

**V2 gotchas:** (1) server needs restart for new state shape; (2) CLI AI prompt
via stdin (not argv); (3) FTS sentinels are PUA U+E000/E001 — keep server+client
in sync; (4) `liveMeta`/`reviews` await `aiComplete` sequentially (per-feature
in-flight guard drops concurrent calls).

---

## V3 — runbook / system suite / stack intelligence (M18–M20) built 2026-07-05

Typecheck (both) + web prod build green; **live UI unverified, needs server
restart + `bun install`** (new dep: `pg` + `@types/pg`). No state-shape change.
Builds on the parallel-session Library feature (`projects/inspector.ts`,
`projects/ports.ts` portWatcher, `screenshots.ts`).

**M18 — runbook + Preview tab.** `deck.run.json` at each repo root =
machine-readable "how to run/test" (`Runbook`: **cwd** (repo-relative subdir all
runbook commands run in, monorepos) / dev{command,port,url} / test / install /
notes). `server/src/runbook/service.ts`: read/sanitize/write (`sanitizeCwd`
rejects absolute/`..`), detection fallback from inspector (dev/start script +
runner + staticPorts), `probePort` TCP probe, AI generate (feature id `runbook`,
cli backend w/ cwd, writes the file). **External explicit dev.url** (non-
localhost): status does an HTTP HEAD probe instead of the local TCP probe (30s
cache) and sets `RunbookStatus.frameBlocked` when the response carries
X-Frame-Options / CSP frame-ancestors (google.com etc. — browser refuses the
iframe; PreviewTab shows a "refuses to be embedded → open in browser" panel
instead of the broken frame). Routes `routes/runbook.ts`: GET/PUT
`/projects/:id/runbook`, GET `…/runbook/status` (effective port = file >
livePorts), POST `…/runbook/generate`. Root project 404s. Client
`components/project/PreviewTab.tsx` (new "preview" view tab): **iframe of the
running app** (dev servers send no X-Frame-Options), mobile-390px frame toggle,
reload/open-external, Start-dev button = visible shell session
(`createSession{kind:"shell",command,cwd}` — `CreateSessionInput.cwd` is repo-
relative, `manager.resolveCwd` guards it inside the repo then overrides the pty
spawn cwd; same plumbing available to Library run buttons), Test button, inline
runbook editor (incl. Directory field) + ✨Generate. Status poll: 3s until
listening, then 15s.

**M19 — System view (ports + processes + kill).** `server/src/system/service.ts`:
netstat (`listListeningPorts`, now exported from `projects/ports.ts`) + ONE
PowerShell/CIM round-trip (all live pids for orphan detection + rows for
node/bun/deno/python* and any port-owning pid: cmdline, WorkingSet, CreationDate
→ unix ms). Projects matched by cmdline-contains-project-path. 3s cache;
`killProcess` = `taskkill /T /F` (refuses own pid/ppid, pid<=4). Routes
`routes/system.ts`: GET `/system/overview`, POST `/system/kill/:pid`. Client
`views/SystemView.tsx` = new `topView:"system"` (Rail Activity icon + palette
"System: ports + processes"): processes grouped by project (mem/uptime/ports/
cmdline/kill, orphan badge + "Kill N orphaned"), all-listening-ports table
(port links to localhost, kill by owning pid). Polls 5s while open.

**M20 — Stack tab (env + DB + Prisma Studio).** `server/src/env/service.ts`:
one BFS (`scanTree`) walks the repo **4 dirs deep** (skips node_modules/dist/
build/coverage/vendor/tmp/venv/target + all dot-dirs, 1500-dir cap) collecting
`.env*` files, every `schema.prisma`, and every package.json name; each env
file is tagged with its nearest **workspace** (`EnvFile.workspace`, monorepo
grouping — null = repo root) and each var with a rough `EnvVarCategory`
(ai/database/auth/payments/storage/email/urls/config/other, `CATEGORY_RULES`
order matters). StackTab groups file cards under workspace headers + shows a
category chip per var. Masked vars (`abcd…xy`), stack badges (anthropic/openai/
postgres/mysql/sqlite/prisma/drizzle/redis/supabase/stripe/s3) from env keys +
inspector frameworks + schema.prisma (shallowest wins); DATABASE_URL detection
(non-example postgres wins);
`setEnvVar` edits in place w/ backup to `~/.deck/env-backups/`; values NEVER go
to AI. `server/src/db/service.ts` (**pg**): overview (version/db/tables w/
reltuples estimates), `runReadOnlyQuery` (single SELECT-shaped stmt only, READ
ONLY txn + rollback, 10s statement_timeout, 500-row cap), `aiQuery` (feature id
`dbQuery`: schema summary → SQL via aiComplete → guarded run).
`server/src/db/studio.ts`: one managed `npx prisma studio --browser none` per
project (free port from 5555, cwd = package dir owning `prisma/`, cleanEnv,
90s first-run wait, taskkill tree stop, disposeAll on shutdown). Routes
`routes/stack.ts`: `/projects/:id/stack`, `/env/reveal`, PUT `/env`,
`/db/overview|query|ai-query|studio(+/start|/stop)`. Client
`components/project/StackTab.tsx` (new "stack" view tab): badge row, DB panel
(connection line + Studio launch/stop + **Studio iframe embed**, clickable
table chips → query, one query box that runs raw SELECTs directly or AI-
translates English), env files w/ per-var reveal/edit.

**Wiring:** `ProjectViewKind += "preview"|"stack"` (uiStore DEFAULT_VIEWS +
ProjectShell VIEW_META/NORMAL_VIEWS — `ensureProjectViews` auto-adds to old
projects; root stays agents-only), `TopView += "system"` (App.tsx route, Rail
footer). `AiFeatureId += "runbook"|"dbQuery"` (models.ts registry, sonnet).
api.ts: runbook*/systemOverview/killPid/stack/revealEnv/setEnv/db*/studio*.

**V3 gotchas:** (1) `pg` is CJS — `import pg from "pg"; const {Client}=pg`;
(2) system PS query injects portPids into the script string — placeholder `0`
when none (System Idle Process row is filtered by name downstream); (3) env
reveal values ride a dedicated GET, never the batch stack report; (4) studio
port probe reuses `runbook/service.probePort` (no cycle: studio→runbook→ai).

Tabs persist to localStorage (`uiStore.projectTabs`) but sessions don't — they're
re-derived on boot from `/api/sessions` (= live owned in-memory + <30min external
transcripts). So after a server bounce / transcript aging out / a close, restored
tabs pointed at a session no longer in the store and rendered a dead "Session not
found". Now they **reconnect to what's on disk** instead.

- **Claude tabs → read-only feed + Resume.** `GET /sessions/:id/restore` resolves
  the stale id to a transcript: owned tab → persisted `ownedRecord(id).
  transcriptSessionId`; external tab → the id *is* the transcript uuid. Returns a
  read-only `Session` (`registry.sessionForTranscript`). Client `RestoredSessionView`
  renders `Feed` + a **Resume** button → `POST /sessions/resume {transcriptId,
  projectId,name}` = `manager.resumeTranscript` (create w/ `--resume`); the ghost
  tab is dropped and the fresh live tab opened.
- **Shell tabs → last screen text.** On pty exit AND `forceClose`, `saveScrollback`
  dumps the ring/serialize snapshot to `~/.deck/scrollback/<id>.log` (raw, capped
  256KB). `readScrollback` strips ANSI + tails last N lines. Restored shell tab
  shows it read-only. (In-memory ring dies on server restart / 24h sweep — this is
  the only durable copy.)
- **`state.ownedSessions` is now actually populated** (was declared-but-dead). Written
  in `manager.create`/`recordOwned`, transcript filled in on link (`setOwnedTranscript`),
  name kept current on rename, capped 300 (evicted ids' scrollback deleted). This is
  the pty-id→transcript map that survives restart. NOTE: owned-claude ghosts created
  *before* this shipped have no record → fall through to "Nothing left to restore"
  (their transcript is still in Agents → History). External ghosts + all new sessions
  restore fine.
- Guards: `SessionView` waits for `sessionsStore.loaded` before deciding a session is
  gone; `spawnSession` upserts the created session immediately — both avoid flashing
  the restore view for a session that's merely not-fetched-yet.
- New files: `server/src/pty/scrollback.ts`, `web/src/components/session/RestoredSessionView.tsx`.
  Verified in isolation (ANSI strip/tail round-trip + real transcript parse, 12/12);
  live browser flow untested (needs prod rebuild/restart).

## Bulletproofing — crash immunity + auto-recovery (2026-07-06)

The server used to die (and stay dead) from any uncaught exception — the prime
suspect being chokidar `error` events (EPERM/EBUSY on watched `.git/index`
files across ~149 repos) which had NO handlers on any of the 4 watcher tiers.
Now layered so a background fault can't kill it, and a real death self-heals:

- **Crash guard** (`server/src/lib/crashGuard.ts`, installed first in
  `index.ts main()`): `uncaughtException`/`unhandledRejection` are logged to
  **`~/.deck/crash.log`** (rotates at 1MB → `.1`) and survived. Escalation: ≥25
  uncaught exceptions in 60s → flush state + scrollback, `exit(1)` → supervisor
  restarts clean.
- **Supervisor** (`server/scripts/supervise.mjs`): `bun start` now runs THIS;
  it spawns `tsx src/index.ts` and restarts on any non-zero exit with backoff
  1s→2s→5s→10s→30s (streak resets after 60s uptime). Exit 0 (SIGINT/SIGTERM) =
  intentional, no restart. Restarts logged to crash.log. Raw run:
  `bun run --filter @deck/server start:unsupervised`. Verified live: force-
  killed the server twice → back healthy on a new pid in <5s both times.
- **Error handlers added** where an unhandled `error` event = process death:
  all 4 chokidar tiers (`watcher.ts guard()`), pg `Client` post-connect drops
  (`db/service.ts`), prisma-studio child spawn (`db/studio.ts`).
- **Contained tickers**: `services.ts safeTick()` wraps rescan/external/
  scrollback intervals; the 5s status ticker try/catches per session; pty
  data/exit listener fan-out try/catches per listener.
- **Durability**: (1) `saveAllScrollback()` flushes changed running-pty screens
  to `~/.deck/scrollback/` every 30s (+ on graceful/fatal shutdown), so a hard
  kill no longer loses terminal screens — restore tabs work after any death.
  (2) `state.json` writes keep the previous good file as `state.json.bak`;
  `loadState` falls back to it instead of silently resetting to defaults.
  (3) `process.on("exit")` does a final sync `flushState()`.

## PR Audit — AI pre-merge report in the Git tab (2026-07-07)

The Git tab's left column has a **PR Audit** row (above the status list; shows
a LOW/MEDIUM/HIGH risk badge from the cached report + an amber dot when the
diff moved since). Clicking it fills the right pane with `components/git/
AuditPanel.tsx`: headline + one-sentence verdict, risk level + why, computed
stats (files/+/−), **findings** (bugs→risks→nits; file:line chips jump to that
file's diff, or the Files tab when it's not in the change set), **impacts**
grouped by area (db/api/ui/state/config/deps/infra/tests/docs/other),
**features touched** (it reads the project's cliffnotes.md — 16KB cap — every
run), and a **before-merge checklist** (client-side checkboxes). Bottom: an
"ask about this change" box; the Q/A thread survives panel remounts via a
module-level cache.

- **Scope**: dirty tree → `git diff HEAD` + untracked file CONTENTS inlined as
  pseudo-diffs (≤30 files, ≤300 lines each, binary-sniffed); clean tree →
  `base...HEAD` vs upstream (fallback origin/main → origin/master → main →
  master) + unpushed commit subjects. Caps: 400 lines/file, 150KB total.
  Stats come from `--numstat`, not the model.
- **Server** `server/src/git/audit.ts`: `gatherAuditContext`/`buildAuditRequest`
  (pure, exported for the smoke test) → `aiComplete` feature **`prAudit`**
  (sonnet default, $1.50/day, json, 240s timeout) → `sanitizeReport` (enum
  coercion, string caps, bugs-first sort) → report cached in memory **and**
  `~/.deck/audits/<safe id>.json` (survives restarts). `diffSig` = sha1 of the
  audited diff; GET recomputes the current sig to flag staleness.
- **Routes** (`routes/git.ts`): GET `/projects/:id/git/audit` → `GitAuditState
  {report, stale}`; POST same → run fresh (400 = nothing to audit, 503 = AI
  off/over budget/already running); POST `…/git/audit/ask` `{question}` →
  `{answer}` (≤80-word plain-text answers; same feature id, so the per-feature
  in-flight guard serializes audit vs ask).
- **Client**: GitTab and AuditPanel share the `["git", projectId, "audit"]`
  query key, so the badge is live before the panel ever opens; `git.updated`
  invalidations refresh the stale flag. Types in shared: `GitAuditReport`,
  `GitAuditState`, `AuditFinding/Impact/RiskLevel/Severity/ImpactArea`.
- **Smoke test**: `server/scripts/audit-smoke.ts` (tsx; makes ONE real sonnet
  call, never touches state.json/ledger — safe next to a running server).

## Transcript feed → Claude Code terminal look (2026-07-07)

The read-only agent feed (`components/feed/Feed.tsx` + `FeedEvent.tsx`) used to
be proportional Inter text with lucide icons, per-line timestamps, checkmarks,
rounded boxes and bordered inline-code chips — it read as "noise" and looked
nothing like the CC terminal it mirrors. Rewritten to render like Claude Code's
own transcript, so the read-only feed and the live xterm sit side-by-side nearly
identical (verified in-browser, split view).

- **One monospace column.** `Feed.tsx` scroll container is now `font-mono
  text-[12.5px]`; the virtualized inner div is capped `maxWidth: 108ch` (left-
  aligned readable measure, not full ultrawide width — width caps the
  `width:100%` absolute rows via the positioned parent).
- **`FeedEvent.tsx` fully rewritten**, all icons/timestamps dropped. A shared
  `Row` = 1ch marker gutter + hanging content (`gap-[1ch]`, CC's `● text` /
  `  ⎿ text` rhythm). Per kind:
  - **assistant** — `●` in accent + markdown via `.deck-term-md`.
  - **tool** — `●` (status-colored: ok=t2, pending=warn+pulse, error=err) +
    `Verb(arg)` (bold verb, parenthesized arg; `formatTool()` splits
    `event.title`/`detail`). Result hangs off `⎿`: non-edit shows first line +
    "… +N lines", click expands to full `<pre>`; **edit** shows
    `⎿ +A −D · ctrl+o to expand`, expand reveals the `DiffLines` mini-diff.
  - **user** — accent left-bar + faint accent bg, mono (kept distinct/scannable
    for the [[ambient-visibility-over-clicks]] recall cue).
  - **thinking** — `✻ Thinking… · Nk` dimmed italic, click expands.
  - **subagent** — `● Task(desc)` + `⎿ N events`, expand nests `FeedEvent`s.
  - **meta** — dim `·` line.
- **`.deck-term-md`** (new, in `theme/tokens.css`) — feed-scoped markdown:
  monospace, small flat headers, inline code as bare `--accent-text` (no chip
  border/bg), tight margins. `NotesTab`/`DigestView` keep the proportional
  `.deck-md` (unchanged).
- Client-only, no server/state/shared-type change. Dev-only until a prod
  rebuild (`bun run build` + bounce) — the standalone `deck.cmd` app serves the
  old bundle on 12345 until then.

## Public-release prep (2026-07-07)

Getting the repo HN-ready (public at github.com/dested/deck):

- **README.md** rewritten from the one-line stub: pitch, feature tour with
  screenshots, install/config/FAQ. **LICENSE** added (MIT, © "dested" — handle,
  not real name). Screenshots live in `docs/screenshots/*.png` and are **mocked**
  (HTML mockups styled from `theme/tokens.css`, rendered via headless Edge —
  fake project names like aurora-web/ledger-api/meshkit; sources were scratch
  files, not in the repo). To redo them: rebuild similar HTML + `msedge
  --headless=new --screenshot --force-device-scale-factor=2`.
- **PII scrub of the working tree**: `C:\Users\<user>` + real project names
  genericized in SPEC.md/SPEC2.md/cliffnotes/locator.ts/shared/identity.ts/
  audit-smoke.ts; `Deck.lnk`, `deck.cmd - Shortcut.lnk`, `.idea/.gitignore`
  untracked (`*.lnk` now gitignored); leftover `server/src/_verify.tmp.ts`
  deleted. NOTE: **git history still contains the old strings + the real-name
  author identity** — squash/rewrite before flipping public.
- **Config default root changed**: `config.root` default is now `~/code` (was
  hardcoded `G:\code`). This machine keeps `G:\code` via the local (gitignored)
  `deck.config.json`, which now sets `root` explicitly — don't delete that key.

## Task board v3 — the Focus Stack (2026-07-07; replaced the v2 kanban VIEW)

The kanban **columns are gone** (24 cards crammed one narrow scroll while three
empty columns burned the ultrawide). Same data model + endpoints as v2 — no
state migration; server restart only for the Life-bucket guard below. The
board is still pure-personal: it can NEVER start a session/agent, no due dates.

- **Layout** (`views/BoardView.tsx` rewritten again): one centered vertical
  stack (max-w 900) — sticky composer → **NOW** hero (big accent card,
  Done / "Later→" buttons; empty state offers `★ Start: <first on-deck>`) →
  **ON DECK** (`next`, compact one-line rows) → **THE PILE** (`inbox`,
  grouped by project: header = avatar+name+count, collapse persisted in
  `uiStore.taskGroupsCollapsed`, biggest group first / Unassigned last;
  **drop a row on a group header = assign that project**) → **WINS** (`done`,
  top 5 + expand, Clear). Rows: hover actions (queue / ★ now / ✓ done) +
  move/delete context menu; **click any task = edit side-panel**. Section
  bodies are drop targets (move-to-status append); rows insert-before.
- **Edit side-panel** `components/board/TaskPanel.tsx` — right slide-over
  (absolute in BoardView, 420px), driven by `uiStore.taskPanelId` (transient):
  status segmented, title/project/notes, image grid + paste/drop, prompt
  draft/copy/edit, delete. **Auto-opens after quick-capture Enter but focus
  stays in the composer** (each add swaps the panel; dumping never breaks).
- **Triage mode** `components/board/TriageMode.tsx` — "⚡ Triage N" on the pile
  header: full-view overlay dealing ONE inbox card at a time (oldest first,
  queue frozen at mount), keys 1=Now 2=Next 3=Keep 4=Trash, Esc exits,
  progress bar, win screen. The ADHD answer to "24 things, can't decide".
- **Life bucket**: `LIFE_PROJECT_ID = "__life__"` (const in `shared`) — a
  sentinel `TaskCard.projectId` for non-code tasks. First-class in
  `ProjectPicker` (Heart-avatar row above "No project"), its own pile group;
  `generateTaskPrompt` rejects it with a friendly error. NOT a real project.
- **Shared client task logic** `web/src/lib/tasks.ts`: `focusBuckets`,
  optimistic `moveTask`/`moveToStatus`, Life helpers — used by board, panel,
  triage, and the rail Focus block.
- **Tasks in mission control**: Rail gained a **Tasks NavRow up top** (next to
  Mission Control; ★ badge when a Now exists; the footer Kanban icon was
  removed) and, expanded mode only, `components/rail/FocusStrip.tsx` — ambient
  Focus block under the nav (NOW row + 3 on-deck + "N in pile"); clicking a
  task opens the board **with that card's panel open**. `ExpandedProjects`
  footer now shows the project's **NOW task title** (★ + truncated) + a
  queued-count chip instead of the old `1★ 2⋯` counts.

Retained v2 mechanics (unchanged):

- **Statuses** (`TaskStatus`): `inbox` / `next` / `now` (soft >1 nag, never
  blocks) / `done` (fades at 7d client-side, auto-pruned at 30d in
  `listTasks`).
- **Card** (`TaskCard`): title, body (notes), `projectId: string|null`
  (capture first, assign later), `prompt: string|null` (see below),
  `images: TaskImage[]` (see below), order (fractional — card-level drop
  inserts before target at midpoint order).
- **Images on cards** (2026-07-07). Bytes at `~/.deck/task-images/
  <taskId>-<imgId>.<ext>` (png/jpg/gif/webp, 15MB cap, 12/card), index =
  `TaskImage` on the card. Upload = JSON base64 data-URL `POST
  /tasks/:id/images` (route-level `bodyLimit` 24MB — fastify default is 1MB);
  serve `GET .../images/:imageId` (immutable cache — image ids never change
  content); `DELETE` removes both. Files are cleaned on every card-death path
  (delete / clear-done / 30d prune / 200-cap prune). Client
  (`components/board/taskImages.tsx`): paste/drop/file-pick in composer +
  card editor, thumb strip on collapsed cards (3 + "+N"), portaled Lightbox
  (stopPropagation — portal events bubble through the REACT tree, so clicks
  would otherwise re-open the card under it).
- **Composer** (2026-07-07, replaced the bare CaptureBar): one bar — inline
  `ProjectPicker` chip (**sticky between adds** — the fix for
  "assign-the-project-after"), title input (Enter = quick add), chevron
  expands to notes + pending-image tray + target column segmented
  (Inbox/Next/Now — `createTask` now accepts `status`, never `done`) +
  Ctrl+Enter/Add. Pasting a screenshot anywhere in the bar auto-expands and
  attaches; images upload after create (`uploadPending`).
- **ProjectPicker** (`components/board/ProjectPicker.tsx`): Radix Popover
  replacing the old `<select>` — search + arrow-key nav, rows are the Rail
  "Open projects" look (gradient avatar + initials + status dot, name,
  branch/dirty/agents meta), sections: Life → No project → Open projects
  (uiStore.openProjects) → All projects (activity-sorted). Used in the
  composer (compact chip) and the task panel (`block`).
- **AI prompt drafting** (the ONLY automation): ✨ in the task panel →
  `POST /tasks/:id/generate-prompt` → `tasks/service.generateTaskPrompt` reads
  the project's `cliffnotes.md` (14KB cap) + title/body → `aiComplete` feature
  `taskPrompt` (sonnet) → saved on the card; UI shows copy-to-clipboard +
  editable prompt textarea. Requires an assigned real project (400 otherwise,
  incl. `__life__`); 503 = AI off/over budget.
- **Server**: `tasks/service.ts` (list/create/update/delete/clearDone/
  generateTaskPrompt + addTaskImage/removeTaskImage/getTaskImage; delete +
  prune broadcast **`tasks.removed`**), `routes/tasks.ts` (`/tasks/clear-done`
  registered before `/tasks/:id`). `tasks/autopilot.ts` DELETED;
  `state.autopilot` removed from DeckState. `state.ts migrateTask` backfills
  `images: []` on old cards.
- **Scoping**: `BoardView` takes an optional `projectId` prop — without it
  it's the top-level board (Rail Tasks NavRow / palette), with it it's the
  **per-project "Tasks" view tab** (`ProjectViewKind += "tasks"`; root stays
  agents-only). Scoped stack filters to that project, quick-capture
  auto-assigns it, pile is flat (no groups), pickers hidden.

## Library category bands (2026-07-06)

Project groups (the user-curated "categories") were rendered in `LibraryView.tsx`
as thin uppercase section labels — visually identical to the auto-decay buckets
(Active/Shelf/Archive), so hand-curated shelves looked no more important than
"untouched >30d". Rewritten into **bold category bands** (client-only, no
server/state-shape change): each group is a `CategoryBand` with a gradient
identity avatar + initials (`projectGradient`/`projectInitials(group.name)` from
`lib/identity.ts` — groups have no colour field, so it's derived from the name),
a 15px name, a `N repos · N live` signal (live/attention aggregated across the
group's projects from `selectProjectStats`), a group-colour accent rule fading
rightward, and a **collapse chevron** that persists via
`api.updateProjectGroup(id,{collapsed})` (broadcasts `project-groups.updated` →
store replaces wholesale → band re-renders). Bands sit above the decay buckets;
an "Uncategorized" divider separates them from Active/Shelf when both exist.
Verified live in-browser (bands render per-group colour, collapse round-trips).

## Multiple project roots (2026-07-06)

`deck.config.json` gained `"roots": ["D:\\work", ...]` — **additional** folders
scanned for projects besides `root` (default `G:\code`, which stays primary:
it backs the `__root__` pseudo-project, and its children keep bare folder
names as ids so existing pins/groups/tabs survive). `config.roots` =
`[root, ...roots]` normalized + deduped case-insensitively. Scanner loops all
roots; **extra-root project ids are `encodePath(fullPath)`** (stable, collision
-free across roots; `name` stays the folder basename). Root chokidar tier
watches every root; `locator.isRootDirName` matches any root (unclaimed
non-git-subdir transcripts from any root land in `__root__`). `/api/config` +
`DeckClientConfig` expose `roots`; Settings shows the list. Editing
deck.config.json still needs a restart, but roots can also be added/removed from
the UI with **no restart** — see the next section.

## UI-managed project roots — no restart (2026-07-07)

Extra scan roots are now add/removable from **Settings → Root directories**
instead of hand-editing deck.config.json + bouncing the server. `config.roots`
became a **getter** (`config.ts resolveRoots()` = `[root, ...fileRoots,
...runtimeExtraRoots]`, deduped case-insensitively) so the scanner + locator —
which read `config.roots` fresh every pass — pick up changes instantly. Three
tiers of root:
- `config.root` — primary (`deck.config.json.root`, default `~/code`), backs
  `__root__`, locked in the UI.
- `fileRoots` — `deck.config.json.roots` (exported from config.ts), locked in
  the UI (shown with a 🔒 "config" tag).
- runtime `extraRoots` — the UI-editable ones, persisted in **`state.json`
  `extraRoots`** (new `DeckState` field, default `[]`). `loadState()` seeds them
  into config via `setRuntimeExtraRoots()` on boot.

**Routes** (`routes/projects.ts`): `POST /roots {path}` (folder must exist → 400;
locked/dup → 400/409), `DELETE /roots {path}` (refuses locked roots → 400). Both
mutate `state.extraRoots` then `reloadRoots()` = `setRuntimeExtraRoots` +
**`resyncRootWatcher()`** (watcher.ts re-points the chokidar root tier at the new
`config.roots` via an add/unwatch diff — the root tier now starts EMPTY and is
driven entirely by this) + `rescan()` + `syncGitHeartbeat()` + `refreshTopGit(30)`.
Returns `{roots, extraRoots}`. **Client**: `api.addRoot/removeRoot`;
`DeckClientConfig` gains `fileRoots`/`extraRoots`; `SettingsDialog.tsx`
`RootsEditor` (add input + per-row X; invalidates `["config"]`/`["projects"]`;
the rescan's `projects.updated` WS push updates the live project store on every
client). Smoke test `server/scripts/roots-smoke.ts` (temp fake-git project →
setRuntimeExtraRoots → scanProjects round-trip, 7/7; never touches state.json).
Needs ONE server restart to activate the new server code the first time.

## In-app Reload UI + Restart server — window never closes (2026-07-07)

Two controls so the standalone `deck.cmd` window never has to be closed to pick
up changes: **Settings → App** (and command palette "Reload UI" / "Restart
server"). `web/src/lib/serverControl.ts`:
- **Reload UI** = `location.reload()` — picks up a fresh `web/dist` build +
  re-bootstraps every store. Zero backend disruption.
- **Restart server** = `POST /api/system/restart` → then polls `/api/health`
  (800ms initial gap, 500ms interval, 30s cap) → `location.reload()` when the
  fresh process answers. Toast throughout; the WS client already auto-reconnects
  (`ws.ts`, 500ms→8s backoff) so nothing hangs.

Server: `routes/system.ts POST /system/restart` → `lib/lifecycle.ts
restartServer()` = flush scrollback + state, stopServices, disposeAll ptys, then
**`process.exit(1)`** — the SAME mechanism a crash-guard restart uses, so the
supervisor (`supervise.mjs`) respawns it (non-zero exit → restart; exit 0 =
intentional stop, no restart). Guarded by **`isSupervised()`** (`process.env.
DECK_SUPERVISED === "1"`, now set by `supervise.mjs` in the child env): a bare
`tsx`/dev run returns 409 and the button is disabled (config gains `supervised`).

**Bootstrap gotcha:** activating this the first time needs a FULL relaunch of
`deck.cmd` (stop the supervisor + restart), not just killing the child —
`DECK_SUPERVISED` is injected when the supervisor spawns the child, so the
already-running old supervisor won't set it. After one full relaunch, every
later "Restart server" click works (the supervisor's env persists across
respawns). Same restart also activates the UI-managed-roots server code above.

## Expanded mission-control sidebar (2026-07-07)

The rail now has **two persisted modes** (`uiStore.sidebarMode`, default
`expanded`; toggle = header PanelLeft button or **Ctrl+Shift+B**; Ctrl+B still
fully hides): `compact` = the slim rail below, `expanded` = a wide ambient
panel (own width `uiStore.sidebarWideWidth`, default 30% of window, drag clamp
360–45%, separate from compact's 200–420). Expanded body =
`components/rail/ExpandedProjects.tsx`: each OPEN project is a rich card —
avatar/status dot, branch + ahead/behind + dirty, then every non-stale session
as a row (attention w/ "waiting Nm" + promptTail box → working → finished
(owned·idle·unread, review-claimed excluded) → exited(≠0) → idle capped 3),
each with status dot, kind icon, `displayTitle`, **`Session.firstPrompt`** (the
original ask, accent-left-border quote, line-clamp-2), and aiMeta.summary ??
lastActivityLine. Footer strip chips: N reviews → git tab, live ports →
browser, now★/next⋯ tasks → tasks tab. Click row = openSession (+markRead);
card order = openProjects order (stable); 20s tick ages the times. Derives
entirely from existing client stores (sessions/reviews/tasks/libraryStore —
all bootstrapped app-wide in App.tsx).

**`Session.firstPrompt`** (shared type, optional): first REAL user message from
the transcript — strips `<system-reminder>` blocks, skips `Caveat:`/
`<command-`/`<local-command`/`<bash-input` meta lines, one line, 280-char cap.
Computed in `parser.ts firstRealPrompt()` (`ParsedTranscript.firstPrompt`),
surfaced via `registry.describe()`/`toSession` and `sessions/manager.toSession`
(owned claude incl. exited). Free — no AI call. **Needs a server restart** to
appear; client degrades gracefully (line simply omitted). Verified against 8
real transcripts via a scratch tsx harness; UI verified live in-browser
(expanded default, toggle round-trip, Ctrl+Shift+B, drag-resize + persistence,
attention/working/idle rows, reviews chip).

## Wide sidebar (2026-07-05)

`components/Rail.tsx` rewritten from a 52px Discord-style initials strip into a
**wide sidebar** (readable project names). Width = persisted
`uiStore.sidebarWidth` (default 264, clamp 200–420) with a drag handle on the
right edge (rail starts at x=0 so pointer clientX ≈ width). Rows: Library /
Inbox (badge) / `~ code`, then an "Open projects" section — each project row =
gradient avatar (status dot: amber attention / green pulse working) + name +
meta line (branch, `N±` dirty in warn, "N agents"/"needs input") + hover X
close; middle-click closes; same right-click menu (Close / Close others /
Explorer / WebStorm). Footer = horizontal icon row (System/Board/Digest/AI/
Costs/Settings). Active row gets a left accent bar + bg-raised. Ctrl+B still
hides the whole thing (`sidebarCollapsed`).

## Terminal Nerd Font icons (2026-07-05)

Stock JetBrains Mono has no Private-Use-Area glyphs, so oh-my-posh / Terminal-
Icons / eza icons rendered as tofu (□) in xterm. Fix: added **Symbols Nerd Font
Mono** as a *fallback* (icon glyphs only; text stays JetBrains Mono). Works under
the WebGL renderer because xterm rasterizes via canvas `fillText`, which honors
the CSS font-fallback chain. Files: `web/public/fonts/SymbolsNerdFontMono-
Regular.woff2` (1.15MB, converted from the Nerd Fonts SymbolsOnly TTF via
fonttools), `@font-face` + `--font-mono` fallback in `theme/tokens.css`, and the
`fontFamily` stack in `components/terminal/Terminal.tsx`.

## Tab strip: quick-add / rename / reorder (2026-07-04, batch 4)

Per-project tab strip (`views/ProjectShell.tsx`) got three affordances; all
client-only (no server/state-shape change beyond a new uiStore action).

- **Quick add.** A browser-style **`+` button** (`NewTabButton`) sits after the
  last tab; it's the same Claude-session / Terminal dropdown as the header "New
  session" button, just always in reach at the tab strip. Header button kept.
- **Rename session tabs.** **Double-click** a session tab → inline `<input>`
  (Enter commits via `api.renameSession`, Esc cancels) — mirrors `SessionRow`'s
  sidebar rename; the name is server-side so header + sidebar update too. View
  tabs (Agents/Git/Files) are not renamable (guarded by `renamable`).
- **Drag to reorder.** Native HTML5 DnD (no lib, like the Sidebar). New
  `uiStore.reorderTab(draggedId, targetId|null)` moves a tab before `targetId`
  (null = append). Drop-before target shows a left accent ring; dragged tab dims.
  The `TabStrip` container is itself the append drop-zone (drop on empty space →
  end). All tabs incl. views are freely reorderable. `draggable` is off while an
  input is editing so rename doesn't start a drag.

## Recent UX fixes (2026-07-04, batch 3)

- **Close now MEANS close — no more re-adopt ghost.** Closing an owned claude
  session force-closed the pty but left its transcript file on disk (fresh
  mtime), so the transcript registry instantly re-surfaced it as an **external**
  "Adopt" card (a *different* id = the transcript id) — you had to dismiss/adopt
  it again. `sessionManager.forceClose` now **dismisses the linked transcript
  first** (`dismissedSessions[transcriptId]=now`, before dropping `owned`, so
  there's no one-tick resurrection window) and `publishRemoved(transcriptId)` to
  retract any external card a client already drew. A killed claude never writes
  again, so the dismiss holds; it only reappears if the transcript is genuinely
  touched anew. Shell terminals have no transcript → always closed cleanly.
- **Closed claudes stay re-openable from Agents *history*.** Dismissing the
  transcript would otherwise hide it forever, so `registry.sessionsForProject`
  no longer drops dismissed sessions — it routes recent-dismissed (and any
  dismissed) ones to the **history** bucket instead of `live`. "Close" removes it
  from the active/live view; history is the passive archive you re-open from.
- **Command palette "Kill" → "Close"** (`CommandPalette.tsx`). It called bare
  `api.killSession` (left an exited card + the transcript ghost for claudes); now
  routes through the unified `closeSession(s)` like every other X, for any source.

## Recent UX fixes (2026-07-04, batch 2)

- **Push, not just commit.** `git/service.ts push()` (auto `-u origin <branch>`
  when no upstream, keys off exit code since git prints progress to stderr) →
  `POST /projects/:id/git/push` → `api.gitPush` → CommitBox now has a **Push**
  button (shows ahead count, disabled when tracking & up-to-date) plus a
  **Commit & push** item in the dropdown. GitTab passes `aheadBehind`/`upstream`.
- **Rename sessions AND agents.** `sessionManager.rename` now calls
  `publishById` (was owned-only) so renaming an *external* agent live-updates its
  card. Added **Rename** to `SessionContextMenu` (sidebar right-click) which
  drives an inline edit in `SessionRow`; the session header title-click rename
  still works. External renames were already persisted in `state.sessionNames`
  and honored by `toSession`.
- **Zombie owned sessions are now closeable.** A claude whose pty died without
  emitting exit got stuck `idle` and `kill` did nothing. New
  `sessionManager.forceClose(id)` = `ptyManager.dispose` + drop from owned +
  **prune `sessionNames`/`sessionGroups`** + `sessions.removed` + resync counts.
  `/sessions/:id/dismiss` (owned branch) routes through it; client `closeSession`
  now optimistically removes owned too (one unified X everywhere). Natural exit
  still leaves a readable "exited" tab — force-remove only on explicit close.
  Claude sessions stay re-openable from the project's Agents history.
- **Duplicate agent card fixed (two layers).** Server: `transcriptRegistry.
  onFileChanged` was publishing an owned session's transcript as an `external`
  twin (different id → two cards). It now skips the publish when `ownedChecker()`
  owns that transcript and retracts any stray external card. Client: `AgentsTab`
  also drops any external session whose id ∈ the owned sessions' transcript ids
  (`isTwin`) so the dup is gone on a plain web reload even before a server
  restart. (`tickExternal` already guarded this.)
- **Agents page spruced up** (`AgentsTab.tsx`). Live agents are now rich cards:
  status-tinted kind badge, ai-title as the heading (session name secondary),
  the live activity line, and a chip row — **model / messages / tools / edits /
  last-activity / active-duration** + attached·external tag + unread dot.
  Right-click any card = SessionContextMenu (restart/close). History rows show
  model + message/edit counts. Stats come from a new server enrichment:
  `shared` `AgentStats` on `Session.stats`, `status.ts computeStats`, parser now
  captures `ParsedTranscript.model` (last non-synthetic `message.model`), and
  both `registry.toSession`/`describe` + `sessionManager.toSession` populate it.
  Stats need the restarted server; cards degrade gracefully without them.
- **Project sort drops `.git/FETCH_HEAD`** from `activityAt` (`scanner.ts`) — a
  background `git fetch` is not user activity and was floating long-untouched
  projects up. Sort is still: pinned → `activityAt` desc → name. NOTE: a recent
  claude **transcript** in a project's folder still counts as activity, so a
  stray/short session there will float it (see `Drop FETCH_HEAD + transcript`
  option if that's unwanted). "Pin" is the star-to-top feature.

## Project grouping (2026-07-04, batch 3)

Named, ordered, collapsible **project groups** in the sidebar with drag-and-drop.

- **State** (`state.ts`, needs server restart): `projectGroups: Group[]` (array
  order = display order; `Group.collapsed`) + `projectGroupOf: Record<projectId,
  groupId|null>`. Separate from session `groups`/`sessionGroups`.
- **Decoration:** `ProjectSummary.groupId?` (optional so it degrades pre-restart)
  set in `registry.decorate`. Server sort is unchanged (pinned → activity →
  name); **grouping/partitioning is entirely client-side**.
- **Broadcast:** any group mutation emits `project-groups.updated` (whole
  `Group[]`) on the `projects` topic; project→group assignment rides the normal
  `projects.updated` summary. New client `projectGroupsStore` (replace-whole),
  bootstrapped in `App.tsx` via `api.projectGroups()`, updated in `ws.ts`.
- **Routes** (`routes/projects.ts`): `GET/POST /project-groups`, `PATCH
  /project-groups/:id` (name/collapsed), `DELETE` (unassigns its projects),
  `POST /project-groups/reorder` {ids}, `POST /project-groups/:id/assign`
  {projectId} (id `none` → ungroup). `api.ts`: `projectGroups`,
  `createProjectGroup`, `updateProjectGroup`, `deleteProjectGroup`,
  `reorderProjectGroups`, `assignProjectGroup`.
- **Sidebar rewrite** (`Sidebar.tsx`): dropped `@tanstack/react-virtual` (≈149
  rows render fine); renders group sections (in store order) then an "Ungrouped"
  bucket. **Native HTML5 DnD** (no lib): drag a project onto a group header →
  assign; onto the "Ungrouped" zone → unassign; drag a group header onto another
  → reorder (insert-before), onto Ungrouped zone → send to end. `dragRef` holds
  the payload; `dragKind` is mirrored to state so drop-target rings re-render.
  Chevron toggles `collapsed` (persisted); double-click or right-click →
  Rename/Delete; header "+" (FolderPlus) creates a group and enters inline
  rename. **Within-group order stays activity-sorted** (pinned floats up) — no
  manual per-project ordering, consistent with "don't reorder under the cursor".
  Searching force-expands groups and hides empty ones.
- **ProjectRow:** added a **Move to group** context submenu (existing groups with
  a check on current, Remove-from-group, New group…) as a non-DnD path.

## Recent UX fixes (2026-07-04, post-M6)

- **Owned claude view is terminal-first** (`components/session/ClaudeSessionView.tsx`).
  The xterm terminal is the session and is always full-width; the Agent transcript
  (Feed + Composer) is HIDDEN by default and slides in on the LEFT when enabled.
  Toggle: header button ("Show/Hide transcript") **or Ctrl+`** (repurposed — it
  used to toggle the terminal). Terminal stays mounted across toggles so its
  socket never drops.
- **Sidebar no longer auto-collapses.** Removed `useImmersiveSidebar` from
  `App.tsx`; opening a session tab keeps the sidebar. Ctrl+B still toggles.
- **Stable project ordering** (`stores/projectsStore.ts`). Sort is pinned →
  filesystem `activityAt` → name. Clicking a project no longer bumps it (dropped
  the `lastOpenedAt` tiebreak from the sort; the value still drives the row's
  hover "last opened" hint). Selector no longer takes `lastOpenedAt`.
- **Every session can be closed.** External (transcript-only) sessions can't be
  killed, so they're *dismissed*: `POST /sessions/:id/dismiss` records
  `state.dismissedSessions[id]=now`; the registry hides it until its transcript
  mtime moves past that time. `tickExternal` also emits `sessions.removed` when an
  external ages to `stale`, so stale agents clear from the live store instead of
  lingering. Client helper `closeSession(session)` in `lib/sessions.ts` (kill
  owned / dismiss external, optimistic store+tab removal). `sessions.removed` now
  also closes any open tab (`uiStore.removeSessionTabs`). Wired into SessionCard,
  SessionContextMenu, SessionHeader.
- **Open in WebStorm** button next to Explorer (project header + ProjectRow
  context menu). `POST /projects/:id/webstorm` → `config.webstormBin` if set,
  else `cmd /c webstorm <path>` (resolves the JetBrains Toolbox `webstorm.cmd`
  shim on PATH). Override via `deck.config.json` `webstormBin`.

**Post-M6 map drift:** the file map below still lists the pre-refactor shell
(`MainArea`/`TabBar`/`GridView`/`ProjectView`); those were replaced by
`views/ProjectShell.tsx` (per-project tab strip: views + session tabs). Not yet
fully reconciled here.

---

## Deviations from SPEC.md (record every forced one here)

1. **Git-heartbeat watcher tier (addition to §4.3).** SPEC's repo tier watches a
   project's worktree only while it is *open*, and §4.1 forbids recursively
   statting worktrees for recency. To make "touching a file in **any** repo
   bumps it within 2s" (M1 verify) work for *closed* projects, we additionally
   watch just the two files `<repo>/.git/index` and `<repo>/.git/HEAD` for every
   project (depth 0, no worktree recursion). Real `git` operations rewrite these,
   so activity + dirty-count live-update within ~200ms debounce. Lives in
   `server/src/projects/watcher.ts` (`startGitHeartbeatTier` / `syncGitHeartbeat`).
   Note: a pure `touch` (mtime-only, no content change) does NOT fire on Windows
   `fs.watch`; real git writes (content) do. The transcript tier remains the
   primary heartbeat.

2. **Ligatures under WebGL (§5.4 internal conflict).** §5.4 requires BOTH the
   WebGL renderer (P0 performance) AND "ligatures ON". In xterm these are
   mutually exclusive — the ligatures addon only works with the DOM/canvas
   renderer and is not in the §1 locked addon list. WebGL wins (explicit P0
   perf mandate); JetBrains Mono's programming ligatures therefore do not render
   as glyphs. Everything else on the §5.4 checklist is honored. `fontWeightBold`
   is still 600.

---

## Run commands

```
bun install                      # once
bun run dev                      # server (12345) + Vite (12346, proxies /api,/ws) — open http://127.0.0.1:12346
bun run build && bun start       # prod: build web, serve everything on http://127.0.0.1:12345
                                 # `bun start` runs the SUPERVISOR (auto-restart on crash) — see Bulletproofing
bun run typecheck                # tsc --noEmit for both packages
deck.cmd                         # launch Deck as a STANDALONE APP WINDOW (see below)
```

**Standalone app window (not a browser tab).** `deck.cmd` → `deck.ps1`: ensures
the prod server is up on 12345 (builds once if `web/dist` missing, then `bun
start` detached), then opens Deck in a chromeless Edge/Chrome `--app` window with
a dedicated `--user-data-dir=.deck-app-profile` — its own taskbar icon + Alt-Tab
slot, no tabs/URL bar. `web/public/manifest.webmanifest` (+ `<link rel=manifest>`
and `theme-color` in `index.html`) also makes Deck **installable** via Edge/Chrome
"Install Deck" for a Start-menu entry. Requires PROD mode (12345 serves the UI);
in dev the UI is on 12346, so the app window won't work against a dev server.
Icons are the existing `favicon.svg` (SVG, install-capable; swap in PNGs later
for a crisper taskbar glyph). Pin `deck.cmd` to the taskbar for one-click launch.
Next tier if wanted: Electron shell (server in-process + system tray + global
summon hotkey).

Kill a stuck server: PowerShell `Get-NetTCPConnection -LocalPort 12345 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`.

---

## Layout / file map

```
agentcommunity/
  SPEC.md                 locked spec
  cliffnotes.md           this file
  deck.config.json        optional overrides (root/roots/port/claudeDir/claudeBin/defaultShell)
  shared/src/index.ts     ALL shared types (single source of truth) — pkg @deck/shared
  server/  (Node 22 via tsx; NOT bun runtime — node-pty needs stable ConPTY)
    src/
      index.ts            fastify bootstrap: /ws/events, /ws/term, /api/*, static (prod), SPA fallback
      config.ts           config + deck.config.json overrides. repoRoot, root, roots[], port, claudeDir…
      state.ts            ~/.deck/state.json (atomic write, 500ms debounce): groups, projectGroups+projectGroupOf, names, pins, owned sessions
      services.ts         boot: scanner rescan + top-30 git prime + watchers + 60s rescan
      projects/
        scanner.ts        discover G:\code children with .git; activityAt (§4.1)
        registry.ts       in-memory ProjectSummary map; refreshGit; live publish; pins/hidden decorate
        watcher.ts        tiers: root / transcript(heartbeat) / git-heartbeat(deviation) / repo(open only)
      git/service.ts      execa git; porcelain=v2 -z parser (getStatus/summarize). M5 adds diff/stage/commit
      transcripts/
        locator.ts        encoded-path map (§4.2), transcriptDirs/FilesForProject
        tailer.ts         change-hook (M1 stub) → full tail in M3
        parser.ts         (M3) jsonl → TranscriptEvent[]
      pty/manager.ts      (M1 STUB: claude-bin resolve + interface) → full ConPTY in M2
      routes/
        projects.ts       GET /projects, /:id, pin, hide, reveal
        git.ts            GET /:id/git/status  (rest in M5)
        sessions.ts       (M0 stub → M3/M4)
        files.ts          (stub → M6)
      ws/
        events.ts         pub-sub hub + topic refcounts + subHandler (drives repo watchers)
        term.ts           (stub → M2)
  web/  (React 19 + Vite + Tailwind v4)
    public/fonts/         Inter-Variable.woff2, JetBrainsMono-Variable.woff2 (self-hosted)
    public/favicon*.svg   base + alert (attention badge, §11)
    src/
      main.tsx            QueryClient + connectEvents + render
      App.tsx             shell: Sidebar | (TabBar + MainArea); global keys; attention badge
      theme/tokens.css    §8 tokens (@theme + :root vars), fonts, base, the one pulse anim
      lib/
        api.ts            typed REST client (all endpoints, some land later)
        ws.ts             /ws/events client: reconnect, topic refcount, dispatch→stores, RQ invalidate
        format.ts         relTime, splitPath, dayBucket
        useGlobalKeys.ts  §10 keyboard map
        useAttentionBadge.ts  document.title + favicon swap
        cn.ts
      stores/
        projectsStore.ts  zustand: byId + selectSortedProjects
        sessionsStore.ts  zustand: sessions + groups + selectSessions
        uiStore.ts        persisted: tabs, activeTab, sidebar, fontsize, palette/settings open
      components/
        Sidebar.tsx       header/search, SESSIONS (SessionList), PROJECTS (virtualized ProjectRow), footer
        TabBar.tsx        editor-style tabs, middle-click close, accent active
        MainArea.tsx      routes active tab → view
        ui/               StatusDot, Tooltip, IconButton, Button, EmptyState, menuStyles
        sidebar/          ProjectRow (+context menu), SessionRow, SessionList (groups)
        home/SessionCard.tsx
        project/          AgentsTab, GitTab, FilesTab, TerminalsTab (M1 placeholders)
      views/              HomeView, ProjectView, SessionView(stub), GridView(stub)
      components/CommandPalette.tsx, SettingsDialog.tsx  (stubs → M6)
```

---

## Protocol quick-ref (see SPEC §3)

- REST under `/api` (see `web/src/lib/api.ts` for the full typed list).
- `/ws/events` JSON pub-sub. Client `{op:"sub",topics:[...]}`; topics: `projects`,
  `sessions`, `git:<id>`, `transcript:<sessionId>`. Server pushes `projects.updated/removed`,
  `sessions.updated/removed`, `git.updated`, `transcript.append`, `session.attention`.
  Subscribing to `git:<id>` opens that project's repo watcher (refcounted, 5-min teardown).
- `/ws/term/:ptyId` raw binary bridge (M2).

## Encoded transcript paths (§4.2)
`encodePath` = replace every non-`[A-Za-z0-9-]` char with `-`. Verified:
`G:\code\my-app`→`G--code-my-app`, `G:\code\my-site.gg`→`G--code-my-site-gg`.
A dir maps to a project by longest-prefix (`==` or `<enc>-…`).

## Transcript JSONL ground truth (verified on this machine, for M3)
Line `type`s seen: `user`, `assistant`, `system`, `summary`(rare), `mode`,
`permission-mode`, `file-history-snapshot`, `attachment`, `last-prompt`,
`ai-title`, `queue-operation`, `frame-link`, `agent-name`. `user`/`assistant`
carry `message` (Anthropic format; content string or block array). Block types:
`text`, `thinking`, `tool_use`, `tool_result`, `image`. Edit tool uses
`old_string`/`new_string`; Write uses `content`; MultiEdit uses `edits[]`.
`tool_result` may be string or block; `is_error` marks failures; outer line may
carry structured `toolUseResult`. `isSidechain:true` = subagent. `ai-title`
gives a session title. **Parser must skip unknown line/block types, never crash.**

---

## Milestone status
- **M0 skeleton** ✅ boots dev+prod, WS echo verified, tokens/shell/fonts in place.
- **M1 projects** ✅ 149 projects discovered, activity sort, dirty count matches
  `git status` exactly, live-bump via transcript (~620ms) and git-heartbeat
  (~820ms), project list + project-view shell. No console errors.
- **M2 terminals (P0)** ✅ Full §5.4 acceptance test passed in-browser: shell
  spawns, native typing, exact ANSI palette + PSReadLine highlighting, resize
  with NO ConPTY garble (sidebar toggle reflow), reattach restores the screen
  perfectly after browser refresh, `claude` runs interactively (TUI/box-drawing
  render correctly, input reaches its prompt), kill→exited (code retained).
  Reattach via server-side headless-serialize snapshot (216-char restore verified).
- **M3 agent view** ✅ Parser runs over all 133 real transcripts with ZERO
  crashes (20,791 events). External discovery + statuses + AI titles work;
  home/sidebar populate; feed renders tools (one-line, expandable), edits-as-
  mini-diffs (dual-gutter +/- tints), thinking (collapsed), markdown (headings/
  code/lists), subagent cards, following pill. 1272-event transcript scrolls
  smooth & virtualized. Live external tail streams into the feed (~2s). History
  (5 live/44 past) via /projects/:id/agent-sessions.
- **M4 own sessions** ✅ Verified: spawn claude from Deck → transcript links
  after first message → split feed+terminal view → composer sends → feed live-
  appends user+assistant turns in real time (feed+terminal in sync). Groups
  (create/assign via context menu) + grid view (owned=terminal, external=feed
  cells) work. restart/adopt endpoints + notifications (title badge "(N!)"
  verified). Three non-obvious fixes below.
- **M5 git** ✅ Verified against a real repo: status lists (staged/changes,
  glyphs, untracked=U), custom hunk renderer with dual gutters + red/green tints
  + word-level intra highlights, **byte-exact hunk staging** (staged 1 of 2
  hunks → `git diff --cached` matched exactly, other hunk stayed unstaged),
  commit (only staged hunk committed, panel refreshed), Monaco full-file diff
  (side-by-side HEAD vs worktree, §8 theme), discard-hunk, log/history + commit
  viewer, and LIVE refresh (agent-created file appeared in Changes within ~2s).
- **M6 files + polish** ✅ Files tab (lazy virtualized tree with git-modified
  amber dots + ignored toggle; Monaco editor with Ctrl+S save), command palette
  (Ctrl+K, fuzzy across actions/projects/sessions), settings dialog (root/port/
  shell/claude-bin + font slider + notifications toggle), full keyboard map,
  empty/loading/focus/tooltip states. Verified keyboard-only spawn+interact via
  palette. Two polish fixes below.

**ALL MILESTONES M0→M6 COMPLETE AND VERIFIED.**

### M6 file map additions
```
server/src/files/io.ts, tree.ts        read/write (repo-guard+retry), lazy tree
server/src/routes/files.ts             tree/file GET, file PUT
web/src/components/files/FileTree.tsx  virtualized lazy tree, git dots, ignored
web/src/components/files/FileEditor.tsx  Monaco (lazy) + Ctrl+S save
web/src/components/project/FilesTab.tsx
web/src/components/CommandPalette.tsx  Ctrl+K fuzzy palette
web/src/components/SettingsDialog.tsx  §9.6
web/src/lib/monacoSetup.ts             SELF-HOST monaco (loader.config + workers)
web/src/lib/monacoTheme.ts             deck-dark theme
```

### M6 polish fixes (keep)
1. **Monaco must be self-hosted** (`web/src/lib/monacoSetup.ts`). `@monaco-editor/
   react` fetches monaco from jsdelivr by default (breaks §1 no-CDN + offline).
   `loader.config({ monaco })` + Vite `?worker` imports for the 5 language workers
   pin it to the bundled copy. Import monacoSetup at the top of every lazy Monaco
   component (FileEditor, MonacoDiff).
2. **Notification permission request must be fire-and-forget** (`web/src/lib/
   sessions.ts`). `await Notification.requestPermission()` BLOCKS the first spawn
   on the browser prompt — never await it.

### M5 file map additions
```
server/src/git/diffParser.ts    unified diff -> Hunk[] (raw patch kept for
                                byte-faithful apply; word-level intra highlights)
server/src/git/service.ts       +getDiff (untracked synth all-add), getFileAtHead,
                                stage/unstage, applyHunk (git apply --cached[-R]),
                                discardHunk (git apply -R worktree), discard,
                                commit (-F -), log, show, showFileDiff
server/src/files/io.ts, tree.ts read/write with repo-root guard + retry (also M6)
server/src/routes/git.ts        all §6 endpoints + discard-hunk, show-file
server/src/routes/files.ts      tree/file GET + file PUT
web/src/components/git/*         GitTab, StatusList, DiffViewer, MonacoDiff (lazy),
                                CommitBox, LogPanel, CommitDiff
web/src/lib/monacoTheme.ts       deck-dark Monaco theme + language map
web/src/components/diff/DiffLines.tsx  (shared with feed edits)
```
Hunk apply is byte-faithful: patch = `diff.fileHeader + "\n" + hunk.patch` piped
to `git apply --cached --whitespace=nowarn` (verified vs `git diff --cached`).

### M4 file map additions
```
server/src/transcripts/linker.ts  §5.2 linkage: poll encoded dir for the new
                                  jsonl (matching cwd) claude writes on 1st msg.
                                  PATIENT (~15min) — transcript only appears on
                                  first message, not at spawn.
server/src/sessions/manager.ts    +restart (kill+--resume), +adopt (--resume ext),
                                  +owned-claude status from transcript describe(),
                                  +ownedTranscriptIds() dedup, +publishById
server/src/routes/sessions.ts     +restart/adopt, +groups CRUD/assign, +transcript
web/src/components/session/Composer.tsx, ClaudeSessionView.tsx (split+divider+Ctrl+`),
    SessionContextMenu.tsx, AdoptBanner.tsx
web/src/views/GridView.tsx        §9.5 group grid (1/2/2x2/3x2, cap 6)
web/src/lib/sessions.ts (spawn helper + notif perm), useNotifications.ts (§11)
```

### M4 critical fixes (non-obvious — keep)
1. **Strip CLAUDE_CODE_* env when spawning PTYs** (`pty/manager.ts cleanEnv`).
   If Deck is launched from inside a Claude Code session, the inherited
   `CLAUDE_CODE_CHILD_SESSION=1` / `CLAUDE_CODE_SESSION_ID` make a nested claude
   run as a child that NEVER writes its own transcript → §5.2 linkage silently
   fails. Stripping `^CLAUDE(CODE)?(_|$)` makes spawned claude a top-level session.
2. **Live-append baseline must be independent of the parse cache**
   (`transcripts/registry.ts emittedSigs`). The owned-status ticker also calls
   getParsed (refreshing the mtime cache), which would "consume" the change
   before onFileChanged's diff saw it → no transcript.append. emittedSigs is a
   separate per-subscription baseline, seeded on subscribe.
3. **Feed subscribes to its transcript topic regardless of live status**
   (`feed/Feed.tsx`). Gating on working/attention raced the status flip after a
   composer send and dropped the first append.
Transcript is created by claude on the FIRST message, not at spawn.

### M3 file map additions
```
server/src/transcripts/parser.ts    jsonl -> TranscriptEvent[] (TOLERANT: skips
                                    unknown line/block types, never throws).
                                    tool pairing by tool_use_id, Edit/Write/
                                    MultiEdit -> mini-diff (diff pkg), sidechain
                                    grouping -> subagent cards, humanized titles
server/src/transcripts/status.ts    §7.4 status heuristics, lastActivityLine,
                                    cheap eventSignature for live diffing
server/src/transcripts/registry.ts  session index, mtime-cached parse (LRU 24),
                                    externalSessions() (<30min), sessionsForProject
                                    (live/history), onFileChanged live-diff emit,
                                    tickExternal (status transitions)
web/src/lib/markdown.ts             marked -> HTML (.deck-md styles in tokens.css)
web/src/components/diff/DiffLines.tsx   shared DiffLine[] renderer (feed + git)
web/src/components/feed/FeedEvent.tsx   per-kind event renderer
web/src/components/feed/Feed.tsx        virtualized, full-load via backward
                                        pagination, live append, following pill
web/src/components/project/AgentsTab.tsx  live + history
web/src/components/session/AdoptBanner.tsx  §7.5 read-only + Adopt (M4)
```

### M2 file map additions
```
server/src/pty/manager.ts     full ConPTY PtyManager: spawn (shell=pwsh -NoLogo;
                              claude via resolved bin/shim), 2MB RingBuffer,
                              @xterm/headless + SerializeAddon for reattach,
                              onData/onExit listeners, kill/dispose, 24h exited retain
server/src/pty/ringBuffer.ts  bounded 2MB raw-output ring (reattach fallback)
server/src/sessions/manager.ts owned Session registry: create/kill/rename/input
                              (bracketed-paste multiline), status heuristics,
                              running-count sync, 5s status ticker, external provider hook (M3)
server/src/ws/term.ts         /ws/term/:id binary bridge; sync snapshot-then-attach
web/src/lib/termSocket.ts     binary WS client (arraybuffer frames + JSON control)
web/src/lib/termTheme.ts      §8.4 ANSI ITheme
web/src/components/terminal/Terminal.tsx  xterm + WebGL/fit/search/unicode11/web-links,
                              debounced fit, WT clipboard, bell glow, in-term search,
                              global-shortcut key escape
web/src/components/session/SessionHeader.tsx
web/src/views/SessionView.tsx (shell = full-pane terminal)
web/src/components/project/TerminalsTab.tsx (live embedded terminal grid + new tile)
```
Import note: `@xterm/headless` + `@xterm/addon-serialize` are CJS — default-import
and destructure (`const { Terminal } = HeadlessPkg`); named ESM import fails.

## Gotchas
- Bin resolution: vite/tsx live in workspace `.bin`; root scripts delegate via
  `bun run --filter @deck/<pkg> <script>`. Don't call `vite`/`tsc` from repo root.
- `claude` binary resolution: `where claude` → typically an npm/nvm `claude.cmd` shim; overridable via `deck.config.json` `claudeBin`.
- node-pty@1.1.0 ships win32-x64 prebuilds (`prebuilds/win32-x64/{pty,conpty}.node`) — no native build.
- Windows `fs.watch` fires on content writes, not mtime-only touches (see deviation #1).
- Virtualized feed MUST set `scrollbar-gutter: stable` on the scroll container.
  Without it, variable-height rows toggle the scrollbar, which changes content
  width → re-wraps text → changes height → toggles scrollbar: a ResizeObserver
  feedback loop that freezes the renderer for 30s+ on large transcripts. Fixed
  in `web/src/components/feed/Feed.tsx`.
- `@xterm/headless`, `@xterm/addon-serialize` are CJS: default-import + destructure.
- **Shift/Ctrl/Alt+Enter = newline in claude terminals.** xterm sends plain `\r`
  for Enter regardless of modifiers, so claude's TUI submitted instead of adding
  a newline. `Terminal.tsx` custom key handler now maps mod+Enter → `\x1b\r`
  (ESC+CR = macOS Option+Enter / what `/terminal-setup` emits), which claude
  treats as an inserted newline. Gated behind the `claudeNewline` prop
  (ClaudeSessionView + owned-claude GridView cells set it) — NOT for shell PTYs,
  where the ESC prefix would clear the PSReadLine buffer. The pretty Composer
  already does Shift+Enter=newline via textarea default.
