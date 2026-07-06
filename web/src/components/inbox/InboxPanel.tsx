import { useEffect, useRef, useState } from "react";
import {
  Bell,
  X,
  CircleAlert,
  CheckCircle2,
  XCircle,
  Pencil,
  DollarSign,
} from "lucide-react";
import type { Session } from "@deck/shared";
import { useUIStore } from "../../stores/uiStore";
import { useInboxItems, type InboxItem, type InboxKind } from "../../lib/useInbox";
import { useProjectsStore } from "../../stores/projectsStore";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";

// M8: right-side Attention Inbox slide-over. One global "needs you" queue —
// triage without opening tabs.
export function InboxPanel() {
  const open = useUIStore((s) => s.inboxOpen);
  const setOpen = useUIStore((s) => s.setInboxOpen);
  const items = useInboxItems();
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown" || e.key === "j")
        setFocus((f) => Math.min(f + 1, items.length - 1));
      else if (e.key === "ArrowUp" || e.key === "k")
        setFocus((f) => Math.max(f - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items.length, setOpen]);

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-hair bg-panel shadow-[var(--shadow-overlay)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hair px-4">
        <Bell size={16} className="text-t2" />
        <span className="text-[14px] font-semibold text-t1">Inbox</span>
        <span className="mono text-[11px] text-t3">{items.length}</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1"
          aria-label="Close inbox"
        >
          <X size={15} />
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        style={{ scrollbarGutter: "stable" }}
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-t3">
            <CheckCircle2 size={28} className="opacity-40" />
            <span className="text-[13px]">Nothing needs you.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item, i) => (
              <InboxCard
                key={item.id}
                item={item}
                focused={i === focus}
                onFocus={() => setFocus(i)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

const KIND_META: Record<
  InboxKind,
  { icon: typeof Bell; color: string; label: string }
> = {
  attention: { icon: CircleAlert, color: "var(--warn)", label: "Needs input" },
  finished: { icon: CheckCircle2, color: "var(--ok)", label: "Finished" },
  exited: { icon: XCircle, color: "var(--err)", label: "Exited" },
  review: { icon: Pencil, color: "var(--accent)", label: "Review" },
  budget: { icon: DollarSign, color: "var(--warn)", label: "Budget" },
};

function InboxCard({
  item,
  focused,
  onFocus,
}: {
  item: InboxItem;
  focused: boolean;
  onFocus: () => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const projectName = useProjectsStore(
    (s) => s.byId[item.projectId]?.name ?? item.projectId,
  );
  const openSession = useUIStore((s) => s.openSession);
  const openProject = useUIStore((s) => s.openProject);
  const setGitFocusPath = useUIStore((s) => s.setGitFocusPath);
  const setTopView = useUIStore((s) => s.setTopView);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const session = item.session;
  const title = session
    ? session.aiMeta?.title ?? session.title ?? session.name
    : item.review
      ? "Review"
      : "Budget";

  const open = () => {
    if (session) {
      void api.markSessionRead(session.id).catch(() => {});
      openSession(session.id, session.projectId);
    } else if (item.review) {
      const first = item.review.files[0];
      if (first) setGitFocusPath({ projectId: item.review.projectId, path: first });
      openProject(item.review.projectId, "git");
    } else if (item.kind === "budget") {
      setTopView("costs");
    }
  };

  const dismiss = () => {
    if (item.kind === "review" && item.review) {
      void api.dismissReview(item.review.id).catch(() => {});
    } else if (session) {
      void api.markSessionRead(session.id).catch(() => {});
    }
  };

  return (
    <div
      ref={ref}
      onMouseEnter={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
        if (e.key === "x") dismiss();
      }}
      tabIndex={0}
      className={cn(
        "rounded-[8px] border bg-raised p-2.5 outline-none transition-colors",
        focused ? "border-hairfocus" : "border-hair",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color: meta.color }} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-t1">
          {title}
        </span>
        <span className="mono shrink-0 text-[10.5px] text-t3">
          {relTime(item.activityAt)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-[22px]">
        <span className="truncate text-[11px] text-t3">{projectName}</span>
      </div>

      {item.review && (
        <div className="mt-1.5 pl-[22px]">
          {item.review.summary && (
            <p className="mb-1 text-[11.5px] text-t2">{item.review.summary}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {item.review.files.slice(0, 4).map((f) => (
              <span
                key={f}
                className="mono rounded-[4px] bg-panel px-1 py-0.5 text-[10px] text-t3"
              >
                {f.split("/").pop()}
              </span>
            ))}
            {item.review.files.length > 4 && (
              <span className="text-[10px] text-t3">
                +{item.review.files.length - 4}
              </span>
            )}
          </div>
        </div>
      )}

      {item.budget && (
        <p className="mt-1 pl-[22px] text-[11.5px] text-warn">{item.budget.text}</p>
      )}

      {session?.lastActivityLine && item.kind !== "attention" && (
        <p className="mt-1 truncate pl-[22px] text-[11.5px] text-t2">
          {session.lastActivityLine}
        </p>
      )}

      {item.kind === "attention" &&
        session?.promptTail &&
        session.promptTail.length > 0 && (
          <PromptTail lines={session.promptTail} />
        )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1.5 pl-[22px]">
        {item.kind === "attention" && session?.source === "owned" ? (
          <QuickRespond session={session} />
        ) : (
          <button
            onClick={open}
            className="h-6 rounded-[5px] border border-hair bg-panel px-2 text-[11px] text-t2 hover:bg-overlay hover:text-t1"
          >
            {item.kind === "review" ? "Review" : item.kind === "budget" ? "Open Costs" : "Open"}
          </button>
        )}
        {item.kind !== "budget" && item.kind !== "attention" && (
          <button
            onClick={dismiss}
            className="h-6 rounded-[5px] px-2 text-[11px] text-t3 hover:text-t1"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function PromptTail({ lines }: { lines: string[] }) {
  return (
    <div className="mt-1.5 max-h-[150px] overflow-y-auto rounded-[6px] bg-panel p-2 pl-[22px]">
      <pre className="mono whitespace-pre-wrap break-words text-[10.5px] leading-[1.5] text-t2">
        {lines.join("\n")}
      </pre>
    </div>
  );
}

// Quick-respond row for an owned claude waiting on a prompt. Answering does NOT
// open the tab. Digits/letters go as-is; Esc as \x1b; text input as text + ⏎.
function QuickRespond({ session }: { session: Session }) {
  const [text, setText] = useState("");
  const tail = (session.promptTail ?? []).join("\n");
  const looksInteractive = /❯|Do you want|\by\/n\b|Yes.*No/i.test(tail);

  const send = (raw: string, submit: boolean) => {
    void api.sendInput(session.id, raw, submit).catch(() => {});
  };

  if (!looksInteractive) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && text) {
            send(text, true);
            setText("");
          }
        }}
        placeholder="Reply…"
        className="h-6 flex-1 rounded-[5px] border border-hair bg-panel px-1.5 text-[11px] text-t1 focus:border-hairfocus focus:outline-none"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {["1", "2", "3"].map((d) => (
        <button
          key={d}
          onClick={() => send(d, false)}
          className="mono flex h-6 w-6 items-center justify-center rounded-[5px] border border-hair bg-panel text-[11px] text-t2 hover:bg-overlay hover:text-t1"
        >
          {d}
        </button>
      ))}
      <button
        onClick={() => send("y", true)}
        className="mono flex h-6 items-center rounded-[5px] border border-hair bg-panel px-1.5 text-[11px] text-t2 hover:bg-overlay hover:text-t1"
      >
        y⏎
      </button>
      <button
        onClick={() => send("\x1b", false)}
        className="mono flex h-6 items-center rounded-[5px] border border-hair bg-panel px-1.5 text-[11px] text-t2 hover:bg-overlay hover:text-t1"
      >
        Esc
      </button>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && text) {
            send(text, true);
            setText("");
          }
        }}
        placeholder="…"
        className="h-6 w-[70px] flex-1 rounded-[5px] border border-hair bg-panel px-1.5 text-[11px] text-t1 focus:border-hairfocus focus:outline-none"
      />
    </div>
  );
}
