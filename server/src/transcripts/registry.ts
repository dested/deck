import fs from "node:fs";
import path from "node:path";
import type { Session, TranscriptEvent } from "@deck/shared";
import { parseTranscript, type ParsedTranscript } from "./parser.js";
import {
  computeStatus,
  lastActivityLine,
  eventSignature,
  computeStats,
} from "./status.js";
import type { AgentStats } from "@deck/shared";
import {
  listTranscriptDirs,
  buildEncodedIndex,
  matchDirToProject,
} from "./locator.js";
import { projectRegistry } from "../projects/registry.js";
import { getState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";

const RECENT_MS = 30 * 60 * 1000; // <30min = live external (§7.4)
const CACHE_MAX = 24;

interface TMeta {
  sessionId: string;
  file: string;
  dir: string;
  mtimeMs: number;
}

interface CacheEntry {
  mtimeMs: number;
  parsed: ParsedTranscript;
  signatures: Map<string, string>;
}

class TranscriptRegistry {
  private index = new Map<string, TMeta>();
  private byFile = new Map<string, string>(); // file -> sessionId
  private cache = new Map<string, CacheEntry>();
  private subscribed = new Set<string>();
  private cacheOrder: string[] = [];
  private lastKey = new Map<string, string>();
  // Per-subscribed-session baseline of already-emitted event signatures. Kept
  // SEPARATE from the parse cache so the status ticker refreshing the cache
  // can't "consume" a change before the live-diff sees it.
  private emittedSigs = new Map<string, Map<string, string>>();
  // Injected by services: transcript ids currently backed by an owned pty, so
  // they aren't also surfaced as external sessions (avoids duplicates).
  private ownedChecker: () => Set<string> = () => new Set();

  setOwnedTranscriptChecker(fn: () => Set<string>) {
    this.ownedChecker = fn;
  }

  // A dismissed external session stays hidden until its transcript is touched
  // again (mtime moves past the dismiss time) — then it legitimately reappears.
  private isDismissed(sessionId: string, mtimeMs: number): boolean {
    const at = getState().dismissedSessions[sessionId];
    return at != null && mtimeMs <= at;
  }

  // Status/activity for an owned claude session's linked transcript.
  describe(transcriptId: string): {
    status: Session["status"];
    lastActivityLine: string | null;
    title: string | null;
    stats: AgentStats;
  } | null {
    const meta = this.index.get(transcriptId);
    const parsed = this.getParsed(transcriptId);
    if (!parsed) return null;
    const mtime = meta?.mtimeMs ?? Date.now();
    return {
      status: computeStatus(mtime, parsed.events),
      lastActivityLine: lastActivityLine(parsed.events),
      title: parsed.title,
      stats: computeStats(parsed.events, parsed.model),
    };
  }

  refreshIndex() {
    const next = new Map<string, TMeta>();
    for (const info of listTranscriptDirs()) {
      let files: string[];
      try {
        files = fs.readdirSync(info.dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const full = path.join(info.dir, f);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          continue;
        }
        const sessionId = f.slice(0, -".jsonl".length);
        next.set(sessionId, { sessionId, file: full, dir: info.dir, mtimeMs });
        this.byFile.set(full, sessionId);
      }
    }
    this.index = next;
  }

  private projectFor(meta: TMeta): { id: string; path: string } {
    const dirName = path.basename(meta.dir);
    const encIndex = buildEncodedIndex(
      projectRegistry.getAll().map((p) => p.path),
    );
    const projectPath = matchDirToProject(dirName, encIndex);
    if (projectPath) {
      const proj = projectRegistry
        .getAll()
        .find((p) => p.path === projectPath);
      return { id: proj?.id ?? path.win32.basename(projectPath), path: projectPath };
    }
    return { id: dirName, path: "" };
  }

  getParsed(sessionId: string): ParsedTranscript | null {
    const meta = this.index.get(sessionId);
    if (!meta) {
      this.refreshIndex();
    }
    const m = this.index.get(sessionId);
    if (!m) return null;
    const cached = this.cache.get(sessionId);
    let mtimeMs = m.mtimeMs;
    try {
      mtimeMs = fs.statSync(m.file).mtimeMs;
    } catch {
      /* use indexed */
    }
    if (cached && cached.mtimeMs === mtimeMs) return cached.parsed;
    let raw = "";
    try {
      raw = fs.readFileSync(m.file, "utf8");
    } catch (err) {
      // transient EBUSY/EPERM — one retry after 100ms handled by caller path;
      // here just return stale cache if present.
      if (cached) return cached.parsed;
      return null;
    }
    const parsed = parseTranscript(raw);
    const signatures = new Map<string, string>();
    for (const e of parsed.events) signatures.set(e.id, eventSignature(e));
    this.putCache(sessionId, { mtimeMs, parsed, signatures });
    return parsed;
  }

  private putCache(sessionId: string, entry: CacheEntry) {
    if (!this.cache.has(sessionId)) this.cacheOrder.push(sessionId);
    this.cache.set(sessionId, entry);
    while (this.cacheOrder.length > CACHE_MAX) {
      const evict = this.cacheOrder.shift()!;
      if (!this.subscribed.has(evict)) this.cache.delete(evict);
      else this.cacheOrder.push(evict); // keep subscribed sessions hot
    }
  }

  private toSession(meta: TMeta, parsed: ParsedTranscript): Session {
    const proj = this.projectFor(meta);
    const state = getState();
    const status = computeStatus(meta.mtimeMs, parsed.events);
    const short = meta.sessionId.slice(0, 4);
    return {
      id: meta.sessionId,
      kind: "claude",
      source: "external",
      projectId: proj.id,
      projectPath: proj.path,
      name:
        state.sessionNames[meta.sessionId] ??
        parsed.title ??
        `${proj.id} ·${short}`,
      groupId: state.sessionGroups[meta.sessionId] ?? null,
      status,
      ptyId: null,
      transcriptSessionId: meta.sessionId,
      transcriptPath: meta.file,
      exitCode: null,
      createdAt: parsed.events[0]?.ts ?? meta.mtimeMs,
      activityAt: meta.mtimeMs,
      lastActivityLine: lastActivityLine(parsed.events),
      unread: false,
      title: parsed.title,
      stats: computeStats(parsed.events, parsed.model),
    };
  }

  // Recent (<30min) external sessions — power live cards + sidebar.
  externalSessions(): Session[] {
    const now = Date.now();
    const owned = this.ownedChecker();
    const out: Session[] = [];
    for (const meta of this.index.values()) {
      if (now - meta.mtimeMs > RECENT_MS) continue;
      if (owned.has(meta.sessionId)) continue;
      if (this.isDismissed(meta.sessionId, meta.mtimeMs)) continue;
      const parsed = this.getParsed(meta.sessionId);
      if (!parsed) continue;
      out.push(this.toSession(meta, parsed));
    }
    return out;
  }

  // All sessions for a project: live (<30min) + history (older).
  sessionsForProject(projectId: string): { live: Session[]; history: Session[] } {
    const now = Date.now();
    const owned = this.ownedChecker();
    const live: Session[] = [];
    const history: Session[] = [];
    for (const meta of this.index.values()) {
      if (owned.has(meta.sessionId)) continue;
      if (this.isDismissed(meta.sessionId, meta.mtimeMs)) continue;
      const proj = this.projectFor(meta);
      if (proj.id !== projectId) continue;
      const parsed = this.getParsed(meta.sessionId);
      if (!parsed) continue;
      const s = this.toSession(meta, parsed);
      if (now - meta.mtimeMs <= RECENT_MS) live.push(s);
      else history.push(s);
    }
    live.sort((a, b) => b.activityAt - a.activityAt);
    history.sort((a, b) => b.activityAt - a.activityAt);
    return { live, history };
  }

  subscribe(sessionId: string) {
    this.subscribed.add(sessionId);
    // Baseline against the current state so only subsequent changes emit.
    const parsed = this.getParsed(sessionId);
    const sigs = new Map<string, string>();
    if (parsed) for (const e of parsed.events) sigs.set(e.id, eventSignature(e));
    this.emittedSigs.set(sessionId, sigs);
  }
  unsubscribe(sessionId: string) {
    this.subscribed.delete(sessionId);
    this.emittedSigs.delete(sessionId);
  }

  // Periodic recompute so status transitions (working->attention->idle->stale)
  // propagate without a file change. Publishes only changed sessions.
  tickExternal() {
    const now = Date.now();
    const owned = this.ownedChecker();
    for (const meta of this.index.values()) {
      // Recompute for anything active in the last ~35min (covers the stale flip).
      if (now - meta.mtimeMs > RECENT_MS + 5 * 60 * 1000) continue;
      if (owned.has(meta.sessionId)) continue;
      const cached = this.cache.get(meta.sessionId);
      const parsed = cached?.parsed ?? this.getParsed(meta.sessionId);
      if (!parsed) continue;
      const session = this.toSession(meta, parsed);
      // Once an external session goes stale (or is dismissed), drop it from the
      // live clients entirely rather than leaving it stuck in the store — it's
      // still available under the project's Agents history, freshly fetched.
      if (
        session.status === "stale" ||
        this.isDismissed(meta.sessionId, meta.mtimeMs)
      ) {
        if (this.lastKey.delete(meta.sessionId)) {
          eventHub.publish([topics.sessions], {
            t: "sessions.removed",
            id: meta.sessionId,
          });
        }
        continue;
      }
      const key = `${session.status}|${session.name}|${session.groupId}|${session.activityAt}`;
      if (this.lastKey.get(meta.sessionId) === key) continue;
      this.lastKey.set(meta.sessionId, key);
      eventHub.publish([topics.sessions], {
        t: "sessions.updated",
        payload: session,
      });
    }
  }

  // Called by the transcript watcher on every jsonl add/change.
  onFileChanged(file: string) {
    const sessionId =
      this.byFile.get(file) ?? path.basename(file).replace(/\.jsonl$/, "");
    const meta = this.index.get(sessionId);
    if (meta) {
      try {
        meta.mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        /* ignore */
      }
    } else {
      this.refreshIndex();
    }

    const parsed = this.getParsed(sessionId);
    if (!parsed) return;

    // Emit new/changed events to transcript subscribers, diffing against the
    // independent emitted-signature baseline (not the parse cache).
    if (this.subscribed.has(sessionId)) {
      const emitted = this.emittedSigs.get(sessionId) ?? new Map<string, string>();
      const changed: TranscriptEvent[] = [];
      const nextSigs = new Map<string, string>();
      for (const e of parsed.events) {
        const sig = eventSignature(e);
        nextSigs.set(e.id, sig);
        if (emitted.get(e.id) !== sig) changed.push(e);
      }
      this.emittedSigs.set(sessionId, nextSigs);
      if (changed.length) {
        eventHub.publish([topics.transcript(sessionId)], {
          t: "transcript.append",
          sessionId,
          events: changed,
        });
      }
    }

    // Publish updated session summary for live cards/sidebar — UNLESS this
    // transcript is backed by an owned pty. The session manager already
    // publishes owned sessions; re-publishing here as an `external` twin (a
    // DIFFERENT session id) produced a duplicate card. If we ever surfaced it
    // as external before linkage completed, retract that stray card now.
    const m = this.index.get(sessionId);
    if (m) {
      if (this.ownedChecker().has(sessionId)) {
        if (this.lastKey.delete(sessionId)) {
          eventHub.publish([topics.sessions], {
            t: "sessions.removed",
            id: sessionId,
          });
        }
        return;
      }
      const session = this.toSession(m, parsed);
      this.lastKey.set(
        sessionId,
        `${session.status}|${session.name}|${session.groupId}|${session.activityAt}`,
      );
      eventHub.publish([topics.sessions], {
        t: "sessions.updated",
        payload: session,
      });
    }
  }
}

export const transcriptRegistry = new TranscriptRegistry();
