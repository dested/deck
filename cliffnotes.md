# Deck — CliffNotes

> Living map of Deck, a localhost mission-control web app for projects + Claude
> Code agents. Read this before any coding session. Spec of record: `SPEC.md`
> (locked). Build order: milestones M0→M6 in SPEC §13.

Last updated: ALL milestones M0–M6 complete + verified (2026-07-04).

---

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
