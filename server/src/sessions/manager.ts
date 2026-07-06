import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentStats, Session } from "@deck/shared";
import { ptyManager, type PtyRecord, type PtyKind } from "../pty/manager.js";
import { projectRegistry } from "../projects/registry.js";
import { getState, updateState, type OwnedSessionRecord } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { linkOwnedClaude } from "../transcripts/linker.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { saveScrollback, deleteScrollback } from "../pty/scrollback.js";
import { reviewService } from "../reviews/service.js";

const OWNED_RECORD_CAP = 300; // keep the persisted restore-index bounded

const WORKING_WINDOW_MS = 20_000; // (§7.4)

export interface CreateSessionInput {
  projectId: string;
  kind: PtyKind;
  name?: string;
  groupId?: string;
  claudeArgs?: string[];
  command?: string; // shell kind: run this command (Library run buttons)
  initialPrompt?: string; // M13: claude kind — first message, submitted on start
  cwd?: string; // relative subdir of the project to run in (runbook cwd)
}

// Resolve an optional repo-relative cwd; anything absolute, escaping the repo,
// or missing on disk falls back to the repo root rather than erroring.
function resolveCwd(projectPath: string, cwd?: string): string | undefined {
  if (!cwd?.trim()) return undefined;
  const resolved = path.win32.resolve(projectPath, cwd.trim());
  const rel = path.win32.relative(projectPath, resolved);
  if (!rel || rel.startsWith("..") || path.win32.isAbsolute(rel)) return undefined;
  try {
    if (!fs.statSync(resolved).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  return resolved;
}

// Owns app-owned sessions (backed by PtyManager). External transcript sessions
// are merged in by the transcript service (M3) via `externalProvider`.
class SessionManager {
  // sessionId -> ptyId (they are equal today, but keep the indirection)
  private owned = new Map<string, string>();
  private unread = new Set<string>();
  private lastKey = new Map<string, string>();
  // M12: AI tab title/summary per owned session id, folded into toSession.
  private aiMeta = new Map<string, { title: string; summary: string; at: number }>();
  // M8: last prompt-tail lines for an owned claude session that's `attention`.
  private promptTails = new Map<string, string[]>();
  // M11: prior status per owned session, to detect working → settled transitions.
  private priorStatus = new Map<string, Session["status"]>();
  // provider for external sessions, installed by M3
  private externalProvider: (() => Session[]) | null = null;

  // M12: set/clear the AI-generated tab meta for an owned session.
  setAiMeta(id: string, meta: { title: string; summary: string; at: number }) {
    if (!this.owned.has(id)) return;
    this.aiMeta.set(id, meta);
    this.publishOwned(id);
  }

  setExternalProvider(fn: () => Session[]) {
    this.externalProvider = fn;
  }

  // ----- Persisted restore-index (pty id -> transcript, survives restart) -----

  private recordOwned(rec: OwnedSessionRecord) {
    updateState((s) => {
      s.ownedSessions = s.ownedSessions.filter((o) => o.id !== rec.id);
      s.ownedSessions.push(rec);
      if (s.ownedSessions.length > OWNED_RECORD_CAP) {
        const dropped = s.ownedSessions.slice(
          0,
          s.ownedSessions.length - OWNED_RECORD_CAP,
        );
        s.ownedSessions = s.ownedSessions.slice(-OWNED_RECORD_CAP);
        for (const d of dropped) deleteScrollback(d.id); // don't leak dumps
      }
    });
  }

  private setOwnedTranscript(id: string, transcriptSessionId: string) {
    updateState((s) => {
      const r = s.ownedSessions.find((o) => o.id === id);
      if (r) r.transcriptSessionId = transcriptSessionId;
    });
  }

  ownedRecord(id: string): OwnedSessionRecord | undefined {
    return getState().ownedSessions.find((o) => o.id === id);
  }

  // Re-open a claude transcript as a fresh owned session (resume). Used both by
  // adopt (live external) and restore (a tab whose session is long gone).
  resumeTranscript(
    transcriptId: string,
    projectId: string,
    name?: string,
    groupId?: string,
  ): Session {
    return this.create({
      projectId,
      kind: "claude",
      name,
      groupId,
      claudeArgs: ["--resume", transcriptId],
    });
  }

  create(input: CreateSessionInput): Session {
    const projectPath = projectRegistry.getPath(input.projectId);
    if (!projectPath) throw new Error("unknown project");
    const id = randomUUID();
    const short = id.slice(0, 4);
    const name =
      input.name ??
      `${input.projectId} ${input.kind === "shell" ? "sh" : "cc"}·${short}`;

    // If resuming a known transcript, we already know its id.
    const resumeIdx = input.claudeArgs?.indexOf("--resume") ?? -1;
    const resumeId =
      resumeIdx >= 0 ? input.claudeArgs?.[resumeIdx + 1] : undefined;

    updateState((s) => {
      s.sessionNames[id] = name;
      s.sessionGroups[id] = input.groupId ?? null;
    });

    const rec = ptyManager.spawn({
      id,
      kind: input.kind,
      projectId: input.projectId,
      projectPath,
      cwd: resolveCwd(projectPath, input.cwd),
      claudeArgs: input.claudeArgs,
      command: input.command,
      initialPrompt: input.initialPrompt,
    });
    this.owned.set(id, id);

    // Persist a restore-index record so a reopened tab can map this pty id back
    // to its transcript even after the server (and the in-memory pty) are gone.
    this.recordOwned({
      id,
      kind: input.kind,
      projectId: input.projectId,
      projectPath,
      name,
      groupId: input.groupId ?? null,
      transcriptSessionId: resumeId ?? null,
      createdAt: Date.now(),
    });

    // §5.2 link the transcript this claude session writes.
    if (input.kind === "claude") {
      if (resumeId) {
        rec.transcriptSessionId = resumeId;
      } else {
        linkOwnedClaude(projectPath, (tid) => {
          const r = ptyManager.get(id);
          if (r) {
            r.transcriptSessionId = tid;
            this.setOwnedTranscript(id, tid);
            this.publishOwned(id);
          }
        });
      }
    }

    ptyManager.onData(id, () => {
      this.unread.add(id);
      this.publishOwned(id);
    });
    ptyManager.onExit(id, () => {
      saveScrollback(id); // freeze the last screen before the ring is swept
      this.publishOwned(id);
      this.syncRunningCounts();
    });

    this.syncRunningCounts();
    const session = this.toSession(rec);
    this.publish(session);
    return session;
  }

  // Restart a claude session: kill it, then resume its transcript in a new pty.
  restart(id: string): Session | null {
    const rec = ptyManager.get(id);
    if (!rec || rec.kind !== "claude") return null;
    const transcriptId = rec.transcriptSessionId;
    const name = getState().sessionNames[id];
    const groupId = getState().sessionGroups[id] ?? undefined;
    ptyManager.kill(id);
    return this.create({
      projectId: rec.projectId,
      kind: "claude",
      name,
      groupId,
      claudeArgs: transcriptId ? ["--resume", transcriptId] : [],
    });
  }

  // Adopt an external session: start an owned claude that resumes its transcript.
  adopt(externalSessionId: string, projectId: string): Session {
    return this.create({
      projectId,
      kind: "claude",
      claudeArgs: ["--resume", externalSessionId],
    });
  }

  kill(id: string): boolean {
    if (!this.owned.has(id)) return false;
    ptyManager.kill(id);
    return true;
  }

  // Fully remove an owned session from the live view — even a zombie whose pty
  // already died without emitting exit (so `kill` did nothing and the card was
  // stuck). Disposes the pty, drops the record, prunes its accumulated state,
  // and tells clients to remove the card. Returns false for external sessions.
  forceClose(id: string): boolean {
    if (!this.owned.has(id)) return false;
    // Capture the linked transcript BEFORE the pty record is disposed.
    const transcriptId = ptyManager.get(id)?.transcriptSessionId ?? null;
    // Close means close: dismiss the linked transcript FIRST, so dropping this
    // session from `owned` can't leave even a one-tick window where the
    // transcript registry re-surfaces it as an EXTERNAL "adopt me" ghost card.
    // (A killed claude never writes again, so the dismiss holds forever; it
    // only reappears — legitimately — if the transcript is touched anew.)
    if (transcriptId) {
      updateState((s) => {
        s.dismissedSessions[transcriptId] = Date.now();
      });
    }
    // Freeze the last screen (shell tabs have no transcript to fall back on) and
    // keep the persisted restore record so the closed tab can still be reopened.
    saveScrollback(id);
    ptyManager.dispose(id);
    this.owned.delete(id);
    this.unread.delete(id);
    this.lastKey.delete(id);
    updateState((s) => {
      delete s.sessionNames[id];
      delete s.sessionGroups[id];
    });
    this.publishRemoved(id);
    // Retract any external card a client already rendered for this transcript.
    if (transcriptId && transcriptId !== id) this.publishRemoved(transcriptId);
    this.syncRunningCounts();
    return true;
  }

  rename(id: string, name: string) {
    updateState((s) => {
      s.sessionNames[id] = name;
      const r = s.ownedSessions.find((o) => o.id === id);
      if (r) r.name = name;
    });
    // publishById covers external sessions too, so renaming an agent live-
    // updates its card (previously only owned sessions re-published).
    this.publishById(id);
  }

  assignGroup(id: string, groupId: string | null) {
    updateState((s) => {
      s.sessionGroups[id] = groupId;
    });
    this.publishById(id);
  }

  // Publish a session update by id regardless of source (owned or external).
  publishById(id: string) {
    if (this.owned.has(id)) {
      this.publishOwned(id);
      return;
    }
    const session = this.list().find((s) => s.id === id);
    if (session) this.publish(session);
  }

  input(id: string, text: string, submit: boolean) {
    if (!this.owned.has(id)) return false;
    // Multiline -> bracketed paste (§5.4 / §7.5), then CR to submit.
    if (text.includes("\n")) {
      ptyManager.write(id, `\x1b[200~${text}\x1b[201~`);
    } else {
      ptyManager.write(id, text);
    }
    if (submit) ptyManager.write(id, "\r");
    return true;
  }

  clearUnread(id: string) {
    if (this.unread.delete(id)) this.publishOwned(id);
  }

  ownedSessions(): Session[] {
    const out: Session[] = [];
    for (const id of this.owned.keys()) {
      const rec = ptyManager.get(id);
      if (rec) out.push(this.toSession(rec));
    }
    return out;
  }

  list(): Session[] {
    const owned = this.ownedSessions();
    const external = this.externalProvider?.() ?? [];
    // External sessions linked to an owned pty are hidden (owned wins).
    const ownedTranscriptIds = new Set(
      owned.map((s) => s.transcriptSessionId).filter(Boolean),
    );
    return [
      ...owned,
      ...external.filter((e) => !ownedTranscriptIds.has(e.id)),
    ];
  }

  getPtyId(sessionId: string): string | null {
    return this.owned.get(sessionId) ?? null;
  }

  // The transcript file id backing a session. Owned claude sessions link theirs
  // in M4; external sessions ARE their transcript id.
  resolveTranscriptId(sessionId: string): string | null {
    if (this.owned.has(sessionId)) {
      const rec = ptyManager.get(sessionId);
      return rec?.transcriptSessionId ?? null;
    }
    return sessionId; // external
  }

  isOwned(sessionId: string): boolean {
    return this.owned.has(sessionId);
  }

  private toSession(rec: PtyRecord): Session {
    const state = getState();
    const now = Date.now();
    let status: Session["status"];
    let lastActivityLine: string | null = null;
    let title: string | null = null;
    let stats: AgentStats | null = null;

    if (rec.status === "exited") {
      status = "exited";
      if (rec.kind === "claude" && rec.transcriptSessionId) {
        stats = transcriptRegistry.describe(rec.transcriptSessionId)?.stats ?? null;
      }
    } else if (rec.kind === "claude" && rec.transcriptSessionId) {
      // Owned claude status/attention comes from its transcript (§7.4).
      const d = transcriptRegistry.describe(rec.transcriptSessionId);
      if (d) {
        status = d.status === "stale" ? "idle" : d.status;
        lastActivityLine = d.lastActivityLine;
        title = d.title;
        stats = d.stats;
      } else {
        status = now - rec.lastActivityAt < WORKING_WINDOW_MS ? "working" : "idle";
      }
    } else {
      status = now - rec.lastActivityAt < WORKING_WINDOW_MS ? "working" : "idle";
    }

    return {
      id: rec.id,
      kind: rec.kind,
      source: "owned",
      projectId: rec.projectId,
      projectPath: rec.projectPath,
      name: state.sessionNames[rec.id] ?? rec.id,
      groupId: state.sessionGroups[rec.id] ?? null,
      status,
      ptyId: rec.id,
      transcriptSessionId: rec.transcriptSessionId,
      transcriptPath: null,
      exitCode: rec.exitCode,
      createdAt: rec.createdAt,
      activityAt: rec.lastActivityAt,
      lastActivityLine,
      unread: this.unread.has(rec.id),
      title,
      stats,
      promptTail:
        status === "attention" ? this.promptTails.get(rec.id) ?? null : null,
      aiMeta: this.aiMeta.get(rec.id) ?? null,
    };
  }

  ownedTranscriptIds(): Set<string> {
    const ids = new Set<string>();
    for (const id of this.owned.keys()) {
      const rec = ptyManager.get(id);
      if (rec?.transcriptSessionId) ids.add(rec.transcriptSessionId);
    }
    return ids;
  }

  private publishOwned(id: string) {
    const rec = ptyManager.get(id);
    if (!rec) return;
    const session = this.toSession(rec);
    const key = `${session.status}|${session.name}|${session.groupId}|${session.unread}|${session.exitCode}|${session.activityAt}|${session.lastActivityLine}|${session.aiMeta?.at ?? 0}|${(session.promptTail ?? []).join("")}`;
    if (this.lastKey.get(id) === key) return;
    this.lastKey.set(id, key);
    this.publish(session);
  }

  publish(session: Session) {
    eventHub.publish([topics.sessions], {
      t: "sessions.updated",
      payload: session,
    });
  }

  publishRemoved(id: string) {
    eventHub.publish([topics.sessions], { t: "sessions.removed", id });
  }

  syncRunningCounts() {
    projectRegistry.setRunningCounts(ptyManager.runningCountByProject());
  }

  // M8: when an owned claude session is waiting on a prompt (`attention`),
  // capture the last ~12 readable lines of its terminal for the Inbox card.
  private refreshPromptTail(id: string) {
    const rec = ptyManager.get(id);
    if (!rec || rec.kind !== "claude" || rec.status === "exited") {
      this.promptTails.delete(id);
      return;
    }
    if (this.toSession(rec).status !== "attention") {
      this.promptTails.delete(id);
      return;
    }
    const tail = extractPromptTail(ptyManager.tail(id, 4096));
    if (tail.length) this.promptTails.set(id, tail);
    else this.promptTails.delete(id);
  }

  // M11: detect an owned claude burst finishing (working → idle|attention) and
  // hand it to the review service to capture touched files + a summary.
  private checkReviewTransition(id: string) {
    const rec = ptyManager.get(id);
    if (!rec || rec.kind !== "claude" || rec.status === "exited") return;
    const session = this.toSession(rec);
    const prior = this.priorStatus.get(id);
    this.priorStatus.set(id, session.status);
    if (
      prior === "working" &&
      (session.status === "idle" || session.status === "attention")
    ) {
      reviewService.onSessionSettled(session);
    }
  }

  // Recompute statuses on a timer so working->idle transitions propagate (§7.4).
  startStatusTicker() {
    setInterval(() => {
      for (const id of this.owned.keys()) {
        this.refreshPromptTail(id);
        this.publishOwned(id);
        this.checkReviewTransition(id);
      }
    }, 5_000).unref?.();
  }
}

// Strip ANSI + control noise and keep the last readable lines of a terminal
// tail (drops empties and pure box-drawing separators). No new dep.
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
function extractPromptTail(raw: string): string[] {
  const clean = raw.replace(ANSI_RE, "");
  const lines = clean
    .split(/\r?\n/)
    // strip remaining control chars, keep printable + box drawing
    .map((l) => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\s+$/, ""));
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (/^[─-╿\s]+$/.test(t)) return false; // box-drawing-only
    return true;
  });
  return kept.slice(-12);
}

export const sessionManager = new SessionManager();
