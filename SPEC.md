# DECK — Agent & Project Mission Control

**A single localhost web app that replaces GitKraken + scattered Windows Terminal windows for a developer running many concurrent Claude Code agents across ~185 projects in `G:\code`.**

This document is the complete build specification. It is written to be followed **to the letter** by an implementing agent with zero additional context. Where the spec says "verify against reality," do that — do not guess. Everything else is a locked decision; do not re-litigate it.

---

## 0. Context you must internalize first

- The user is a fast-moving solo developer on **Windows 11**. All projects live in `G:\code\<folder>`. A folder containing `.git` is a project (~160 of ~185 folders qualify).
- The user runs **multiple Claude Code CLI sessions simultaneously** in PowerShell tabs. Claude Code writes live transcripts to `C:\Users\dested\.claude\projects\<encoded-path>\<session-uuid>.jsonl` where the encoded path is the project cwd with `:` and `\` replaced by `-` (e.g. `G:\code\scenebeans2` → `G--code-scenebeans2`).
- The user manages git *through* Claude mostly, but wants first-class git UI for reviewing/staging/committing directly.
- This repo (`G:\code\agentcommunity`) is where the app lives. The product name is **Deck**. The app binds to **127.0.0.1:12345** only.
- The user's quality bar: "world class." Specifically the embedded terminal "has to look right and good — if it sucks I'm not gonna use it." Treat terminal quality as a P0 feature, not a widget.

### Locked product decisions
1. **Platform**: Web app served from a local Node server. React 19 + TypeScript + Tailwind CSS v4 + Vite frontend. No Electron, no Tauri.
2. **Session model — hybrid**:
   - *App-owned sessions*: Deck spawns `claude` (and plain shells) in server-side PTYs, rendered in embedded xterm.js terminals. Full control: type, kill, restart, name, group.
   - *External sessions*: sessions still running in the user's Windows Terminal are shown **read-only** via live transcript tailing. (Embedding an existing external terminal is impossible; do not attempt it.)
3. **Grouping is for sessions, not projects**: named groups like "frontend" or "game servers," each holding N sessions possibly spanning multiple projects. Projects themselves are a flat recency-sorted list.
4. **Arbitrary terminals**: the user can open plain shell terminals (default `pwsh`) in any project cwd — for `bun dev`, servers, whatever. Same terminal quality bar.
5. **Vibe**: clean, minimal, professional — Linear-esque. Explicitly NOT a "war games console." No CRT effects, no fake radar, no gratuitous glow. Calm, dense-enough, dark.

---

## 1. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Package manager / scripts | **Bun** (workspaces) | User is a Bun user. |
| Server runtime | **Node.js 22+** | NOT Bun runtime — `node-pty` (native ConPTY binding) must be rock solid on Windows. Run via `tsx`. |
| Server framework | **Fastify** + `@fastify/websocket` | REST + WS on one port (12345). Serve built frontend statically in prod; in dev, Vite runs separately on 12346 and proxies `/api` + `/ws` to 12345. |
| PTY | **node-pty** (latest, ConPTY) | Spawns `pwsh.exe` and `claude` sessions. |
| Frontend | React 19, TypeScript strict, Vite, Tailwind v4 | |
| UI primitives | **Radix UI** primitives (dialog, dropdown, tooltip, context-menu, tabs, scroll-area) styled from scratch with the token system in §8. Do NOT use stock shadcn styling — it will look generic. | |
| Terminal | **@xterm/xterm** + addons: `@xterm/addon-webgl` (fallback canvas), `fit`, `unicode11`, `web-links`, `search`, `serialize` | |
| Editor | **monaco-editor** via `@monaco-editor/react` | Lazy-loaded chunk. |
| Git | Shell out to `git` CLI (via `execa`) with `--porcelain=v2 -z` parsing. No isomorphic-git, no simple-git (its parsing is lossy). | |
| FS watching | **chokidar v4** | Three watcher tiers, see §4.3. |
| Client state | **zustand** for app state + a thin WS-event layer. **@tanstack/react-query** for request/response data (git status, file trees, transcripts pagination). | |
| Virtualization | **@tanstack/react-virtual** for file tree, transcript feed, project list | |
| Fonts | **Inter** (UI) and **JetBrains Mono** (code/terminal), self-hosted woff2 in `/public/fonts`. No CDN fonts. | |
| Icons | **lucide-react** at 16px default, stroke-width 1.75 | |
| Persistence | Single JSON state file `~/.deck/state.json`, written atomically (write temp + rename), debounced 500ms | Groups, session names, project pins/hides, UI prefs. |

Monorepo layout:

```
agentcommunity/
  package.json            # workspaces: ["server", "web"], scripts: dev, build, start
  bun.lock
  SPEC.md                 # this file
  cliffnotes.md           # create and maintain per global instructions
  server/
    package.json
    src/
      index.ts            # fastify bootstrap, static serving, ws upgrade routing
      config.ts           # ROOT=G:\code, PORT=12345, CLAUDE_DIR=~/.claude (all overridable via deck.config.json at repo root)
      state.ts            # ~/.deck/state.json load/save, typed
      projects/
        scanner.ts        # project discovery + activity scoring (§4.1)
        watcher.ts        # chokidar tiers (§4.3)
      git/
        service.ts        # all git ops (§6)
        diffParser.ts     # unified diff → hunk model
      pty/
        manager.ts        # PTY lifecycle, ring buffers, reattach (§5)
      transcripts/
        locator.ts        # project path ↔ encoded transcript dir mapping
        parser.ts         # jsonl → TranscriptEvent[] (§7)
        tailer.ts         # incremental live tail per watched file
        status.ts         # session status heuristics (§7.4)
      files/
        tree.ts           # lazy dir listing, ignore rules
        io.ts             # read/write file with size guards
      ws/
        events.ts         # /ws/events pub-sub hub
        term.ts           # /ws/term/:id binary bridge
  web/
    package.json
    index.html
    src/
      main.tsx, App.tsx
      theme/tokens.css     # §8 design tokens as CSS custom properties
      lib/                 # ws client, api client, types (shared via server/src/types re-export or a shared/ package — implementer's choice, keep types in ONE place)
      stores/              # zustand stores
      components/          # per §9 component inventory
      views/               # per §9 screens
```

---

## 2. What Deck is, in one screen-flow paragraph

The left sidebar lists **Sessions** (grouped into user-named groups, with live status dots) above **Projects** (recency-sorted, searchable). The home view is a **Sessions overview**: one card per running/recent session showing project, name, status, and its latest activity line. Clicking a session opens the **Session view**: a beautifully rendered agent transcript feed with an embedded terminal (app-owned) or a read-only feed (external). Clicking a project opens the **Project view** with tabs: **Agents · Git · Files · Terminals**. Git tab = full staging/commit UI with hunk and full-file diffs. Files tab = virtualized tree + Monaco. `Ctrl+K` opens a command palette to jump anywhere, spawn sessions, and kill them. A group can be opened as a **Grid view** showing 2–6 of its terminals/feeds simultaneously.

---

## 3. Server ↔ client protocol

### 3.1 REST (all under `/api`)

```
GET  /api/projects                          → ProjectSummary[] (sorted by activity desc)
GET  /api/projects/:id                      → ProjectDetail (id = folder name, e.g. "scenebeans2")
GET  /api/projects/:id/tree?path=rel/sub    → TreeNode[] (one level, lazy)
GET  /api/projects/:id/file?path=...        → { content, language, size, truncated }  (refuse >2MB with truncated:true metadata; binary → { binary:true })
PUT  /api/projects/:id/file?path=...        → save (Monaco edits)
GET  /api/projects/:id/git/status           → GitStatus (branch, ahead/behind, staged[], unstaged[], untracked[], conflicted[])
GET  /api/projects/:id/git/diff?path&staged=bool&context=3 → { hunks: Hunk[], raw: string, binary?: true }
GET  /api/projects/:id/git/file-at-head?path→ { content }        (for Monaco full-file diff: HEAD vs worktree)
POST /api/projects/:id/git/stage            { paths: string[] }
POST /api/projects/:id/git/unstage          { paths: string[] }
POST /api/projects/:id/git/stage-hunk       { path, hunkHeader, patch }   (git apply --cached)
POST /api/projects/:id/git/unstage-hunk     { path, hunkHeader, patch }   (git apply --cached -R)
POST /api/projects/:id/git/discard          { paths: string[] }           (CONFIRM in UI, uses git checkout -- / clean -f for untracked)
POST /api/projects/:id/git/commit           { message, amend?: bool }
GET  /api/projects/:id/git/log?limit=50     → Commit[] (hash, subject, author, date, refs)
GET  /api/projects/:id/git/show?hash        → { files: FileChange[], hunksByFile }
GET  /api/sessions                          → Session[] (app-owned + external, see §5/§7 model)
POST /api/sessions                          { projectId, kind: "claude"|"shell", name?, groupId?, claudeArgs?: string[] }  → Session
POST /api/sessions/:id/kill                 (SIGKILL the pty; external sessions → 400)
POST /api/sessions/:id/rename               { name }
POST /api/sessions/:id/input                { text, submit: bool }   (writes to pty stdin; bracketed paste for multiline, then \r if submit)
GET  /api/sessions/:id/transcript?before=N  → TranscriptEvent[] (paginated backward, 200/page)
GET  /api/groups                            → Group[]
POST /api/groups                            { name } | PATCH rename | DELETE (sessions become ungrouped)
POST /api/groups/:id/assign                 { sessionId }   (a session belongs to ≤1 group)
```

`ProjectSummary`: `{ id, path, name, activityAt, branch, dirtyCount, aheadBehind, runningSessionCount, pinned, hidden }`.

### 3.2 WebSockets

- **`/ws/events`** — JSON. Client subscribes: `{ op:"sub", topics:["projects","sessions","git:scenebeans2","transcript:<sessionId>"] }`. Server pushes:
  - `{ t:"projects.updated", payload: ProjectSummary }` (activity bump, dirty count change)
  - `{ t:"sessions.updated", payload: Session }` (status change, new, exit)
  - `{ t:"git.updated", projectId }` (client refetches status — do not push full diffs)
  - `{ t:"transcript.append", sessionId, events: TranscriptEvent[] }` (live tail)
  - `{ t:"session.attention", sessionId, reason }` (drives notifications, §11)
- **`/ws/term/:ptyId`** — raw bridge. Server→client: binary frames of PTY output. Client→server: JSON `{ op:"input", data }` and `{ op:"resize", cols, rows }`. On connect, server first sends the serialized ring buffer (§5.3) so reattach restores the screen instantly.

---

## 4. Project discovery & recency

### 4.1 Scanner
On boot and every 60s, enumerate direct children of `G:\code`. A child with `.git` (dir or file) is a project. Compute **activityAt** = max of:
1. mtime of `<repo>/.git/index` (touched by stage/commit/status refresh)
2. mtime of `<repo>/.git/HEAD` and `.git/FETCH_HEAD` if present
3. newest `*.jsonl` mtime in the matching `~/.claude/projects/<encoded>*` dirs (including subdirectory-cwd variants — a transcript dir `G--code-scenebeans2-sub` also maps to project `scenebeans2`; match by longest prefix against known project paths)
4. last PTY activity of any app-owned session for that project

Do **not** recursively stat project contents for recency — too slow across 185 repos.

`dirtyCount` and `branch`: run `git status --porcelain=v2 --branch -z` lazily — on project open, on `git.updated`, and for the top 30 projects by activity on boot (parallel, concurrency 8). Cache; invalidate via watcher.

### 4.2 Encoded-path mapping
Encoding: full absolute cwd, every character that is not `[A-Za-z0-9-]` replaced with `-` (verify against real dirs in `~/.claude/projects` — e.g. `G:\code\shitpost.gg` → `G--code-shitpost-gg`). Build the reverse map by encoding each known project path and prefix-matching transcript dir names.

### 4.3 Watcher tiers (chokidar)
1. **Root tier**: watch `G:\code` depth 0 — add/remove of project folders.
2. **Transcript tier**: watch `~/.claude/projects` depth 1 for `*.jsonl` add/change. This is the heartbeat of the whole app: every change event triggers the tailer (§7.3) and bumps project activity.
3. **Repo tier**: only for **open** projects (visible in a client): watch `<repo>/.git/index`, `.git/HEAD`, `.git/refs` plus the worktree with `ignored: [node_modules, .git, dist, build, .next, target, *.log]`, `depth: 6`, debounce 300ms → emit `git.updated`. Tear down watchers when no client has the project open for 5 minutes.

---

## 5. PTY manager & the world-class terminal (P0)

### 5.1 Server side
- `PtyManager` holds `Map<ptyId, { pty, ringBuffer, meta }>`. Spawn with `node-pty`: `useConpty: true`, `cols/rows` from client, `cwd` = project path, env inherited.
- **Shell sessions**: `pwsh.exe -NoLogo`.
- **Claude sessions**: spawn `pwsh.exe -NoLogo -Command claude <args>`? No — spawn `claude` directly (it's a `.cmd` shim on Windows; resolve via `where claude` once at boot; spawn through `pwsh -NoExit -Command "& claude ..."` ONLY if direct ConPTY spawn of the shim misbehaves — test both, pick the one where resize + colors + exit codes work correctly).
- PTYs **survive client disconnects** (browser refresh). They die only on explicit kill, process exit, or server shutdown.
- On process exit: keep the session entry with status `exited` + exit code for 24h (so the user sees *that* it died), ring buffer retained until dismissed.

### 5.2 Claude session ↔ transcript linkage
When Deck spawns a claude session it must find the transcript file that session writes, to power the parsed agent view. Strategy: snapshot the set of `*.jsonl` in the project's transcript dir at spawn; the first **new** jsonl file to appear after spawn belongs to this session (verify `cwd` field inside its first entries matches). Store the linkage in state so it survives restarts.

### 5.3 Ring buffer & reattach
Keep the last **2MB** of raw output per PTY. On WS reattach, replay it before going live. Additionally run a headless `@xterm/headless` + serialize addon server-side per PTY so reattach can send a compact serialized screen state instead of replaying megabytes — implement headless-serialize first; fall back to raw replay if it proves flaky.

### 5.4 Frontend terminal quality checklist (all required)
- WebGL renderer, canvas fallback. 
- Font: JetBrains Mono 13px, line-height 1.35, ligatures ON, `fontWeightBold: 600`.
- Theme derived from §8 tokens (background `--bg-panel`, ANSI palette specified in §8.4) — terminal background must be indistinguishable from the surrounding panel (no visible "widget rectangle").
- Padding: 12px inset; the terminal is chrome-less (no inner border) inside its pane.
- Fit addon + ResizeObserver → debounced (50ms) `resize` to PTY. Resize must never garble the screen (this is the classic ConPTY failure — test with `claude` running and vertically resizing).
- Scrollback 50,000 lines. Smooth scrolling OFF (instant, professional).
- `Ctrl+Shift+F` in-terminal search (search addon) with match highlight.
- Clickable URLs (web-links addon). Copy on select: OFF by default; `Ctrl+Shift+C`/`Ctrl+Shift+V` copy/paste; right-click = paste if selection empty else copy (Windows Terminal behavior).
- Multiline paste goes through **bracketed paste mode**.
- Latency: write incoming WS data to xterm immediately (xterm batches internally); never buffer on an interval >16ms.
- Bell: visual only — brief 150ms border-glow of the pane in `--accent`; never audio.
- When a session has unread output while not focused, its sidebar dot pulses once (see §8.5) and shows an unread indicator; clearing on focus.

**Acceptance test for this section**: run `claude` inside a Deck terminal, use it for a real task, resize the pane repeatedly, `Ctrl+K`-away and come back, refresh the browser — screen must restore perfectly and typing must feel native. Run `bun dev` for a vite app in a shell session — HMR log colors correct, links clickable.

---

## 6. Git panel

Everything through the `git` CLI. All commands run with `cwd` = repo, `env: { GIT_OPTIONAL_LOCKS: "0" }` to avoid lock contention with the user's other tools.

- **Status list**: two sections, **Staged** and **Changes** (unstaged + untracked merged, untracked marked with a dot-badge `U`). Each row: status glyph (M/A/D/R/U in status colors §8.4), filename with dimmed directory prefix, on-hover actions: stage/unstage (`+`/`−`), discard (trash, double-confirm inline — button turns into "Sure?" for 3s), open in Files tab.
- **Diff viewer** (right side of the git tab, master-detail): selecting a file shows its diff.
  - **Hunk view** (default): custom-rendered unified diff. Line numbers both sides, `+` lines with 8% green background tint, `−` with 8% red tint, word-level intra-line highlights (compute with `diff` npm package per changed line pair) at 18% tint. Hunk header row is sticky, shows `@@` context, and carries per-hunk **Stage hunk** / **Discard hunk** buttons (staged view: **Unstage hunk**).
  - **Full-file view** (toggle in header): Monaco diff editor, HEAD vs worktree (or index vs HEAD for staged), read-only, `renderSideBySide` auto (side-by-side ≥1100px pane width else inline).
- **Commit box**: bottom of the file list column. Single textarea (grows to 6 lines), placeholder "Commit message". `Ctrl+Enter` commits staged. Below: `Commit` button + staged file count; `Amend` in an overflow menu. After commit: toast with short hash, lists refresh.
- **Log**: collapsible section under the commit box, last 50 commits, row = subject + relative time + short hash; click opens read-only commit diff in the same viewer.
- Hunk staging: reconstruct a minimal patch (`diffParser.ts` keeps the raw hunk text + file header) and pipe to `git apply --cached --unidiff-zero -` via stdin. Test with CRLF files — pass `--ignore-whitespace` NEVER (would corrupt intent); instead ensure the patch is byte-faithful from `git diff` raw output.
- Everything refetches on `git.updated` events — the panel must feel *live* while a Claude agent is editing files in the same repo (this is the core demo: watch changes appear as the agent works).

---

## 7. Transcripts → the Agent View (the most important feature)

### 7.1 Ground truth
Before writing the parser, **read 3–4 real transcripts** from `C:\Users\dested\.claude\projects\G--code-scenebeans2\` (45 sessions available) and `G--code-coterietax-com\`. The parser must be built against the real schema, tolerantly: **unknown line types and unknown content block types must be skipped without error, never crash the feed.**

Known line shapes (verify): each line is JSON with `type`. Relevant types: `user`, `assistant`, `system`, `summary`, `progress`, plus metadata lines (`mode`, `permission-mode`, `file-history-snapshot`, ...). `user`/`assistant` lines carry `{ uuid, parentUuid, timestamp, sessionId, cwd, gitBranch, isSidechain?, message }` where `message` is Anthropic API format: `role`, `content` as string or array of blocks (`text`, `thinking`, `tool_use`, `tool_result`, `image`). Tool results arrive as `user` lines containing `tool_result` blocks referencing `tool_use_id`. Sidechain lines (`isSidechain: true`) are subagent activity.

### 7.2 Parsed model
Transform lines into a flat, render-ready `TranscriptEvent[]`:

```ts
type TranscriptEvent =
  | { kind:"user";       id; ts; text; images?: number }
  | { kind:"assistant";  id; ts; markdown }                       // text blocks
  | { kind:"thinking";   id; ts; chars: number }                  // collapsed by default, expandable to full text
  | { kind:"tool";       id; ts; name; icon; title; detail; status:"ok"|"error"|"pending"; input; resultPreview; isEdit?: { path, structuredDiff } }
  | { kind:"subagent";   id; ts; description; eventCount; events: TranscriptEvent[] }   // sidechains folded into one expandable card
  | { kind:"meta";       id; ts; label }                          // model/mode changes, compact one-liners
```

Tool pairing: match `tool_result` to its `tool_use` by id; a `tool_use` without result yet is `pending` (this is how "currently running" is shown live). `title` is a humanized one-liner: `Read src/App.tsx`, `Edit server/pty/manager.ts`, `Bash: bun test`, `Grep "useWindows"`. For **Edit/Write/MultiEdit** tools, parse `input.old_string/new_string` (or `content`) into a mini-diff and render it with the same diff styling as §6 — this is the highest-value rendering in the app; agents' edits must be scannable at a glance.

### 7.3 Live tail
`tailer.ts` keeps per-file byte offsets; on chokidar change, read from offset, split complete lines (buffer partial trailing line), parse, emit `transcript.append`. Handle file truncation (offset > size → reset and re-parse). Initial load of a session: parse the whole file once, serve paginated from memory (LRU cache, ~20 sessions, drop on memory pressure).

### 7.4 Session status heuristics
A `Session` unifies app-owned PTYs and external transcripts:

```
status: "working"   — transcript modified <20s ago, OR last event is a pending tool_use
        "attention" — last meaningful event is an assistant message ending the turn (a question/completion awaiting user input) AND file idle >5s; ALSO any permission-prompt indicator found in the transcript tail (verify what permission requests look like in real transcripts; if not present in jsonl, detect via app-owned PTY output heuristics — look for the permission UI escape sequences — best effort, external sessions may miss this)
        "idle"      — no activity 20s–30min, turn complete
        "stale"     — no activity >30min (external sessions: probably closed; demote to history)
        "exited"    — app-owned pty died
```

External session discovery: any `*.jsonl` modified in the last 30 min that is NOT linked to an app-owned PTY = an external live session. Older ones are **history** — the project's Agents tab lists past sessions (by summary line / first user message) and can open them read-only. History is also where "what did that agent do yesterday" gets answered — same feed renderer.

### 7.5 Composer (sending messages)
- App-owned claude sessions: the Session view has a message composer (single-line growing to multiline, `Enter` sends, `Shift+Enter` newline). Send = bracketed-paste the text into the PTY then `\r`. It's the same as typing in the terminal, but lets the user interact from the pretty feed without focusing the terminal pane.
- External sessions: composer hidden, replaced by a subtle inline note: `Read-only — running in an external terminal`, with a button **Adopt…** → explains: kill it in Windows Terminal, then Deck starts `claude --resume <sessionId>` in a new app-owned terminal (Deck knows the sessionId from the filename). This is the migration path; make it one click + confirm.

---

## 8. Design system — "calm precision"

Linear-esque: dark, quiet, exact. The interface should feel engineered, not decorated. Nothing pulses, glows, or animates unless it's communicating live agent activity, and even then: restrained.

### 8.1 Color tokens (CSS custom properties in `theme/tokens.css`)
```
--bg-root:      #0D0E11;   /* app background */
--bg-panel:     #131418;   /* sidebar, cards, terminal bg */
--bg-raised:    #1A1C21;   /* hover states, active rows, inputs */
--bg-overlay:   #1E2026;   /* dropdowns, dialogs, palette */
--border:       #26282F;   /* 1px hairlines everywhere; NEVER pure gray-500 borders */
--border-focus: #444A58;   /* hovered/focused container borders */
--text-1:       #E6E7EB;   /* primary — never pure white */
--text-2:       #9DA0A8;   /* secondary: labels, timestamps, dimmed paths */
--text-3:       #62656E;   /* tertiary: placeholders, disabled */
--accent:       #6E7BD9;   /* indigo — links, focus rings, primary buttons, selection */
--accent-text:  #AAB3F0;
--ok:           #46B486;   /* working/green status, + diff */
--warn:         #D9A03F;   /* attention/amber status */
--err:          #D75455;   /* errors, − diff, kill actions */
--diff-add-bg:  rgba(70,180,134,0.09);  --diff-add-hl: rgba(70,180,134,0.22);
--diff-del-bg:  rgba(215,84,85,0.09);   --diff-del-hl: rgba(215,84,85,0.22);
```
Elevation via background steps + hairline borders only — **no drop shadows** except dialogs/palette (`0 8px 32px rgba(0,0,0,0.45)`).

### 8.2 Typography & spacing
- UI: Inter, base **13px/20px**, weights 400/500/600 only. Section headers: 11px/16px, 600, letter-spacing 0.06em, uppercase, `--text-3`.
- Code/paths/hashes/terminal: JetBrains Mono 12.5px.
- Spacing on a 4px grid. Sidebar rows 30px. Panel padding 16px. Radius: 6px (controls), 8px (cards/panels), 10px (dialogs).
- Timestamps: relative ("2m", "3h"), `--text-2`, mono, tabular.

### 8.3 Motion
120ms ease-out for hovers/reveals, 180ms for panel transitions. Command palette: 140ms fade+2px rise. **No** layout-shifting animation in the transcript feed — new events appear instantly (opacity 0→1 over 100ms max). Status dot for `working`: gentle opacity oscillation 1↔0.45 over 2.4s — the only perpetual motion in the whole app.

### 8.4 Status & ANSI
Status dots: 7px circles — `working` `--ok` (pulsing), `attention` `--warn` (steady + the row itself gets a subtle warn-tinted left edge, 2px), `idle` `--text-3`, `exited/stale` hollow ring. Attention states must be visible from across the room without being alarmist.

Terminal ANSI palette (professional, matched to tokens): background `#131418`, foreground `#D8DAE0`, black `#1A1C21`, red `#D75455`, green `#46B486`, yellow `#D9A03F`, blue `#6E7BD9`, magenta `#B98AD9`, cyan `#5FB8C9`, white `#D8DAE0`, brights one step lighter (`#E66869`, `#5BCB9B`, `#E8B45C`, `#8B96E8`, `#CBA0E8`, `#79CBDB`, `#EDEEF2`, bright black `#4A4D57`). Selection `rgba(110,123,217,0.28)`. Cursor `#AAB3F0`, bar style, blink on.

### 8.5 Feel rules
- Density: information-rich but never cramped; when in doubt add 4px, not a border.
- Hairlines separate regions; backgrounds separate interactive states.
- Every interactive element has a visible `:focus-visible` ring (`--accent`, 2px offset 1px) — full keyboard operability.
- Empty states: one quiet sentence + one action button. No illustrations.
- Loading: 300ms delay before any spinner; prefer skeleton rows (bg-raised shimmer OFF — static skeletons).
- Tooltips (300ms delay) on every icon-only button.

---

## 9. Screens

### 9.1 App shell
- **Left sidebar, 264px fixed** (collapsible to 0 with `Ctrl+B`):
  - Top: Deck wordmark (12px, 600, `--text-2`) + global search input (filters projects; `/` focuses it).
  - **SESSIONS** section: groups as collapsible headers (name + running-count), sessions as rows: status dot, session name (user-given or auto: project name + short id), dimmed project name if the group spans projects. Ungrouped sessions under "Other". Drag a session row onto a group header to assign (also available via context menu — implement context menu first, DnD is polish).
  - **PROJECTS** section: recency-sorted rows: name, right-aligned cluster: dirty-count badge (e.g. `12` in `--text-2`; hidden when clean) + tiny status dot if it has a working session. Pinned projects float to top with a pin glyph. Context menu: Pin, Hide, New Claude session, New terminal, Open in Explorer, Copy path. Hidden projects behind a "Show N hidden" footer row.
- **Main area**: the active view. **Tab bar** at top (like editor tabs): each opened session/project/grid is a tab, `Ctrl+W` closes, `Ctrl+Tab` cycles, middle-click closes. Tabs persist in state across reloads.
- **Command palette** `Ctrl+K`: fuzzy actions — "Open project …", "Open session …", "New Claude session in …", "New terminal in …", "Kill session …", "Open group grid …", "Git: commit staged in …". Recents first.

### 9.2 Home — Sessions overview (default tab, ⌂)
Responsive card grid (min 320px cards). Card = status dot + name + project + group chip; body: the **live last-activity line** (e.g. `⚒ Edit src/hooks/useWindows.ts` or the last assistant sentence, single line, ellipsized, updates via WS); footer: relative time + kind icon (claude/shell) + kill button on hover. `attention` cards sort first, then `working`, then idle; section break "Earlier today / This week" for history. Clicking → Session view. An **empty-state** with "New Claude session" button when nothing is live.

### 9.3 Session view
Header: status dot, editable name (click to rename), project link, group assign dropdown, actions: `Restart` (claude: kill + `--resume`), `Kill`, `Open terminal ⌄` (toggles layout).
- **App-owned claude session**: split view — left **Agent feed** (60%), right **Terminal** (40%), draggable divider, terminal collapsible (then feed is full-width with composer). The feed (§7.2 events, virtualized):
  - user events: right-aligned-ish? **No** — everything left-aligned; user messages get a 2px `--accent` left edge and `--bg-raised` background, 8px radius.
  - assistant markdown: rendered (marked/markdown-it + Shiki for code blocks using a theme matching §8.4; code blocks in `--bg-panel` with copy button).
  - tool events: one-line rows — icon + title + status glyph (✓ dim, ✗ `--err`, spinner if pending) + relative time; click expands to input/result preview (mono, max-height 320px scroll). Edit tools expand to mini-diffs (rendered like §6 hunks).
  - thinking: `— thought for a moment (2.1k chars)` one-liner in `--text-3`, click expands.
  - subagent cards: `⑂ Explore: "find the pty code" — 14 events`, expandable to a nested, indented feed.
  - Consecutive tool events auto-group into a tight cluster (4px gaps) between assistant paragraphs.
  - Sticky "↓ following" pill: auto-scroll pinned to bottom while at bottom; scrolling up unpins; pill click repins. New-events divider line when returning.
  - Composer at bottom (§7.5).
- **Shell session**: terminal full-pane, no feed.
- **External session**: feed full-width, read-only banner + **Adopt** (§7.5).

### 9.4 Project view (tabs inside the main tab: Agents · Git · Files · Terminals)
Header strip: project name, branch chip (mono), dirty count, activity time, buttons: `New session ⌄` (Claude session / Terminal), `Explorer`, `Copy path`.
- **Agents**: live sessions for this project as rows (open → Session view) above **History**: past transcript sessions (summary/first-message, date, event count) opening read-only feeds.
- **Git**: §6 layout — left column 380px (staged/changes lists + commit box + log), right: diff viewer.
- **Files**: left 280px virtualized lazy tree (dirs first, ignore list from §4.3 shown dimmed-collapsed not hidden... **hide** `node_modules/.git/dist/.next` behind a "show ignored" toggle); right Monaco (auto language by extension, dark theme customized to §8 tokens, minimap off, 13px JetBrains Mono, `Ctrl+S` saves via PUT). Git-modified files get amber dots in the tree.
- **Terminals**: grid of this project's shell sessions + "new terminal" tile.

### 9.5 Group grid view
Open from a group header ("Open grid"). Auto-layout: 1→1, 2→2 cols, 3–4→2×2, 5–6→3×2. Each cell: mini header (dot, name, project, kill) + the session's **terminal** (app-owned) or live feed tail (external). Click cell header → full Session view. This is the "watch 4 agents at once" screen; it must stay 60fps with 4 live terminals (WebGL instances are cheap; cap at 6 cells, beyond that show a chooser).

### 9.6 Settings (gear at sidebar bottom, dialog)
Root directory (default `G:\code`), port note, default shell, claude binary path (auto-detected, overridable), notification toggles, font size slider for terminals (12–15px).

---

## 10. Keyboard map (global)
```
Ctrl+K        command palette          /          focus sidebar search
Ctrl+B        toggle sidebar           Ctrl+W     close tab
Ctrl+Tab      next tab                 Ctrl+Shift+Tab  prev tab
Ctrl+1..9     jump to tab N            Ctrl+`     toggle terminal pane in session view
Ctrl+Enter    commit (git tab)         Ctrl+S     save file (Monaco)
```
Terminal panes swallow keys when focused except `Ctrl+K`, `Ctrl+Tab`, `Ctrl+W`, `Ctrl+B` (use xterm `attachCustomKeyEventHandler`).

---

## 11. Notifications
Browser Notifications API (request permission on first session spawn). Fire when a session transitions `working → attention` **and** the Deck tab is not focused, or the session isn't the active tab: title `"{name} needs input"`, body = last assistant line (120 chars). Clicking focuses the tab + session. Also update `document.title` to `(2!) Deck` with attention count, and the favicon gets a dot (two prebuilt favicons, swap). Per-session mute in the session header. No sounds.

---

## 12. Windows-specific gotchas (handle all)
- Paths: always `path.win32` semantics server-side; normalize to forward slashes at the API boundary; project ids are folder names, never full paths, in URLs.
- ConPTY resize garbling: debounce resizes, and after a resize storm send a final exact fit.
- `git` output: force `-c core.quotepath=false` and parse `-z` NUL-delimited everywhere; handle CRLF in diffs byte-faithfully.
- `where claude` may return multiple lines — take the first `.cmd`/`.exe`.
- File watching on `~/.claude/projects`: chokidar with `usePolling: false` first; if change events prove unreliable on that dir (Windows + heavy writes), fall back to polling `interval: 1000` for the transcript tier only.
- Long paths: pass through as-is, don't `realpath` (junctions common on dev machines).
- The server must handle `EBUSY`/`EPERM` transient errors on file reads (agents writing concurrently) with one 100ms retry.

---

## 13. Milestones — build in this order, verify each before proceeding

**M0 — Skeleton (½ day equiv):** monorepo, Fastify + Vite + Tailwind + tokens.css, sidebar/app-shell with dummy data, WS events plumbing echo test. `bun run dev` boots both; `bun run build && bun start` serves prod on 12345.

**M1 — Projects:** scanner, activity sort, live bumps via watcher, project list UI with dirty badges (lazy git status), project view shell with header + empty tabs. ✅ *Verify: touching a file in any repo via another terminal bumps it to top within 2s; dirty count matches `git status`.*

**M2 — Terminals (P0):** PtyManager, `/ws/term`, xterm component with full §5.4 checklist, shell sessions from project view + sidebar, reattach after refresh, kill/exited states, Terminals tab, tabs system. ✅ *Verify: acceptance test in §5.4 — including running `claude` interactively and a `bun dev` server.*

**M3 — Agent view:** transcript locator/parser/tailer, external session discovery, Session model + statuses, Sessions overview home, Session view with the full feed renderer (tools, edits-as-diffs, thinking, subagents, markdown, autoscroll), history browsing. ✅ *Verify: open a live external Claude session from Windows Terminal and watch events stream into the feed in real time; open a 1000+ event historical transcript and scroll — smooth, virtualized.*

**M4 — Own the sessions:** spawn claude sessions (transcript linkage §5.2), split feed+terminal session view, composer, kill/restart/resume, Adopt flow, groups (create/rename/assign/context menus), group grid view, notifications + title/favicon badges. ✅ *Verify: spawn a claude session from Deck, give it a task from the composer, watch feed+terminal stay in sync; group 3 sessions, open grid; background the tab, get a notification on attention.*

**M5 — Git:** full §6 — status lists, stage/unstage file + hunk, discard with confirm, custom hunk renderer with word-level highlights, Monaco full-file diff toggle, commit + amend, log + commit viewer, live refresh while an agent edits. ✅ *Verify: stage individual hunks in a file with mixed changes and confirm `git diff --cached` matches exactly; commit; watch the panel live-update while a Claude agent edits the same repo.*

**M6 — Files + polish:** tree + Monaco editing with save, command palette, full keyboard map, settings dialog, empty/loading states everywhere, focus rings, tooltips, 300ms-spinner rule, final visual QA pass against §8 (screenshot every screen; compare against the feel rules; fix drift). ✅ *Verify: keyboard-only session — spawn, message, commit — without touching the mouse.*

Each milestone ends with: typecheck clean (`tsc --noEmit` both packages), the milestone's verify steps actually performed against reality (real repos, real transcripts, real claude), and `cliffnotes.md` updated.

## 14. Out of scope (do not build)
Auth/multi-user, remote access, non-Windows support, GitHub/PR integration, branch management UI (switch/merge/rebase), Claude API usage (everything goes through the CLI + transcript files), transcript search across sessions (later), themes/light mode.
