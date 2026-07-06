import crypto from "node:crypto";
import type { TranscriptEvent } from "@deck/shared";
import { sessionManager } from "../sessions/manager.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { ptyManager } from "../pty/manager.js";
import { eventHub, topics } from "../ws/events.js";
import { eventSignature } from "../transcripts/status.js";
import { aiComplete, parseAiJson } from "./client.js";

// M12: rename tabs to what's actually happening. Every 120s, for each session
// with an OPEN tab/feed whose content changed since we last looked, ask haiku
// for a { title, summary } and fold it into the session. Bounded by the open
// set + the M7 budget; unchanged sessions cost nothing.

const INTERVAL_MS = 120_000;
const CONTEXT_EVENTS = 25;

const PROMPT =
  'You label a terminal tab in a dev dashboard. From this recent session ' +
  'activity, output JSON: {"title": string (≤5 words, telegraphic, no ' +
  'quotes/emoji/trailing period), "summary": string (one present-tense ' +
  'sentence ≤140 chars: what is happening right now)}. Output ONLY the JSON.';

// Per-session signature of the last content we labelled (separate from the
// registry's emittedSigs so we never consume a live-diff change).
const lastSig = new Map<string, string>();

let timer: NodeJS.Timeout | null = null;

export function startLiveMetaTicker() {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch(() => {});
  }, INTERVAL_MS);
  timer.unref?.();
}

export function stopLiveMetaTicker() {
  if (timer) clearInterval(timer);
  timer = null;
}

function transcriptSig(events: TranscriptEvent[]): string {
  const last = events[events.length - 1];
  return `${events.length}|${last ? eventSignature(last) : ""}`;
}

function renderClaudeContext(events: TranscriptEvent[]): string {
  const recent = events.slice(-CONTEXT_EVENTS);
  const lines: string[] = [];
  for (const e of recent) {
    switch (e.kind) {
      case "user":
        lines.push(`user: ${e.text.slice(0, 300)}`);
        break;
      case "assistant":
        lines.push(`assistant: ${e.markdown.slice(0, 300)}`);
        break;
      case "tool":
        lines.push(`tool: ${e.title}`);
        break;
      case "subagent":
        lines.push(`subagent: ${e.description}`);
        break;
    }
  }
  return lines.join("\n");
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

async function labelSession(
  key: string,
  context: string,
  apply: (meta: { title: string; summary: string; at: number }) => void,
) {
  if (!context.trim()) return;
  const res = await aiComplete({
    feature: "tabTitle",
    json: true,
    maxTokens: 200,
    prompt: `${PROMPT}\n\n${context}`,
  });
  if (!res) return;
  const parsed = parseAiJson<{ title?: string; summary?: string }>(res.text);
  if (!parsed || !parsed.title) return;
  void key;
  apply({
    title: String(parsed.title).slice(0, 60),
    summary: String(parsed.summary ?? "").slice(0, 160),
    at: Date.now(),
  });
}

async function tick() {
  // 1) Owned live sessions.
  for (const s of sessionManager.ownedSessions()) {
    if (s.status === "exited") continue;
    const rec = ptyManager.get(s.id);
    if (!rec) continue;
    let sig: string;
    let context: string;
    if (rec.kind === "claude" && rec.transcriptSessionId) {
      const parsed = transcriptRegistry.getParsed(rec.transcriptSessionId);
      if (!parsed || parsed.events.length === 0) continue;
      sig = transcriptSig(parsed.events);
      context = renderClaudeContext(parsed.events);
    } else {
      const tail = ptyManager.tail(s.id, 4096).replace(ANSI_RE, "");
      sig = crypto.createHash("sha1").update(tail.slice(-4096)).digest("hex");
      context = tail.slice(-3072);
    }
    if (lastSig.get(s.id) === sig) continue;
    lastSig.set(s.id, sig);
    await labelSession(s.id, context, (meta) =>
      sessionManager.setAiMeta(s.id, meta),
    );
  }

  // 2) External sessions with an open feed (transcript topic subscribed).
  const owned = sessionManager.ownedTranscriptIds();
  for (const id of transcriptRegistry.subscribedIds()) {
    if (owned.has(id)) continue;
    if (!eventHub.hasSubscribers(topics.transcript(id))) continue;
    const parsed = transcriptRegistry.getParsed(id);
    if (!parsed || parsed.events.length === 0) continue;
    const sig = transcriptSig(parsed.events);
    if (lastSig.get(id) === sig) continue;
    lastSig.set(id, sig);
    await labelSession(id, renderClaudeContext(parsed.events), (meta) =>
      transcriptRegistry.setAiMeta(id, meta),
    );
  }
}
