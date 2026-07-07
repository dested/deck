import crypto from "node:crypto";
import type { TranscriptEvent } from "@deck/shared";
import { sessionManager } from "../sessions/manager.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { ptyManager } from "../pty/manager.js";
import { eventSignature } from "../transcripts/status.js";
import { aiComplete, parseAiJson } from "./client.js";

// M12 (revised 2026-07-07): keep every card/tab title tracking what's actually
// happening — "so long as things are changing, I want to know". Ticks every
// 20s and labels ANY session whose content changed since we last looked:
//   • owned live sessions (claude via transcript, shell via pty tail), and
//   • every live (<30min) EXTERNAL session the sidebar renders — no longer
//     gated on having an open tab/feed, so a card never sits on its raw
//     "proj cc·1a2b" default while it's active.
// Kept cheap three ways: haiku (M7 tabTitle feature), a change-gate (unchanged
// sessions cost nothing), a per-session cooldown (a busy session is re-labelled
// at most ~1/min), and a lean context (last 12 events, ≤200 chars each, anchored
// to the original ask). The M7 daily budget is the hard ceiling; if it trips, a
// card just keeps its last good title.

const INTERVAL_MS = 20_000;
const MIN_RELABEL_MS = 60_000; // don't re-bill a continuously-changing session every tick
const CONTEXT_EVENTS = 12;

const PROMPT =
  'You label a terminal tab in a dev dashboard. From this recent session ' +
  'activity, output JSON: {"title": string (≤5 words, telegraphic, no ' +
  'quotes/emoji/trailing period), "summary": string (one present-tense ' +
  'sentence ≤140 chars: what is happening right now)}. Output ONLY the JSON.';

// Per-session signature of the last content we labelled (separate from the
// registry's emittedSigs so we never consume a live-diff change).
const lastSig = new Map<string, string>();
// Per-session wall-clock of the last label, for the cooldown above.
const lastLabelAt = new Map<string, number>();

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

// Lean context: the original ask (anchors a stable title) + the last few turns,
// each clipped. Deliberately small — this is "just enough" for a title, not the
// whole transcript.
function renderClaudeContext(
  events: TranscriptEvent[],
  goal: string | null,
): string {
  const lines: string[] = [];
  if (goal) lines.push(`goal: ${goal.slice(0, 200)}`, "---");
  for (const e of events.slice(-CONTEXT_EVENTS)) {
    switch (e.kind) {
      case "user":
        lines.push(`user: ${e.text.slice(0, 200)}`);
        break;
      case "assistant":
        lines.push(`assistant: ${e.markdown.slice(0, 200)}`);
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

// True if this session changed since we last labelled it AND its cooldown has
// elapsed. Records the new baseline as a side effect so the caller can just
// label. `now` is captured once per tick.
function shouldLabel(id: string, sig: string, now: number): boolean {
  if (lastSig.get(id) === sig) return false;
  const last = lastLabelAt.get(id);
  if (last != null && now - last < MIN_RELABEL_MS) return false; // retry after cooldown (sig not recorded)
  lastSig.set(id, sig);
  lastLabelAt.set(id, now);
  return true;
}

async function labelSession(
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
  apply({
    title: String(parsed.title).slice(0, 60),
    summary: String(parsed.summary ?? "").slice(0, 160),
    at: Date.now(),
  });
}

async function tick() {
  const now = Date.now();

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
      context = renderClaudeContext(parsed.events, parsed.firstPrompt);
    } else {
      const tail = ptyManager.tail(s.id, 4096).replace(ANSI_RE, "");
      sig = crypto.createHash("sha1").update(tail.slice(-4096)).digest("hex");
      context = tail.slice(-2048);
    }
    if (!shouldLabel(s.id, sig, now)) continue;
    await labelSession(context, (meta) => sessionManager.setAiMeta(s.id, meta));
  }

  // 2) Every live (<30min) external session — the same set the sidebar shows,
  //    NOT just ones with an open tab. externalSessions() already excludes
  //    owned twins + dismissed/stale, and its parse is cache-warm (the status
  //    ticker keeps it hot), so this stays cheap.
  for (const s of transcriptRegistry.externalSessions()) {
    const parsed = transcriptRegistry.getParsed(s.id);
    if (!parsed || parsed.events.length === 0) continue;
    const sig = transcriptSig(parsed.events);
    if (!shouldLabel(s.id, sig, now)) continue;
    await labelSession(
      renderClaudeContext(parsed.events, parsed.firstPrompt),
      (meta) => transcriptRegistry.setAiMeta(s.id, meta),
    );
  }
}
