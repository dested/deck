import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SearchHit, TranscriptEvent } from "@deck/shared";
import { config } from "../config.js";
import { parseTranscript } from "../transcripts/parser.js";
import { projectRegistry } from "../projects/registry.js";
import {
  transcriptFilesForProject,
  buildEncodedIndex,
  matchDirToProject,
} from "../transcripts/locator.js";

// M9: full-text search across every transcript on the machine, via a
// better-sqlite3 FTS5 index at ~/.deck/search.db (WAL). The index is seeded on
// boot (incrementally) and kept live via the transcript change hook.

// Private-use sentinels wrap matches in the snippet — the client swaps them for
// <mark> spans without any HTML-injection risk.
const S_OPEN = "";
const S_CLOSE = "";
export const SNIPPET_OPEN = S_OPEN;
export const SNIPPET_CLOSE = S_CLOSE;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files(file TEXT PRIMARY KEY, mtimeMs REAL, size INTEGER);
CREATE TABLE IF NOT EXISTS sessions(sessionId TEXT PRIMARY KEY, projectId TEXT,
  file TEXT, title TEXT, lastTs REAL, model TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS events USING fts5(
  text, sessionId UNINDEXED, projectId UNINDEXED, eventIdx UNINDEXED,
  kind UNINDEXED, ts UNINDEXED);
`;

// What of an event is worth indexing: user/assistant text, tool titles + edited
// file paths. Skip thinking bodies and raw tool_result dumps (index size).
function searchableText(e: TranscriptEvent): string {
  switch (e.kind) {
    case "user":
      return e.text;
    case "assistant":
      return e.markdown;
    case "tool":
      return e.isEdit?.path ? `${e.title} ${e.isEdit.path}` : e.title;
    case "subagent":
      return e.description;
    default:
      return "";
  }
}

interface Row {
  sessionId: string;
  projectId: string;
  eventIdx: number;
  kind: string;
  ts: number;
  title: string | null;
  snip: string;
}

class SearchIndexer {
  private db: Database.Database | null = null;
  private ready = false;

  init() {
    try {
      fs.mkdirSync(config.deckStateDir, { recursive: true });
      this.db = new Database(config.searchDbFile);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(SCHEMA);
      this.ready = true;
    } catch (err) {
      console.warn("[search] init failed (search disabled):", err);
      this.db = null;
    }
  }

  private projectIdForFile(file: string): string {
    const dirName = path.basename(path.dirname(file));
    const encIndex = buildEncodedIndex(
      projectRegistry.getAll().map((p) => p.path),
    );
    const projPath = matchDirToProject(dirName, encIndex);
    const proj = projPath
      ? projectRegistry.getAll().find((p) => p.path === projPath)
      : null;
    return proj?.id ?? dirName;
  }

  indexFile(file: string, projectId?: string) {
    const db = this.db;
    if (!db) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    const watermark = db
      .prepare("SELECT mtimeMs, size FROM files WHERE file=?")
      .get(file) as { mtimeMs: number; size: number } | undefined;
    if (watermark && watermark.mtimeMs === stat.mtimeMs && watermark.size === stat.size)
      return;

    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const parsed = parseTranscript(raw);
    const sessionId = path.basename(file).replace(/\.jsonl$/, "");
    const pid = projectId ?? this.projectIdForFile(file);

    const insEvent = db.prepare(
      "INSERT INTO events(text, sessionId, projectId, eventIdx, kind, ts) VALUES (?,?,?,?,?,?)",
    );
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM events WHERE sessionId=?").run(sessionId);
      parsed.events.forEach((e, idx) => {
        const text = searchableText(e);
        if (!text || !text.trim()) return;
        insEvent.run(text, sessionId, pid, idx, e.kind, e.ts);
      });
      db.prepare(
        "INSERT INTO files(file, mtimeMs, size) VALUES (?,?,?) " +
          "ON CONFLICT(file) DO UPDATE SET mtimeMs=excluded.mtimeMs, size=excluded.size",
      ).run(file, stat.mtimeMs, stat.size);
      db.prepare(
        "INSERT INTO sessions(sessionId, projectId, file, title, lastTs, model) VALUES (?,?,?,?,?,?) " +
          "ON CONFLICT(sessionId) DO UPDATE SET projectId=excluded.projectId, file=excluded.file, " +
          "title=excluded.title, lastTs=excluded.lastTs, model=excluded.model",
      ).run(sessionId, pid, file, parsed.title, parsed.lastTs, parsed.model);
    });
    try {
      tx();
    } catch (err) {
      console.warn("[search] index failed for", sessionId, err);
    }
  }

  // Boot: incrementally index every transcript for every known project so the
  // initial sweep doesn't block startup (~5 files per tick).
  sweep() {
    if (!this.db) return;
    const files: { file: string; projectId: string }[] = [];
    for (const p of projectRegistry.getAll()) {
      for (const info of transcriptFilesForProject(p.path)) {
        files.push({ file: info.file, projectId: p.id });
      }
    }
    let i = 0;
    const step = () => {
      const end = Math.min(i + 5, files.length);
      for (; i < end; i++) this.indexFile(files[i]!.file, files[i]!.projectId);
      if (i < files.length) setImmediate(step);
      else console.log(`[search] indexed ${files.length} transcripts`);
    };
    if (files.length) setImmediate(step);
  }

  private buildMatch(q: string): string | null {
    const terms = q
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '""')}"`);
    if (!terms.length) return null;
    return terms.join(" ");
  }

  search(q: string, projectId: string | undefined, limit: number): SearchHit[] {
    const db = this.db;
    if (!db || !this.ready) return [];
    const match = this.buildMatch(q);
    if (!match) return [];
    const sql =
      "SELECT events.sessionId AS sessionId, events.projectId AS projectId, " +
      "events.eventIdx AS eventIdx, events.kind AS kind, events.ts AS ts, " +
      "s.title AS title, snippet(events, 0, ?, ?, '…', 12) AS snip " +
      "FROM events JOIN sessions s ON s.sessionId = events.sessionId " +
      `WHERE events MATCH ? ${projectId ? "AND events.projectId = ? " : ""}` +
      "ORDER BY rank LIMIT ?";
    const params: unknown[] = [S_OPEN, S_CLOSE, match];
    if (projectId) params.push(projectId);
    params.push(Math.max(1, Math.min(100, limit)));
    let rows: Row[];
    try {
      rows = db.prepare(sql).all(...params) as Row[];
    } catch {
      return [];
    }
    return rows.map((r) => ({
      sessionId: r.sessionId,
      projectId: r.projectId,
      title: r.title,
      snippet: r.snip,
      ts: r.ts,
      eventIdx: r.eventIdx,
      kind: r.kind,
    }));
  }

  // Title/name search over the sessions table (LIKE) — "find that session".
  searchSessions(
    q: string,
    projectId: string | undefined,
    limit = 20,
  ): { sessionId: string; projectId: string; title: string | null; lastTs: number }[] {
    const db = this.db;
    if (!db || !this.ready) return [];
    const term = `%${q.trim().replace(/[%_]/g, "")}%`;
    const sql =
      "SELECT sessionId, projectId, title, lastTs FROM sessions " +
      `WHERE title LIKE ? ${projectId ? "AND projectId = ? " : ""}` +
      "ORDER BY lastTs DESC LIMIT ?";
    const params: unknown[] = [term];
    if (projectId) params.push(projectId);
    params.push(limit);
    try {
      return db.prepare(sql).all(...params) as {
        sessionId: string;
        projectId: string;
        title: string | null;
        lastTs: number;
      }[];
    } catch {
      return [];
    }
  }
}

export const searchIndexer = new SearchIndexer();
