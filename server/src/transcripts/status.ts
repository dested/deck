import type { AgentStats, SessionStatus, TranscriptEvent } from "@deck/shared";

const SEC = 1000;
const WORKING = 20 * SEC;
const ATTENTION_IDLE = 5 * SEC;
const STALE = 30 * 60 * SEC;

// §7.4 status heuristics for a transcript-backed (external) session.
export function computeStatus(
  mtimeMs: number,
  events: TranscriptEvent[],
  now = Date.now(),
): SessionStatus {
  const age = now - mtimeMs;
  if (age > STALE) return "stale";
  const last = events[events.length - 1];
  const pendingTool = last?.kind === "tool" && last.status === "pending";
  if (age < WORKING || pendingTool) return "working";
  // turn complete: an assistant message ending the turn, idle > 5s => attention
  if (last?.kind === "assistant" && age > ATTENTION_IDLE) return "attention";
  return "idle";
}

// One-line "last activity" for cards/sidebar (§9.2).
export function lastActivityLine(events: TranscriptEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    switch (e.kind) {
      case "tool":
        return `⚒ ${e.title}`;
      case "assistant": {
        const line = e.markdown
          .replace(/[#*`>_]/g, "")
          .split("\n")
          .map((l) => l.trim())
          .find(Boolean);
        if (line) return line.slice(0, 160);
        break;
      }
      case "user":
        return e.text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) ?? null;
      case "thinking":
        return "thinking…";
      case "subagent":
        return `⑂ ${e.description}`;
    }
  }
  return null;
}

// Roll up counts for the Agents cards. Counts top-level events; tool calls
// inside a subagent are summarized by the subagent card, not double-counted.
export function computeStats(
  events: TranscriptEvent[],
  model: string | null,
): AgentStats {
  let messages = 0;
  let tools = 0;
  let edits = 0;
  for (const e of events) {
    if (e.kind === "user" || e.kind === "assistant") messages++;
    else if (e.kind === "tool") {
      tools++;
      if (e.isEdit) edits++;
    }
  }
  return { messages, tools, edits, model };
}

// Cheap per-event signature for diffing live tails (avoid hashing huge inputs).
export function eventSignature(e: TranscriptEvent): string {
  switch (e.kind) {
    case "tool":
      return `${e.id}|${e.status}|${e.resultPreview.length}`;
    case "assistant":
      return `${e.id}|${e.markdown.length}`;
    case "thinking":
      return `${e.id}|${e.chars}`;
    case "user":
      return `${e.id}|${e.text.length}`;
    case "subagent":
      return `${e.id}|${e.eventCount}`;
    default:
      return e.id;
  }
}
