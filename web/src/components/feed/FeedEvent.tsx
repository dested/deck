import { useState, memo, type ReactNode } from "react";
import type { TranscriptEvent, ToolStatus } from "@deck/shared";
import { cn } from "../../lib/cn";
import { renderMarkdown } from "../../lib/markdown";
import { DiffLines } from "../diff/DiffLines";

// The transcript is rendered to read like Claude Code's own terminal output:
// one monospace column, a colored `●` bullet per turn, tool results hanging off
// a `⎿` branch, collapsed noise dimmed to grey. No icons, no per-line
// timestamps, no boxes — the things that made this feel like "noise".

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

// A terminal row: a fixed one-char marker gutter, then hanging content aligned
// underneath. Matches CC's `● text` / `  ⎿ text` two-space rhythm.
function Row({
  marker,
  markerClass,
  children,
  onClick,
  className,
}: {
  marker: ReactNode;
  markerClass?: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn("flex gap-[1ch]", onClick && "cursor-pointer", className)}
      onClick={onClick}
    >
      <span
        className={cn(
          "shrink-0 select-none text-center leading-[1.6]",
          markerClass,
        )}
        style={{ width: "1ch" }}
        aria-hidden
      >
        {marker}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function UserEvent({ event }: { event: Extract<TranscriptEvent, { kind: "user" }> }) {
  return (
    <div className="my-1.5 border-l-2 border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] py-1.5 pl-2.5 pr-2">
      <div className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-t1">
        {event.text}
      </div>
      {event.images ? (
        <div className="mt-1 text-[11px] text-t3">
          {event.images} image{event.images > 1 ? "s" : ""}
        </div>
      ) : null}
    </div>
  );
}

function AssistantEvent({
  event,
}: {
  event: Extract<TranscriptEvent, { kind: "assistant" }>;
}) {
  return (
    <Row marker="●" markerClass="text-accenttext leading-[1.7]" className="py-1">
      <div
        className="deck-md deck-term-md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(event.markdown) }}
      />
    </Row>
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
  const kchars =
    event.chars > 999 ? `${(event.chars / 1000).toFixed(1)}k` : `${event.chars}`;
  const toggle = () => {
    if (!event.text) return;
    setOpen((o) => !o);
    requestAnimationFrame(() => onResize?.());
  };
  return (
    <div className="py-0.5">
      <Row marker="✻" markerClass="text-t3" onClick={event.text ? toggle : undefined}>
        <span className="text-[12.5px] italic leading-[1.6] text-t3 hover:text-t2">
          Thinking… <span className="not-italic text-t3">· {kchars}</span>
        </span>
      </Row>
      {open && event.text && (
        <div className="ml-[2ch] mt-1 whitespace-pre-wrap border-l border-hair pl-3 text-[12px] italic leading-[1.55] text-t2">
          {event.text}
        </div>
      )}
    </div>
  );
}

function bulletClass(status: ToolStatus): string {
  if (status === "pending") return "text-warn deck-pulse";
  if (status === "error") return "text-err";
  return "text-t2";
}

// Bold verb + parenthesized argument, the way CC prints tool calls:
//   Read(server/src/config.ts)   Bash(node -e "…")   Edit(cliffnotes.md)
function formatTool(ev: Extract<TranscriptEvent, { kind: "tool" }>): {
  verb: string;
  arg: string;
} {
  const title = ev.title || ev.name || "tool";
  const sp = title.indexOf(" ");
  const verb = (sp === -1 ? title : title.slice(0, sp)).replace(/:$/, "");
  const rest = sp === -1 ? "" : title.slice(sp + 1);
  return { verb, arg: ev.detail || rest };
}

function ToolEvent({
  event,
  onResize,
}: {
  event: Extract<TranscriptEvent, { kind: "tool" }>;
  onResize?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { verb, arg } = formatTool(event);

  const edit = event.isEdit && event.isEdit.lines.length > 0 ? event.isEdit : null;
  const editStats = edit
    ? edit.lines.reduce(
        (a, l) => {
          if (l.type === "add") a.add++;
          else if (l.type === "del") a.del++;
          return a;
        },
        { add: 0, del: 0 },
      )
    : null;

  const resultLines = event.resultPreview ? event.resultPreview.split("\n") : [];
  const firstResult = resultLines[0] ?? "";
  const extraLines = Math.max(0, resultLines.length - 1);

  const expandable = !!edit || resultLines.length > 0;
  const toggle = () => {
    if (!expandable) return;
    setOpen((o) => !o);
    requestAnimationFrame(() => onResize?.());
  };

  return (
    <div className="py-[2px]">
      <Row
        marker="●"
        markerClass={cn(bulletClass(event.status), "leading-[1.6]")}
        onClick={expandable ? toggle : undefined}
        className="group rounded-[4px] hover:bg-raised"
      >
        <div className="text-[12.5px] leading-[1.6]">
          <span className="font-semibold text-t1">{verb}</span>
          {arg ? (
            <span className="text-t2">
              (<span className="break-all">{arg}</span>)
            </span>
          ) : null}
        </div>
      </Row>

      {/* Result branch */}
      <div className="ml-[2ch]">
        {edit ? (
          <>
            <Row marker="⎿" markerClass="text-t3" onClick={toggle}>
              <span className="text-[12px] leading-[1.6] text-t3">
                {open ? "" : "Updated "}
                <span className="text-ok">+{editStats!.add}</span>{" "}
                <span className="text-err">−{editStats!.del}</span>
                {!open && extraLines >= 0 ? (
                  <span className="text-t3"> · ctrl+o to expand</span>
                ) : null}
              </span>
            </Row>
            {open && (
              <div className="ml-[2ch] mt-1 overflow-hidden rounded-[4px] border border-hair bg-panel">
                <div className="border-b border-hair px-2 py-1 text-[11px] text-t2">
                  {edit.path}
                </div>
                <DiffLines lines={edit.lines} />
              </div>
            )}
          </>
        ) : resultLines.length > 0 ? (
          !open ? (
            <Row marker="⎿" markerClass="text-t3" onClick={toggle}>
              <span className="truncate text-[12px] leading-[1.6] text-t3">
                {firstResult || "(no output)"}
                {extraLines > 0 ? (
                  <span className="text-t3"> … +{extraLines} lines</span>
                ) : null}
              </span>
            </Row>
          ) : (
            <Row marker="⎿" markerClass="text-t3" onClick={toggle}>
              <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap rounded-[4px] border border-hair bg-panel px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-t2">
                {event.resultPreview}
              </pre>
            </Row>
          )
        ) : null}
      </div>
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
  const toggle = () => {
    setOpen((o) => !o);
    requestAnimationFrame(() => onResize?.());
  };
  return (
    <div className="py-[2px]">
      <Row
        marker="●"
        markerClass="text-accenttext leading-[1.6]"
        onClick={toggle}
        className="group rounded-[4px] hover:bg-raised"
      >
        <div className="text-[12.5px] leading-[1.6]">
          <span className="font-semibold text-t1">Task</span>
          <span className="text-t2">
            (<span className="break-all">{event.description}</span>)
          </span>
        </div>
      </Row>
      <div className="ml-[2ch]">
        <Row marker="⎿" markerClass="text-t3" onClick={toggle}>
          <span className="text-[12px] leading-[1.6] text-t3">
            {event.eventCount} events{open ? "" : " · ctrl+o to expand"}
          </span>
        </Row>
        {open && (
          <div className="ml-[2ch] mt-1 border-l border-hair pl-2">
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
    <Row marker="·" markerClass="text-t3" className="py-0.5">
      <span className="text-[11.5px] leading-[1.6] text-t3">{event.label}</span>
    </Row>
  );
}
