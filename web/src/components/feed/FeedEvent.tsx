import { useState, memo } from "react";
import {
  FileText,
  FileEdit,
  FilePlus,
  SquareTerminal,
  Search,
  Globe,
  GitFork,
  Wrench,
  Check,
  X,
  Loader,
  ChevronRight,
  Brain,
} from "lucide-react";
import type { TranscriptEvent, ToolStatus } from "@deck/shared";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";
import { renderMarkdown } from "../../lib/markdown";
import { DiffLines } from "../diff/DiffLines";

export const FeedEvent = memo(function FeedEvent({
  event,
  onResize,
}: {
  event: TranscriptEvent;
  onResize?: () => void;
}) {
  switch (event.kind) {
    case "user":
      return <UserEvent event={event} />;
    case "assistant":
      return <AssistantEvent event={event} />;
    case "thinking":
      return <ThinkingEvent event={event} onResize={onResize} />;
    case "tool":
      return <ToolEvent event={event} onResize={onResize} />;
    case "subagent":
      return <SubagentEvent event={event} onResize={onResize} />;
    case "meta":
      return <MetaEvent event={event} />;
    default:
      return null;
  }
});

function UserEvent({ event }: { event: Extract<TranscriptEvent, { kind: "user" }> }) {
  return (
    <div className="py-1.5">
      <div className="rounded-[8px] border-l-2 border-[color:var(--accent)] bg-raised px-3 py-2">
        <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-t1">
          {event.text}
        </div>
        {event.images ? (
          <div className="mt-1 text-[11px] text-t3">
            {event.images} image{event.images > 1 ? "s" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantEvent({
  event,
}: {
  event: Extract<TranscriptEvent, { kind: "assistant" }>;
}) {
  return (
    <div className="py-1.5">
      <div
        className="deck-md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(event.markdown) }}
      />
    </div>
  );
}

function ThinkingEvent({
  event,
  onResize,
}: {
  event: Extract<TranscriptEvent, { kind: "thinking" }>;
  onResize?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const kchars = event.chars > 999 ? `${(event.chars / 1000).toFixed(1)}k` : `${event.chars}`;
  return (
    <div className="py-0.5">
      <button
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => onResize?.());
        }}
        className="flex items-center gap-1.5 text-[12px] text-t3 hover:text-t2"
      >
        <Brain size={12} />
        <span className="italic">thought for a moment · {kchars} chars</span>
        {event.text ? (
          <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
        ) : null}
      </button>
      {open && event.text && (
        <div className="mt-1 whitespace-pre-wrap rounded-[6px] border border-hair bg-panel px-3 py-2 text-[12.5px] italic leading-[1.5] text-t2">
          {event.text}
        </div>
      )}
    </div>
  );
}

const TOOL_ICON: Record<string, typeof Wrench> = {
  read: FileText,
  edit: FileEdit,
  write: FilePlus,
  bash: SquareTerminal,
  search: Search,
  web: Globe,
  task: GitFork,
  tool: Wrench,
};

function StatusGlyph({ status }: { status: ToolStatus }) {
  if (status === "pending")
    return <Loader size={12} className="animate-spin text-[color:var(--warn)]" />;
  if (status === "error") return <X size={12} className="text-[color:var(--err)]" />;
  return <Check size={12} className="text-t3" />;
}

function ToolEvent({
  event,
  onResize,
}: {
  event: Extract<TranscriptEvent, { kind: "tool" }>;
  onResize?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[event.icon] ?? Wrench;
  const expandable = !!event.detail || !!event.resultPreview || !!event.isEdit;
  return (
    <div className="py-[3px]">
      <button
        onClick={() => {
          if (!expandable) return;
          setOpen((o) => !o);
          requestAnimationFrame(() => onResize?.());
        }}
        className={cn(
          "group flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left",
          expandable && "hover:bg-raised",
        )}
      >
        <Icon size={14} className="shrink-0 text-t2" />
        <span className="truncate text-[12.5px] text-t1">{event.title}</span>
        {event.detail && (
          <span className="truncate font-mono text-[11.5px] text-t3">{event.detail}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <StatusGlyph status={event.status} />
          <span className="mono text-[11px] text-t3">{relTime(event.ts)}</span>
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-1">
          {event.isEdit && event.isEdit.lines.length > 0 && (
            <div className="mb-1 overflow-hidden rounded-[6px] border border-hair bg-panel">
              <div className="border-b border-hair px-2 py-1 font-mono text-[11px] text-t2">
                {event.isEdit.path}
              </div>
              <DiffLines lines={event.isEdit.lines} />
            </div>
          )}
          {event.resultPreview && (
            <pre className="max-h-[320px] overflow-auto rounded-[6px] border border-hair bg-panel px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-t2 whitespace-pre-wrap">
              {event.resultPreview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SubagentEvent({
  event,
  onResize,
}: {
  event: Extract<TranscriptEvent, { kind: "subagent" }>;
  onResize?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-1.5">
      <div className="rounded-[8px] border border-hair bg-panel">
        <button
          onClick={() => {
            setOpen((o) => !o);
            requestAnimationFrame(() => onResize?.());
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <GitFork size={13} className="shrink-0 text-accenttext" />
          <span className="truncate text-[12.5px] text-t1">{event.description}</span>
          <span className="ml-auto shrink-0 text-[11px] text-t3">
            {event.eventCount} events
          </span>
          <ChevronRight size={13} className={cn("shrink-0 text-t3 transition-transform", open && "rotate-90")} />
        </button>
        {open && (
          <div className="border-t border-hair px-3 py-1 pl-5">
            {event.events.map((e) => (
              <FeedEvent key={e.id} event={e} onResize={onResize} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaEvent({ event }: { event: Extract<TranscriptEvent, { kind: "meta" }> }) {
  return (
    <div className="py-0.5 text-[11.5px] text-t3">
      <span className="mono">{event.label}</span>
    </div>
  );
}
