import { useEffect, useMemo, useState } from "react";
import {
  X,
  Star,
  ListTodo,
  SkipForward,
  Trash2,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import type { TaskCard } from "@deck/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";
import { moveToStatus } from "../../lib/tasks";
import { useTasksStore } from "../../stores/tasksStore";
import { ProjectPicker } from "./ProjectPicker";
import { CardThumbs } from "./taskImages";

// Triage: the ADHD answer to "24 things and no idea where to start". Deals ONE
// inbox card at a time — full attention, four keys, a progress bar — so
// deciding is a 90-second game instead of staring at a wall. Nothing here is
// new state: it's just inbox cards moved with the same moveToStatus everyone
// else uses.

type Verdict = "now" | "next" | "keep" | "trash";

const ACTIONS: { key: Verdict; label: string; hotkey: string; icon: LucideIcon }[] = [
  { key: "now", label: "Now", hotkey: "1", icon: Star },
  { key: "next", label: "Next", hotkey: "2", icon: ListTodo },
  { key: "keep", label: "Keep", hotkey: "3", icon: SkipForward },
  { key: "trash", label: "Trash", hotkey: "4", icon: Trash2 },
];

export function TriageMode({
  projectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const tasks = useTasksStore((s) => s.byId);

  // The dealt queue is frozen at mount (oldest first — clear the backlog);
  // cards added mid-triage wait for the next round.
  const [queue] = useState<string[]>(() =>
    Object.values(useTasksStore.getState().byId)
      .filter((t) => t.status === "inbox" && (!projectId || t.projectId === projectId))
      .sort((a, z) => a.createdAt - z.createdAt)
      .map((t) => t.id),
  );
  const [idx, setIdx] = useState(0);
  const [decided, setDecided] = useState(0);

  // Skip ids that vanished or moved out of inbox behind our back.
  const current = useMemo(() => {
    for (let i = idx; i < queue.length; i++) {
      const t = tasks[queue[i]!];
      if (t && t.status === "inbox") return t;
    }
    return null;
  }, [queue, idx, tasks]);

  const decide = (t: TaskCard, verdict: Verdict) => {
    if (verdict === "trash") void api.deleteTask(t.id).catch(() => {});
    else if (verdict !== "keep") moveToStatus(t, verdict);
    setDecided((n) => n + 1);
    setIdx((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") return onClose();
      if (!current) return;
      const action = ACTIONS.find((a) => a.hotkey === e.key);
      if (action) {
        e.preventDefault();
        decide(current, action.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, onClose]);

  const total = queue.length;
  const progress = total ? Math.min(1, decided / total) : 1;

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center overflow-y-auto bg-root/95 backdrop-blur-sm">
      <div className="flex w-full max-w-[600px] flex-1 flex-col px-5 py-6">
        {/* Header + progress */}
        <div className="mb-1.5 flex items-center gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-t2">
            Triage
          </span>
          <span className="mono text-[11.5px] text-t3">
            {Math.min(decided + 1, total)} of {total}
          </span>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1"
            aria-label="Exit triage (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mb-6 h-1 w-full overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {current ? (
          <>
            {/* The one card */}
            <div className="rounded-[14px] border border-hair bg-panel p-5">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h2 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug text-t1">
                  {current.title}
                </h2>
                <span className="mono shrink-0 text-[10.5px] text-t3">
                  {relTime(current.createdAt)}
                </span>
              </div>
              {!projectId && (
                <div className="mb-2">
                  <ProjectPicker
                    value={current.projectId}
                    onChange={(id) =>
                      void api.updateTask(current.id, { projectId: id }).catch(() => {})
                    }
                  />
                </div>
              )}
              {current.body.trim() && (
                <p className="max-h-[240px] overflow-y-auto whitespace-pre-line text-[12.5px] leading-relaxed text-t2">
                  {current.body}
                </p>
              )}
              <CardThumbs task={current} />
            </div>

            {/* Verdicts */}
            <div className="mt-4 grid grid-cols-4 gap-2">
              {ACTIONS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => decide(current, a.key)}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 rounded-[10px] border transition-colors",
                    a.key === "now"
                      ? "border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 text-accenttext hover:bg-[color:var(--accent)]/20"
                      : a.key === "trash"
                        ? "border-hair bg-panel text-t3 hover:border-[color:var(--err)]/40 hover:text-err"
                        : "border-hair bg-panel text-t2 hover:bg-raised hover:text-t1",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    <a.icon size={13} /> {a.label}
                  </span>
                  <kbd className="mono text-[9.5px] opacity-60">{a.hotkey}</kbd>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[10.5px] text-t3">
              Keep = stays in the pile · Esc exits anytime, progress is already saved
            </p>
          </>
        ) : (
          /* Queue exhausted — the win screen */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
            <PartyPopper size={28} className="text-accenttext" />
            <p className="text-[15px] font-semibold text-t1">
              {total === 0 ? "Nothing to triage" : "Pile triaged."}
            </p>
            <p className="max-w-[360px] text-[12px] leading-relaxed text-t3">
              {total === 0
                ? "The inbox is empty — go dump something in it."
                : `${decided} decision${decided === 1 ? "" : "s"} made. Every card left is one you chose to keep.`}
            </p>
            <button
              onClick={onClose}
              className="mt-2 h-8 rounded-[7px] bg-accent px-4 text-[12.5px] font-medium text-white"
            >
              Back to the board
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
