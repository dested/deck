import { useEffect, useMemo, useRef, useState } from "react";
import { Kanban, Plus, Play, Trash2, Pencil } from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { TaskCard, Session } from "@deck/shared";
import { useTasksStore } from "../stores/tasksStore";
import { useReviewsStore } from "../stores/reviewsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useProjectsStore, selectSortedProjects } from "../stores/projectsStore";
import { useUIStore } from "../stores/uiStore";
import { useSessionCost } from "../lib/useCost";
import { api } from "../lib/api";
import { fmtUsd } from "../lib/format";
import { cn } from "../lib/cn";
import { StatusDot } from "../components/ui/StatusDot";
import { PromptToolbar } from "../components/prompt/PromptToolbar";
import { menuContent, menuContentStyle, menuItem } from "../components/ui/menuStyles";
import { toast } from "../components/ui/Toast";

type Column = "backlog" | "queued" | "running" | "needsyou" | "review" | "done";
const COLUMNS: { key: Column; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "needsyou", label: "Needs you" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];
const MANUAL: Column[] = ["backlog", "queued"];

// M17 (hybrid board): you hand-manage only the pre-run columns; every column
// after is derived from the linked session's live status.
export function BoardView() {
  const tasks = useTasksStore((s) => s.byId);
  const reviews = useReviewsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [shakeCol, setShakeCol] = useState<Column | null>(null);

  const columnFor = useMemo(() => {
    return (t: TaskCard): Column => {
      if (t.status === "backlog") return "backlog";
      if (t.status === "queued") return "queued";
      if (t.status === "done") return "done";
      // linked → derive from the session.
      const s = t.sessionId ? sessions[t.sessionId] : undefined;
      if (!s || s.status === "exited") return "done";
      if (s.status === "attention") return "needsyou";
      const review = t.sessionId ? reviews[t.sessionId] : undefined;
      if (review && !review.dismissed && s.status === "idle") return "review";
      return "running";
    };
  }, [sessions, reviews]);

  const byColumn = useMemo(() => {
    const map: Record<Column, TaskCard[]> = {
      backlog: [],
      queued: [],
      running: [],
      needsyou: [],
      review: [],
      done: [],
    };
    for (const t of Object.values(tasks)) map[columnFor(t)].push(t);
    for (const k of Object.keys(map) as Column[])
      map[k].sort((a, b) =>
        k === "done" ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.order - b.order,
      );
    return map;
  }, [tasks, columnFor]);

  const dropOnColumn = async (col: Column) => {
    if (!dragId) return;
    const task = tasks[dragId];
    setDragId(null);
    if (!task) return;
    const from = columnFor(task);
    const legal =
      (MANUAL.includes(from) && MANUAL.includes(col)) || col === "done";
    if (!legal) {
      setShakeCol(col);
      setTimeout(() => setShakeCol(null), 400);
      return;
    }
    if (col === "done") {
      // Manual drag to Done also closes the session if still alive.
      if (task.sessionId && sessions[task.sessionId]) {
        const s = sessions[task.sessionId];
        if (s && s.status !== "exited") {
          if (!confirm("Close the linked session and mark this task done?")) return;
          await api.dismissSession(task.sessionId).catch(() => {});
        }
      }
      await api.updateTask(task.id, { status: "done" }).catch(() => {});
    } else {
      // Legal here means a manual column (backlog/queued).
      await api
        .updateTask(task.id, { status: col as "backlog" | "queued" })
        .catch(() => {});
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
        <Kanban size={16} className="text-t2" />
        <span className="text-[14px] font-semibold text-t1">Task board</span>
        <AutopilotToggle />
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={() => void dropOnColumn(c.key)}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-[10px] border border-hair bg-panel",
              shakeCol === c.key && "deck-shake",
              dragId &&
                ((MANUAL.includes(c.key)) || c.key === "done") &&
                "border-hairfocus",
            )}
          >
            <div className="flex items-center gap-2 border-b border-hair px-3 py-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-t2">
                {c.label}
              </span>
              <span className="mono text-[11px] text-t3">
                {byColumn[c.key].length}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ scrollbarGutter: "stable" }}>
              {c.key === "backlog" && <NewCardComposer />}
              {byColumn[c.key].map((t) => (
                <BoardCard
                  key={t.id}
                  task={t}
                  column={c.key}
                  session={t.sessionId ? sessions[t.sessionId] : undefined}
                  hasReview={
                    !!t.sessionId &&
                    !!reviews[t.sessionId] &&
                    !reviews[t.sessionId]!.dismissed
                  }
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutopilotToggle() {
  const [enabled, setEnabled] = useState(false);
  const [maxRunning, setMaxRunning] = useState(2);

  // Read current config on mount (a no-op PATCH echoes it back).
  useEffect(() => {
    api
      .setAutopilot({})
      .then((c) => {
        setEnabled(c.enabled);
        setMaxRunning(c.maxRunning);
      })
      .catch(() => {});
  }, []);

  const patch = async (body: { enabled?: boolean; maxRunning?: number }) => {
    try {
      const next = await api.setAutopilot(body);
      setEnabled(next.enabled);
      setMaxRunning(next.maxRunning);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      {enabled && <span className="h-2 w-2 rounded-full bg-warn deck-pulse" />}
      <span className="text-[12px] text-t2">Autopilot</span>
      <button
        onClick={() => void patch({ enabled: !enabled })}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          enabled ? "bg-accent" : "bg-raised",
        )}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: enabled ? 18 : 2 }}
        />
      </button>
      <div className="flex items-center rounded-[6px] border border-hair">
        <button
          onClick={() => void patch({ maxRunning: Math.max(1, maxRunning - 1) })}
          className="h-6 w-6 text-t3 hover:text-t1"
        >
          −
        </button>
        <span className="mono w-5 text-center text-[12px] text-t1">{maxRunning}</span>
        <button
          onClick={() => void patch({ maxRunning: Math.min(8, maxRunning + 1) })}
          className="h-6 w-6 text-t3 hover:text-t1"
        >
          +
        </button>
      </div>
    </div>
  );
}

function NewCardComposer() {
  const projects = useProjectsStore((s) => s.byId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const sorted = selectSortedProjects(projects);

  const create = async () => {
    if (!title.trim() || !projectId) return;
    await api.createTask({ title: title.trim(), body, projectId }).catch(() => {});
    setTitle("");
    setBody("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-1 rounded-[8px] border border-dashed border-hair py-2 text-[12px] text-t3 hover:border-hairfocus hover:text-t1"
      >
        <Plus size={14} /> New task
      </button>
    );
  }

  return (
    <div className="rounded-[8px] border border-hairfocus bg-raised p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="mb-1.5 h-7 w-full rounded-[5px] border border-hair bg-panel px-2 text-[12.5px] text-t1 focus:border-hairfocus focus:outline-none"
      />
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="mb-1.5 h-7 w-full rounded-[5px] border border-hair bg-panel px-1.5 text-[12px] text-t2 focus:border-hairfocus focus:outline-none"
      >
        <option value="">Select project…</option>
        {sorted.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Prompt / body…"
        rows={3}
        className="mono mb-1.5 w-full resize-none rounded-[5px] border border-hair bg-panel p-2 text-[12px] text-t1 focus:border-hairfocus focus:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <PromptToolbar
          value={body}
          onChange={setBody}
          projectId={projectId || undefined}
          textareaRef={bodyRef}
        />
        <button
          onClick={() => void create()}
          disabled={!title.trim() || !projectId}
          className="ml-auto h-7 rounded-[6px] bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-40"
        >
          Add
        </button>
        <button
          onClick={() => setOpen(false)}
          className="h-7 rounded-[6px] px-2 text-[12px] text-t3 hover:text-t1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function BoardCard({
  task,
  column,
  session,
  hasReview,
  onDragStart,
  onDragEnd,
}: {
  task: TaskCard;
  column: Column;
  session: Session | undefined;
  hasReview: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const projectName = useProjectsStore(
    (s) => s.byId[task.projectId]?.name ?? task.projectId,
  );
  const openSession = useUIStore((s) => s.openSession);
  const cost = useSessionCost(session?.transcriptSessionId ?? null);
  const reviewFiles = useReviewsStore((s) =>
    task.sessionId ? s.byId[task.sessionId]?.files.length : undefined,
  );
  const draggable = MANUAL.includes(column);

  const start = async () => {
    try {
      await api.startTask(task.id);
    } catch {
      toast("Failed to start task", "error");
    }
  };

  const click = () => {
    if (task.sessionId && session) openSession(task.sessionId, task.projectId);
  };

  const summary = session?.aiMeta?.summary;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          draggable={draggable}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onClick={click}
          className={cn(
            "cursor-default rounded-[8px] border border-hair bg-raised p-2.5",
            session && "hover:border-hairfocus",
          )}
        >
          <div className="flex items-start gap-1.5">
            {session ? (
              <StatusDot status={session.status} />
            ) : (
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-t3/40" />
            )}
            <span className="min-w-0 flex-1 text-[12.5px] font-medium text-t1">
              {task.title}
            </span>
          </div>
          {summary && (
            <p className="mt-1 line-clamp-2 pl-[14px] text-[11px] text-t2">
              {summary}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[14px]">
            <span className="mono rounded-[4px] bg-panel px-1.5 py-0.5 text-[10px] text-t3">
              {projectName}
            </span>
            {cost && cost.cost > 0 && (
              <span className="mono text-[10px] text-accenttext">
                {fmtUsd(cost.cost)}
              </span>
            )}
            {hasReview && reviewFiles != null && (
              <span className="mono flex items-center gap-0.5 text-[10px] text-t3">
                <Pencil size={9} /> {reviewFiles}
              </span>
            )}
          </div>
          {column === "backlog" || column === "queued" ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void start();
              }}
              className="mt-2 flex h-6 w-full items-center justify-center gap-1 rounded-[5px] border border-hair bg-panel text-[11px] text-t2 hover:bg-overlay hover:text-t1"
            >
              <Play size={11} /> Start now
            </button>
          ) : null}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          {(column === "backlog" || column === "queued") && (
            <ContextMenu.Item className={menuItem} onSelect={() => void start()}>
              <Play size={13} /> Start now
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => void api.deleteTask(task.id).catch(() => {})}
          >
            <Trash2 size={13} /> Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
