import { diffLines } from "diff";
import type {
  TranscriptEvent,
  DiffLine,
  MiniDiff,
  ToolStatus,
} from "@deck/shared";

// ============================================================================
// jsonl transcript -> render-ready TranscriptEvent[] (§7.2).
// TOLERANCE CONTRACT: unknown line types and unknown content-block types are
// skipped, never thrown. A single malformed line must not break the feed.
// ============================================================================

interface RawLine {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
  };
  toolUseResult?: unknown;
  // metadata line fields
  aiTitle?: string;
  mode?: string;
  permissionMode?: string;
  subtype?: string;
  content?: unknown;
  [k: string]: unknown;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { media_type?: string };
  [k: string]: unknown;
}

export interface ParsedTranscript {
  events: TranscriptEvent[];
  title: string | null;
  cwd: string | null;
  lastTs: number;
  count: number;
  model: string | null; // last assistant message model, humanized-ish
}

const MAX_DIFF_LINES = 240;
const MAX_PREVIEW = 4000;
const MAX_CONTENT = 4000;

export function parseTranscript(rawText: string): ParsedTranscript {
  const lines = rawText.split("\n");
  const parsed: RawLine[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      parsed.push(JSON.parse(t) as RawLine);
    } catch {
      // skip malformed line (partial trailing write, corruption)
    }
  }
  return buildEvents(parsed);
}

export function buildEvents(parsed: RawLine[]): ParsedTranscript {
  let title: string | null = null;
  let cwd: string | null = null;
  let lastTs = 0;
  let model: string | null = null;

  // Pre-group sidechain lines by their root (walk parentUuid up to a
  // non-sidechain/absent parent). Rare in practice; degrades gracefully.
  const byUuid = new Map<string, RawLine>();
  for (const l of parsed) if (l.uuid) byUuid.set(l.uuid, l);
  const sidechainGroups = new Map<string, RawLine[]>();
  const rootCache = new Map<string, string>();
  const sidechainRoot = (l: RawLine): string => {
    let cur = l;
    const seen = new Set<string>();
    while (
      cur.parentUuid &&
      !seen.has(cur.parentUuid) &&
      byUuid.get(cur.parentUuid)?.isSidechain
    ) {
      seen.add(cur.parentUuid);
      cur = byUuid.get(cur.parentUuid)!;
    }
    return cur.uuid ?? l.uuid ?? "sc";
  };
  for (const l of parsed) {
    if (l.isSidechain) {
      const root = rootCache.get(l.uuid ?? "") ?? sidechainRoot(l);
      if (l.uuid) rootCache.set(l.uuid, root);
      const arr = sidechainGroups.get(root) ?? [];
      arr.push(l);
      sidechainGroups.set(root, arr);
    }
  }

  const events: TranscriptEvent[] = [];
  const toolIndex = new Map<string, Extract<TranscriptEvent, { kind: "tool" }>>();
  const emittedSidechainRoots = new Set<string>();

  for (const line of parsed) {
    const ts = line.timestamp ? Date.parse(line.timestamp) : 0;
    if (ts > lastTs) lastTs = ts;
    if (!cwd && typeof line.cwd === "string") cwd = line.cwd;
    if (line.message?.model && !/<synthetic>/.test(line.message.model))
      model = line.message.model;

    // metadata one-liners
    if (line.type === "ai-title" && typeof line.aiTitle === "string") {
      title = line.aiTitle;
      continue;
    }

    if (line.isSidechain) {
      const root = rootCache.get(line.uuid ?? "") ?? "sc";
      if (emittedSidechainRoots.has(root)) continue;
      emittedSidechainRoots.add(root);
      const group = sidechainGroups.get(root) ?? [line];
      const sub = buildEvents(group.map((g) => ({ ...g, isSidechain: false })));
      const description = firstUserText(sub.events) ?? "subagent";
      events.push({
        kind: "subagent",
        id: line.uuid ?? `sub-${events.length}`,
        ts,
        description,
        eventCount: sub.events.length,
        events: sub.events,
      });
      continue;
    }

    handleMainLine(line, ts, events, toolIndex);
  }

  return { events, title, cwd, lastTs, count: events.length, model };
}

function handleMainLine(
  line: RawLine,
  ts: number,
  events: TranscriptEvent[],
  toolIndex: Map<string, Extract<TranscriptEvent, { kind: "tool" }>>,
) {
  const id = line.uuid ?? `e-${events.length}`;

  if (line.type === "user") {
    const content = line.message?.content;
    // tool_result blocks arrive as user lines — pair them, don't render as user
    if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) {
      for (const block of content as ContentBlock[]) {
        if (block.type === "tool_result") applyToolResult(block, line, toolIndex);
      }
      return;
    }
    const { text, images } = extractUserText(content);
    if (text.trim() || images > 0) {
      events.push({ kind: "user", id, ts, text, images: images || undefined });
    }
    return;
  }

  if (line.type === "assistant") {
    const content = line.message?.content;
    if (typeof content === "string") {
      if (content.trim())
        events.push({ kind: "assistant", id, ts, markdown: content });
      return;
    }
    if (!Array.isArray(content)) return;
    for (let i = 0; i < content.length; i++) {
      const block = content[i] as ContentBlock;
      const bid = `${id}-${i}`;
      switch (block.type) {
        case "text":
          if (block.text && block.text.trim())
            events.push({ kind: "assistant", id: bid, ts, markdown: block.text });
          break;
        case "thinking": {
          const text = block.thinking ?? "";
          events.push({ kind: "thinking", id: bid, ts, chars: text.length, text });
          break;
        }
        case "tool_use": {
          const ev = buildToolEvent(block, ts, bid, line.cwd ?? null);
          events.push(ev);
          if (block.id) toolIndex.set(block.id, ev);
          break;
        }
        // unknown block types skipped
      }
    }
    return;
  }

  if (line.type === "system") {
    const c = typeof line.content === "string" ? line.content : "";
    const label = summarizeSystem(line.subtype, c);
    if (label) events.push({ kind: "meta", id, ts, label });
    return;
  }
  // mode / permission-mode / file-history-snapshot / attachment / last-prompt /
  // queue-operation / frame-link / agent-name / summary / unknown -> skipped
}

function applyToolResult(
  block: ContentBlock,
  line: RawLine,
  toolIndex: Map<string, Extract<TranscriptEvent, { kind: "tool" }>>,
) {
  if (!block.tool_use_id) return;
  const ev = toolIndex.get(block.tool_use_id);
  if (!ev) return;
  ev.status = block.is_error ? "error" : "ok";
  ev.resultPreview = truncate(stringifyResult(block.content, line.toolUseResult), MAX_PREVIEW);
}

function buildToolEvent(
  block: ContentBlock,
  ts: number,
  id: string,
  cwd: string | null,
): Extract<TranscriptEvent, { kind: "tool" }> {
  const name = block.name ?? "tool";
  const input = block.input ?? {};
  const { icon, title, detail } = humanizeTool(name, input, cwd);
  const isEdit = buildEditDiff(name, input, cwd);
  return {
    kind: "tool",
    id,
    ts,
    name,
    icon,
    title,
    detail,
    status: "pending" as ToolStatus,
    input,
    resultPreview: "",
    isEdit,
  };
}

// ----------------------------------------------------------------------------
// Humanization
// ----------------------------------------------------------------------------
function rel(p: unknown, cwd: string | null): string {
  if (typeof p !== "string") return "";
  let s = p.replace(/\\/g, "/");
  if (cwd) {
    const c = cwd.replace(/\\/g, "/").replace(/\/$/, "");
    if (s.toLowerCase().startsWith(c.toLowerCase() + "/")) s = s.slice(c.length + 1);
  }
  return s;
}

function humanizeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string | null,
): { icon: string; title: string; detail: string } {
  const firstLine = (v: unknown) =>
    typeof v === "string" ? v.split("\n")[0]!.slice(0, 200) : "";
  switch (name) {
    case "Read":
      return { icon: "read", title: `Read ${rel(input.file_path, cwd)}`, detail: "" };
    case "Edit":
    case "Update":
      return { icon: "edit", title: `Edit ${rel(input.file_path, cwd)}`, detail: "" };
    case "Write":
      return { icon: "write", title: `Write ${rel(input.file_path, cwd)}`, detail: "" };
    case "MultiEdit":
      return {
        icon: "edit",
        title: `MultiEdit ${rel(input.file_path, cwd)}`,
        detail: Array.isArray(input.edits) ? `${input.edits.length} edits` : "",
      };
    case "Bash":
      return { icon: "bash", title: `Bash`, detail: firstLine(input.command) };
    case "Grep":
      return { icon: "search", title: `Grep "${firstLine(input.pattern)}"`, detail: "" };
    case "Glob":
      return { icon: "search", title: `Glob ${firstLine(input.pattern)}`, detail: "" };
    case "Task":
      return {
        icon: "task",
        title: `Task: ${firstLine(input.description) || firstLine(input.subagent_type)}`,
        detail: "",
      };
    case "WebFetch":
      return { icon: "web", title: `Fetch ${firstLine(input.url)}`, detail: "" };
    case "WebSearch":
      return { icon: "web", title: `Search "${firstLine(input.query)}"`, detail: "" };
    case "TodoWrite":
      return { icon: "tool", title: "Update todos", detail: "" };
    default: {
      const firstVal = Object.values(input)[0];
      return { icon: "tool", title: name, detail: firstLine(firstVal) };
    }
  }
}

// ----------------------------------------------------------------------------
// Edit -> mini-diff (§7.2: highest-value rendering)
// ----------------------------------------------------------------------------
function buildEditDiff(
  name: string,
  input: Record<string, unknown>,
  cwd: string | null,
): MiniDiff | null {
  const path = rel(input.file_path, cwd);
  if (name === "Edit" || name === "Update") {
    return {
      path,
      lines: capLines(pairDiff(str(input.old_string), str(input.new_string))),
    };
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    const lines: DiffLine[] = [];
    for (const e of input.edits as Record<string, unknown>[]) {
      lines.push(...pairDiff(str(e.old_string), str(e.new_string)));
      lines.push({ type: "meta", oldNo: null, newNo: null, text: "" });
    }
    return { path, lines: capLines(lines) };
  }
  if (name === "Write") {
    const content = str(input.content);
    if (!content) return null;
    return { path, lines: capLines(pairDiff("", content)) };
  }
  return null;
}

function pairDiff(oldStr: string, newStr: string): DiffLine[] {
  const parts = diffLines(oldStr, newStr);
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of parts) {
    const segLines = part.value.split("\n");
    if (segLines[segLines.length - 1] === "") segLines.pop();
    for (const text of segLines) {
      if (part.added) {
        out.push({ type: "add", oldNo: null, newNo: newNo++, text });
      } else if (part.removed) {
        out.push({ type: "del", oldNo: oldNo++, newNo: null, text });
      } else {
        out.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
      }
    }
  }
  return out;
}

function capLines(lines: DiffLine[]): DiffLine[] {
  if (lines.length <= MAX_DIFF_LINES) return lines;
  const head = lines.slice(0, MAX_DIFF_LINES);
  head.push({
    type: "meta",
    oldNo: null,
    newNo: null,
    text: `… ${lines.length - MAX_DIFF_LINES} more lines`,
  });
  return head;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function extractUserText(content: unknown): { text: string; images: number } {
  if (typeof content === "string") return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: "", images: 0 };
  let text = "";
  let images = 0;
  for (const block of content as ContentBlock[]) {
    if (block.type === "text" && block.text) text += (text ? "\n" : "") + block.text;
    else if (block.type === "image") images++;
  }
  return { text, images };
}

function firstUserText(events: TranscriptEvent[]): string | null {
  for (const e of events) {
    if (e.kind === "user" && e.text.trim())
      return e.text.split("\n")[0]!.slice(0, 120);
  }
  return null;
}

function stringifyResult(content: unknown, structured: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .map((b) => (b.type === "text" ? b.text ?? "" : b.type === "image" ? "[image]" : ""))
      .join("\n");
  }
  if (structured && typeof structured === "object") {
    try {
      return JSON.stringify(structured).slice(0, MAX_CONTENT);
    } catch {
      return "";
    }
  }
  return "";
}

function summarizeSystem(subtype: string | undefined, content: string): string | null {
  if (subtype === "local_command") return null; // noisy, skip
  const c = content.replace(/<[^>]+>/g, "").trim();
  if (!c) return null;
  return c.slice(0, 160);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `… [${s.length} chars]` : s;
}
