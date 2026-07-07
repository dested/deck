import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { config } from "../config.js";
import { projectRegistry } from "./registry.js";
import { eventHub, topics } from "../ws/events.js";
import {
  buildEncodedIndex,
  matchDirToProject,
} from "../transcripts/locator.js";
import { onTranscriptFileChanged } from "../transcripts/tailer.js";
import { logCrash } from "../lib/crashGuard.js";

// EVERY chokidar watcher needs an error handler: on Windows, EPERM/EBUSY on a
// watched path (git locking .git/index, a repo being deleted, AV scans) emits
// an 'error' event, and an unhandled 'error' on an EventEmitter is an uncaught
// exception — it killed the whole server. Log and keep watching.
function guard(w: FSWatcher, name: string): FSWatcher {
  w.on("error", (err) => logCrash(`watcher:${name}`, err));
  return w;
}

// ---------------------------------------------------------------------------
// Tier 1 — roots: add/remove of project folders under every configured root
// (depth 0)
// ---------------------------------------------------------------------------
let rootWatcher: FSWatcher | null = null;
// key (lowercased path) -> original-cased path actually handed to chokidar.
const watchedRoots = new Map<string, string>();

function startRootTier() {
  rootWatcher = guard(
    chokidar.watch([], {
      depth: 0,
      ignoreInitial: true,
      persistent: true,
    }),
    "roots",
  );
  const rescan = debounce(() => {
    projectRegistry.rescan();
    syncGitHeartbeat();
  }, 400);
  rootWatcher.on("addDir", rescan);
  rootWatcher.on("unlinkDir", rescan);
  resyncRootWatcher();
}

// Re-point the root tier at the current config.roots. Called on boot and after a
// UI root add/remove so new roots are watched (and dropped ones unwatched)
// without a server restart.
export function resyncRootWatcher() {
  if (!rootWatcher) return;
  const wanted = new Map(config.roots.map((r) => [r.toLowerCase(), r]));
  for (const [key, root] of wanted) {
    if (!watchedRoots.has(key)) {
      rootWatcher.add(root);
      watchedRoots.set(key, root);
    }
  }
  for (const [key, root] of [...watchedRoots]) {
    if (!wanted.has(key)) {
      rootWatcher.unwatch(root);
      watchedRoots.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — transcripts: ~/.claude/projects depth 1, *.jsonl add/change.
// This is the heartbeat: every change bumps project activity and feeds tailer.
// ---------------------------------------------------------------------------
let transcriptWatcher: FSWatcher | null = null;

function startTranscriptTier() {
  transcriptWatcher = guard(
    chokidar.watch(config.claudeProjectsDir, {
      depth: 1,
      ignoreInitial: true,
      persistent: true,
      // Windows + heavy concurrent writes: polling is more reliable here.
      usePolling: process.platform === "win32",
      interval: 1000,
      binaryInterval: 1500,
    }),
    "transcripts",
  );
  const handle = (file: string) => {
    if (!file.endsWith(".jsonl")) return;
    const dirName = path.basename(path.dirname(file));
    const owner = matchDirToProject(
      dirName,
      buildEncodedIndex(currentProjectPaths()),
    );
    if (owner) projectRegistry.bumpActivity(owner);
    onTranscriptFileChanged(file);
  };
  transcriptWatcher.on("add", handle);
  transcriptWatcher.on("change", handle);
}

function currentProjectPaths(): string[] {
  return projectRegistry.getAll().map((p) => p.path);
}

// ---------------------------------------------------------------------------
// Git-heartbeat tier (deviation from §4.3, noted in cliffnotes): watch just the
// `.git/index` and `.git/HEAD` FILES of every project (depth 0, no worktree
// recursion). Lets a `git` op in ANY repo live-bump activity + dirty count
// within the debounce, without violating §4.1's "don't recursively stat".
// ---------------------------------------------------------------------------
let gitHeartbeat: FSWatcher | null = null;
const watchedGitFiles = new Set<string>();

function gitFilesFor(projectPath: string): string[] {
  const g = path.win32.join(projectPath, ".git");
  return [path.win32.join(g, "index"), path.win32.join(g, "HEAD")];
}

function startGitHeartbeatTier() {
  gitHeartbeat = guard(
    chokidar.watch([], {
      ignoreInitial: true,
      persistent: true,
      depth: 0,
    }),
    "git-heartbeat",
  );
  const onChange = debounce((file: string) => {
    // <repo>\.git\index -> <repo>
    const repo = path.win32.dirname(path.win32.dirname(file));
    const project = projectRegistry
      .getAll()
      .find((p) => p.path.toLowerCase() === repo.toLowerCase());
    if (!project) return;
    projectRegistry.bumpActivityById(project.id);
    void projectRegistry.refreshGit(project.id);
    eventHub.publish([topics.git(project.id)], {
      t: "git.updated",
      projectId: project.id,
    });
  }, 200);
  gitHeartbeat.on("all", (_ev, file) => onChange(file));
  syncGitHeartbeat();
}

export function syncGitHeartbeat() {
  if (!gitHeartbeat) return;
  const wanted = new Set<string>();
  for (const p of projectRegistry.getAll()) {
    if (p.kind === "root") continue; // M10: root has no .git to heartbeat
    for (const f of gitFilesFor(p.path)) wanted.add(f);
  }
  for (const f of wanted) {
    if (!watchedGitFiles.has(f)) {
      gitHeartbeat.add(f);
      watchedGitFiles.add(f);
    }
  }
  for (const f of [...watchedGitFiles]) {
    if (!wanted.has(f)) {
      gitHeartbeat.unwatch(f);
      watchedGitFiles.delete(f);
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — repo: per open project, watch .git + worktree -> git.updated.
// Torn down 5 min after the last client closes the project.
// ---------------------------------------------------------------------------
interface RepoWatch {
  watcher: FSWatcher;
  teardownTimer: NodeJS.Timeout | null;
}
const repoWatchers = new Map<string, RepoWatch>();
const IGNORE = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])build([/\\]|$)/,
  /(^|[/\\])\.next([/\\]|$)/,
  /(^|[/\\])target([/\\]|$)/,
  /\.log$/,
];

export function openRepoWatch(projectId: string) {
  const existing = repoWatchers.get(projectId);
  if (existing) {
    if (existing.teardownTimer) {
      clearTimeout(existing.teardownTimer);
      existing.teardownTimer = null;
    }
    return;
  }
  const projectPath = projectRegistry.getPath(projectId);
  if (!projectPath) return;

  const gitDir = path.win32.join(projectPath, ".git");
  const watcher = guard(
    chokidar.watch(
      [
        path.win32.join(gitDir, "index"),
        path.win32.join(gitDir, "HEAD"),
        path.win32.join(gitDir, "refs"),
        projectPath,
      ],
      {
        ignored: IGNORE,
        ignoreInitial: true,
        persistent: true,
        depth: 6,
      },
    ),
    `repo:${projectId}`,
  );
  const emit = debounce(() => {
    eventHub.publish([topics.git(projectId)], {
      t: "git.updated",
      projectId,
    });
    void projectRegistry.refreshGit(projectId);
  }, 300);
  watcher.on("all", emit);
  repoWatchers.set(projectId, { watcher, teardownTimer: null });
  // Prime the git status immediately on open.
  void projectRegistry.refreshGit(projectId);
}

export function closeRepoWatch(projectId: string) {
  const rw = repoWatchers.get(projectId);
  if (!rw || rw.teardownTimer) return;
  rw.teardownTimer = setTimeout(
    () => {
      void rw.watcher.close();
      repoWatchers.delete(projectId);
    },
    5 * 60 * 1000,
  );
}

export function startWatchers() {
  startRootTier();
  startTranscriptTier();
  startGitHeartbeatTier();
  // Topic subscription lifecycle (git: + transcript:) is wired centrally in
  // services.ts via eventHub.setSubHandler.
}

export async function stopWatchers() {
  await rootWatcher?.close();
  await transcriptWatcher?.close();
  await gitHeartbeat?.close();
  for (const rw of repoWatchers.values()) {
    if (rw.teardownTimer) clearTimeout(rw.teardownTimer);
    await rw.watcher.close();
  }
  repoWatchers.clear();
}

function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let t: NodeJS.Timeout | null = null;
  let lastArgs: A;
  return (...args: A) => {
    lastArgs = args;
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...lastArgs), ms);
  };
}
