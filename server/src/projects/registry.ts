import fs from "node:fs";
import type { ProjectSummary } from "@deck/shared";
import { scanProjects } from "./scanner.js";
import { getStatusSummary } from "../git/service.js";
import { getState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { config } from "../config.js";
import { unclaimedRootTranscriptDirs } from "../transcripts/locator.js";

// M10: the synthetic root pseudo-project id.
export const ROOT_PROJECT_ID = "__root__";

// In-memory registry of all discovered projects. Single source of truth the
// REST layer reads from and the WS layer pushes updates from.
class ProjectRegistry {
  private map = new Map<string, ProjectSummary>();
  private runningCounts = new Map<string, number>();
  private gitInFlight = new Set<string>();

  private rootActivityCache = { at: 0, computed: 0 };

  // M10: synthesize the root pseudo-project (agents + terminals only). Its
  // activity is the newest mtime of its *unclaimed* transcript dirs.
  private rootSummary(state = getState()): ProjectSummary {
    const now = Date.now();
    if (now - this.rootActivityCache.computed > 30_000) {
      let latest = 0;
      const realPaths = [...this.map.values()].map((p) => p.path);
      for (const dir of unclaimedRootTranscriptDirs(realPaths)) {
        try {
          const m = fs.statSync(dir).mtimeMs;
          if (m > latest) latest = m;
        } catch {
          /* ignore */
        }
      }
      this.rootActivityCache = { at: latest, computed: now };
    }
    return {
      id: ROOT_PROJECT_ID,
      path: config.root,
      name: "~ code",
      activityAt: this.rootActivityCache.at,
      branch: null,
      dirtyCount: null,
      aheadBehind: null,
      runningSessionCount: this.runningCounts.get(ROOT_PROJECT_ID) ?? 0,
      pinned: state.pinnedProjects.includes(ROOT_PROJECT_ID),
      hidden: false,
      groupId: null,
      kind: "root",
    };
  }

  getAll(): ProjectSummary[] {
    const state = getState();
    const list = [...this.map.values()]
      .map((p) => this.decorate(p, state))
      .sort(sortProjects);
    return [this.rootSummary(state), ...list];
  }

  getById(id: string): ProjectSummary | undefined {
    if (id === ROOT_PROJECT_ID) return this.rootSummary();
    const p = this.map.get(id);
    return p ? this.decorate(p, getState()) : undefined;
  }

  getPath(id: string): string | undefined {
    if (id === ROOT_PROJECT_ID) return config.root;
    return this.map.get(id)?.path;
  }

  private decorate(p: ProjectSummary, state = getState()): ProjectSummary {
    return {
      ...p,
      pinned: state.pinnedProjects.includes(p.id),
      hidden: state.hiddenProjects.includes(p.id),
      groupId: state.projectGroupOf[p.id] ?? null,
      runningSessionCount: this.runningCounts.get(p.id) ?? 0,
    };
  }

  // Full rescan: reconcile discovered projects with the map, preserving cached
  // git fields. Publishes added/updated/removed.
  rescan() {
    const scanned = scanProjects();
    const seen = new Set<string>();
    for (const s of scanned) {
      seen.add(s.id);
      const existing = this.map.get(s.id);
      if (existing) {
        if (existing.activityAt !== s.activityAt || existing.path !== s.path) {
          existing.activityAt = s.activityAt;
          existing.path = s.path;
          this.publish(existing);
        }
      } else {
        const summary: ProjectSummary = {
          id: s.id,
          path: s.path,
          name: s.name,
          activityAt: s.activityAt,
          branch: null,
          dirtyCount: null,
          aheadBehind: null,
          runningSessionCount: 0,
          pinned: false,
          hidden: false,
          groupId: null,
        };
        this.map.set(s.id, summary);
        this.publish(summary);
      }
    }
    // Removals
    for (const id of [...this.map.keys()]) {
      if (!seen.has(id)) {
        this.map.delete(id);
        eventHub.publish([topics.projects], { t: "projects.removed", id });
      }
    }
  }

  // Recompute git branch/dirty/ahead-behind for one project; publish on change.
  async refreshGit(id: string): Promise<void> {
    const p = this.map.get(id);
    if (!p || this.gitInFlight.has(id)) return;
    this.gitInFlight.add(id);
    try {
      const summary = await getStatusSummary(p.path);
      const changed =
        p.branch !== summary.branch ||
        p.dirtyCount !== summary.dirtyCount ||
        JSON.stringify(p.aheadBehind) !== JSON.stringify(summary.aheadBehind);
      p.branch = summary.branch;
      p.dirtyCount = summary.dirtyCount;
      p.aheadBehind = summary.aheadBehind;
      if (changed) this.publish(p);
    } catch (err) {
      // Non-git or transient error: mark dirtyCount 0 so UI stops showing "…"
      if (p.dirtyCount === null) {
        p.dirtyCount = 0;
        this.publish(p);
      }
    } finally {
      this.gitInFlight.delete(id);
    }
  }

  // Refresh git for the top-N most active projects, concurrency-limited.
  async refreshTopGit(n: number, concurrency = 8): Promise<void> {
    const ids = this.getAll()
      .filter((p) => p.kind !== "root")
      .slice(0, n)
      .map((p) => p.id);
    await runPool(ids, concurrency, (id) => this.refreshGit(id));
  }

  bumpActivity(projectPath: string, ts = Date.now()) {
    for (const p of this.map.values()) {
      if (p.path === projectPath) {
        if (ts > p.activityAt) {
          p.activityAt = ts;
          this.publish(p);
        }
        return;
      }
    }
  }

  bumpActivityById(id: string, ts = Date.now()) {
    const p = this.map.get(id);
    if (p && ts > p.activityAt) {
      p.activityAt = ts;
      this.publish(p);
    }
  }

  setRunningCounts(counts: Map<string, number>) {
    const affected = new Set<string>();
    // Any id whose count changed (including dropping to 0).
    for (const [id, n] of counts) {
      if ((this.runningCounts.get(id) ?? 0) !== n) affected.add(id);
    }
    for (const [id, n] of this.runningCounts) {
      if ((counts.get(id) ?? 0) !== n) affected.add(id);
    }
    this.runningCounts = counts;
    for (const id of affected) {
      const p = this.map.get(id);
      if (p) this.publish(p);
    }
  }

  // Re-emit a project's summary (e.g. after pin/hide state change).
  republish(id: string) {
    const p = this.map.get(id);
    if (p) this.publish(p);
  }

  private publish(p: ProjectSummary) {
    eventHub.publish([topics.projects], {
      t: "projects.updated",
      payload: this.decorate(p),
    });
  }
}

function sortProjects(a: ProjectSummary, b: ProjectSummary): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.activityAt - a.activityAt;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export const projectRegistry = new ProjectRegistry();
