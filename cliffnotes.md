# Deck — CliffNotes

> Living map of Deck, a localhost mission-control web app for projects + Claude
> Code agents. Read this before any coding session. Spec of record: `SPEC.md`
> (locked). Build order: milestones M0→M6 in SPEC §13.

Last updated: M0–M6 complete + verified (2026-07-04); **V2 M7–M17 built**
(2026-07-05, typecheck + prod build green, live UI unverified — see V2 section).
**V3 M18–M20 built** (2026-07-05, no spec — built direct; see V3 section).

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

**M12 — AI tab titles/summaries.** `ai/liveMeta.ts` 120s ticker labels sessions
with an OPEN tab/feed only (owned live + subscribed transcripts via
`eventHub.hasSubscribers`), change-gated (transcript sig / ring-tail sha1),
`Session.aiMeta`. Client title precedence via `lib/sessions.ts displayTitle()`
(user rename > aiMeta.title > default name matching `/ (sh|cc)·[0-9a-f]{4}$/`).

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

**M17 — task board.** `state.tasks` + `state.autopilot`; `tasks/service.ts`
(create/update/delete/startTask) + `tasks/autopilot.ts` (15s drain). `routes/
tasks.ts` (note `/tasks/autopilot` registered before `/tasks/:id`). `views/
BoardView.tsx` (6 columns, pre-run manual + derived-from-session; native DnD;
NewCardComposer w/ PromptToolbar; autopilot toggle). `stores/tasksStore.ts`,
`tasks.updated` WS.

**Top-level view mechanism:** `uiStore.topView: "costs"|"ai"|"digest"|"board"`
(replaced the old `costsOpen` bool) routed in `App.tsx`; Rail footer icons +
palette entries. New small primitives: `components/ui/Switch.tsx`,
`components/ui/Toast.tsx` (`toast()` + `<Toaster/>`), `deck-shake` anim.

**V2 gotchas:** (1) server needs restart for new state shape; (2) CLI AI prompt
via stdin (not argv); (3) FTS sentinels are PUA U+E000/E001 — keep server+client
in sync; (4) `liveMeta`/`reviews`/`autopilot` all await `aiComplete`
sequentially (per-feature in-flight guard drops concurrent calls); (5) stray
`server/src/_verify.tmp.ts` is a leftover Library-feature harness (not mine;
harmless, typechecks).

---

## V3 — runbook / system suite / stack intelligence (M18–M20) built 2026-07-05

Typecheck (both) + web prod build green; **live UI unverified, needs server
restart + `bun install`** (new dep: `pg` + `@types/pg`). No state-shape change.
Builds on the parallel-session Library feature (`projects/inspector.ts`,
`projects/ports.ts` portWatcher, `screenshots.ts`).

**M18 — runbook + Preview tab.** `deck.run.json` at each repo root =
machine-readable "how to run/test" (`Runbook`: dev{command,port,url} / test /
install / notes). `server/src/runbook/service.ts`: read/sanitize/write, detection
fallback from inspector (dev/start script + runner + staticPorts), `probePort`
TCP probe, AI generate (feature id `runbook`, cli backend w/ cwd, writes the
file). Routes `routes/runbook.ts`: GET/PUT `/projects/:id/runbook`, GET
`…/runbook/status` (effective port = file > livePorts), POST `…/runbook/generate`.
Root project 404s. Client `components/project/PreviewTab.tsx` (new "preview"
view tab): **iframe of the running app** (dev servers send no X-Frame-Options),
mobile-390px frame toggle, reload/open-external, Start-dev button = visible
shell session (`createSession{kind:"shell",command}` — same as Library run
buttons), Test button, inline runbook editor + ✨Generate. Status poll: 3s until
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
  deck.config.json        optional overrides (root/port/claudeDir/claudeBin/defaultShell)
  shared/src/index.ts     ALL shared types (single source of truth) — pkg @deck/shared
  server/  (Node 22 via tsx; NOT bun runtime — node-pty needs stable ConPTY)
    src/
      index.ts            fastify bootstrap: /ws/events, /ws/term, /api/*, static (prod), SPA fallback
      config.ts           config + deck.config.json overrides. repoRoot, root, port, claudeDir…
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
`G:\code\scenebeans2`→`G--code-scenebeans2`, `G:\code\shitpost.gg`→`G--code-shitpost-gg`.
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
- `claude` binary on this machine: `C:\nvm4w\nodejs\claude.cmd` (via `where claude`).
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
