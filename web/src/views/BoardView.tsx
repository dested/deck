import { useMemo, useRef, useState } from "react";
import {
  Kanban,
  Check,
  Copy,
  Trash2,
  Sparkles,
  Loader2,
  Star,
  Inbox,
  ListTodo,
  Trophy,
  X,
  ChevronDown,
  Image as ImageIcon,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { TaskCard, TaskStatus } from "@deck/shared";
import { useTasksStore } from "../stores/tasksStore";
import { useProjectsStore } from "../stores/projectsStore";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { relTime } from "../lib/format";
import { projectGradient } from "../lib/identity";
import { Tooltip } from "../components/ui/Tooltip";
import { menuContent, menuContentStyle, menuItem } from "../components/ui/menuStyles";
import { toast } from "../components/ui/Toast";
import { ProjectPicker } from "../components/board/ProjectPicker";
import {
  type PendingImage,
  imagesFromClipboard,
  imagesFromDrop,
  fileToPending,
  uploadPending,
  CardThumbs,
  EditorImageGrid,
  AddImageTile,
} from "../components/board/taskImages";

// M17v2 — a personal, manual kanban. Nothing on this board can start a session
// or an agent; the only automation is drafting a copy-paste prompt on demand.
// ADHD-first: zero-friction capture, one "Now", no dates, Done fades away.

const COLUMNS: {
  key: TaskStatus;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  { key: "inbox", label: "Inbox", icon: Inbox, hint: "Dump everything here. No dates, no guilt." },
  { key: "next", label: "Next", icon: ListTodo, hint: "The short list you actually intend to do." },
  { key: "now", label: "Now", icon: Star, hint: "The one thing. Just this." },
  { key: "done", label: "Done", icon: Trophy, hint: "Wins. They fade out after a week." },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Optimistic move: paint the store first, then persist; the ws broadcast
// reconciles either way.
function moveTask(task: TaskCard, status: TaskStatus, order: number) {
  useTasksStore.getState().upsert({
    ...task,
    status,
    order,
    doneAt: status === "done" ? task.doneAt ?? Date.now() : null,
  });
  void api.updateTask(task.id, { status, order }).catch(() => {});
}

// `projectId` set = the project tab's scoped board: only that project's cards,
// capture auto-assigns it, project chips/pickers are hidden.
export function BoardView({ projectId }: { projectId?: string }) {
  const tasks = useTasksStore((s) => s.byId);
  const [dragId, setDragId] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<TaskStatus, TaskCard[]> = { inbox: [], next: [], now: [], done: [] };
    for (const t of Object.values(tasks)) {
      if (projectId && t.projectId !== projectId) continue;
      (map[t.status] ?? map.inbox).push(t);
    }
    for (const k of Object.keys(map) as TaskStatus[])
      map[k].sort((a, b) =>
        k === "done" ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.order - b.order,
      );
    return map;
  }, [tasks, projectId]);

  const dragTask = dragId ? tasks[dragId] : undefined;

  // Drop on empty column space = append to that column.
  const dropOnColumn = (col: TaskStatus) => {
    if (!dragTask) return;
    setDragId(null);
    if (dragTask.status === col) return;
    const maxOrder = byColumn[col].reduce((m, t) => Math.max(m, t.order), 0);
    moveTask(dragTask, col, maxOrder + 1);
  };

  // Drop on a card = insert before it (fractional orders keep it cheap).
  const dropBeforeCard = (col: TaskStatus, target: TaskCard) => {
    if (!dragTask || dragTask.id === target.id) return;
    setDragId(null);
    if (col === "done") return dropOnColumn(col); // done is doneAt-sorted
    const cards = byColumn[col].filter((t) => t.id !== dragTask.id);
    const idx = cards.findIndex((t) => t.id === target.id);
    const prev = cards[idx - 1];
    const order = prev ? (prev.order + target.order) / 2 : target.order - 1;
    moveTask(dragTask, col, order);
  };

  return (
    <div className="flex h-full flex-col">
      {!projectId && (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
          <Kanban size={16} className="text-t2" />
          <span className="text-[14px] font-semibold text-t1">Tasks</span>
          <span className="text-[11.5px] text-t3">
            just a board — nothing here runs anything
          </span>
        </div>
      )}

      <TaskComposer scopedProjectId={projectId} />

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 pt-0">
        {COLUMNS.map((c) => (
          <BoardColumn
            key={c.key}
            col={c}
            cards={byColumn[c.key]}
            scopedProjectId={projectId}
            dragging={dragId != null}
            onDragCard={setDragId}
            onDragEnd={() => setDragId(null)}
            onDropColumn={() => dropOnColumn(c.key)}
            onDropBeforeCard={(t) => dropBeforeCard(c.key, t)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer: one bar, two gears. Enter = quick capture (project already chosen
// via the inline picker, which stays sticky between adds). Expand for notes,
// a target column, and image attachments — the ticket is born complete
// instead of assigned-after.
// ---------------------------------------------------------------------------

const TARGETS: { key: Exclude<TaskStatus, "done">; label: string; icon: LucideIcon }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "next", label: "Next", icon: ListTodo },
  { key: "now", label: "Now", icon: Star },
];

function TaskComposer({ scopedProjectId }: { scopedProjectId?: string }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState<Exclude<TaskStatus, "done">>("inbox");
  const [project, setProject] = useState<string | null>(null); // sticky between adds
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const attach = async (files: File[]) => {
    if (!files.length) return;
    const imgs = await Promise.all(files.map(fileToPending));
    setPending((p) => [...p, ...imgs]);
    setExpanded(true);
  };

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const card = await api.createTask({
        title: t,
        body: notes.trim() || undefined,
        projectId: scopedProjectId ?? project,
        status: target,
      });
      if (pending.length)
        await uploadPending(card.id, pending).catch(() =>
          toast("Task added, but some images failed to upload", "error"),
        );
      setTitle("");
      setNotes("");
      setPending([]);
      setTarget("inbox");
      setExpanded(false);
      titleRef.current?.focus();
    } catch {
      toast("Failed to add task", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 p-3">
      <div
        onPaste={(e) => {
          const files = imagesFromClipboard(e);
          if (files.length) {
            e.preventDefault();
            void attach(files);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = imagesFromDrop(e);
          if (files.length) {
            e.preventDefault();
            void attach(files);
          }
        }}
        onKeyDown={(e) => {
          // defaultPrevented = Radix already used this Escape to close a popover
          if (e.key === "Escape" && !e.defaultPrevented && expanded) setExpanded(false);
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
        }}
        className="rounded-[10px] border border-hair bg-panel transition-colors focus-within:border-hairfocus"
      >
        <div className="flex items-center gap-2 px-2">
          {!scopedProjectId && <ProjectPicker value={project} onChange={setProject} />}
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) void submit();
            }}
            placeholder={
              expanded
                ? "Task title…"
                : "Dump a task — Enter to add, paste a screenshot, expand for details…"
            }
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-t1 placeholder:text-t3 focus:outline-none"
          />
          {!expanded && pending.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-t3">
              <ImageIcon size={12} /> {pending.length}
            </span>
          )}
          {busy && <Loader2 size={14} className="shrink-0 animate-spin text-t3" />}
          <Tooltip label={expanded ? "Collapse" : "Notes, images, target column"}>
            <button
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-t3 transition-colors hover:bg-raised hover:text-t1",
                expanded && "bg-raised text-t1",
              )}
              aria-label={expanded ? "Collapse composer" : "Expand composer"}
            >
              <ChevronDown
                size={14}
                className={cn("transition-transform", expanded && "rotate-180")}
              />
            </button>
          </Tooltip>
        </div>

        {expanded && (
          <div className="flex flex-col gap-2 border-t border-hair p-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes / description — paste images anywhere…"
              rows={3}
              className="w-full resize-none rounded-[6px] border border-hair bg-raised p-2 text-[12.5px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
            />

            <div className="flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <div
                  key={p.key}
                  className="group/img relative h-16 w-24 overflow-hidden rounded-[6px] border border-hair"
                >
                  <img src={p.dataUrl} alt={p.name} className="h-full w-full object-cover" />
                  <button
                    onClick={() => setPending((v) => v.filter((x) => x.key !== p.key))}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-[4px] bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover/img:opacity-100"
                    aria-label={`Remove ${p.name}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <AddImageTile onFiles={(f) => void attach(f)} className="h-16 w-24" />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-[6px] border border-hair">
                {TARGETS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTarget(t.key)}
                    className={cn(
                      "flex h-7 items-center gap-1 px-2 text-[11.5px] transition-colors",
                      target === t.key
                        ? "bg-raised font-medium text-t1"
                        : "text-t3 hover:bg-raised/60 hover:text-t2",
                    )}
                  >
                    <t.icon size={11} /> {t.label}
                  </button>
                ))}
              </div>
              <span className="ml-auto flex items-center gap-1 text-[10.5px] text-t3">
                <CornerDownLeft size={10} /> Enter adds
              </span>
              <button
                onClick={() => void submit()}
                disabled={!title.trim() || busy}
                className="h-7 rounded-[6px] bg-accent px-3 text-[12px] font-medium text-white transition-opacity disabled:opacity-40"
              >
                Add task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumn({
  col,
  cards,
  scopedProjectId,
  dragging,
  onDragCard,
  onDragEnd,
  onDropColumn,
  onDropBeforeCard,
}: {
  col: (typeof COLUMNS)[number];
  cards: TaskCard[];
  scopedProjectId?: string;
  dragging: boolean;
  onDragCard: (id: string) => void;
  onDragEnd: () => void;
  onDropColumn: () => void;
  onDropBeforeCard: (target: TaskCard) => void;
}) {
  const isNow = col.key === "now";
  const isDone = col.key === "done";
  const overloaded = isNow && cards.length > 1; // soft limit — nag, don't block
  const Icon = col.icon;

  const clearDone = async () => {
    if (!confirm(`Delete all ${cards.length} done cards?`)) return;
    const { cleared } = await api.clearDoneTasks().catch(() => ({ cleared: 0 }));
    if (cleared) toast(`Cleared ${cleared} done ${cleared === 1 ? "task" : "tasks"}`, "info");
  };

  return (
    <div
      onDragOver={(e) => dragging && e.preventDefault()}
      onDrop={onDropColumn}
      className={cn(
        "flex w-[300px] shrink-0 flex-col rounded-[10px] border bg-panel",
        isNow ? "border-[color:var(--accent)]/40" : "border-hair",
        dragging && "border-hairfocus",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-hair px-3 py-2",
          isNow && "bg-[color:var(--accent)]/5",
        )}
      >
        <Icon size={13} className={cn(overloaded ? "text-warn" : isNow ? "text-accenttext" : "text-t3")} />
        <span
          className={cn(
            "text-[12px] font-semibold uppercase tracking-[0.05em]",
            overloaded ? "text-warn" : isNow ? "text-accenttext" : "text-t2",
          )}
        >
          {col.label}
        </span>
        <span className="mono text-[11px] text-t3">{cards.length}</span>
        {overloaded && (
          <span className="text-[10.5px] text-warn">one thing at a time</span>
        )}
        {isDone && cards.length > 0 && (
          <button
            onClick={() => void clearDone()}
            className="ml-auto rounded-[5px] px-1.5 py-0.5 text-[10.5px] text-t3 hover:bg-raised hover:text-t1"
          >
            Clear
          </button>
        )}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
        style={{ scrollbarGutter: "stable" }}
      >
        {cards.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] leading-relaxed text-t3">
            {col.hint}
          </div>
        )}
        {cards.map((t) => (
          <BoardCard
            key={t.id}
            task={t}
            column={col.key}
            scopedProject={!!scopedProjectId}
            onDragStart={() => onDragCard(t.id)}
            onDragEnd={onDragEnd}
            onDropBefore={() => onDropBeforeCard(t)}
          />
        ))}
      </div>
    </div>
  );
}

function BoardCard({
  task,
  column,
  scopedProject,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  task: TaskCard;
  column: TaskStatus;
  scopedProject: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const projectName = useProjectsStore((s) =>
    task.projectId ? s.byId[task.projectId]?.name ?? task.projectId : null,
  );
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const isDone = column === "done";
  const faded = isDone && (task.doneAt ?? 0) < Date.now() - WEEK_MS;

  const generate = async () => {
    if (!task.projectId) {
      toast("Assign a project first — the prompt is written from its cliffnotes", "error");
      return;
    }
    setGenerating(true);
    try {
      await api.generateTaskPrompt(task.id);
      toast("Prompt drafted", "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Prompt generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const copyPrompt = () => {
    if (!task.prompt) return;
    void navigator.clipboard?.writeText(task.prompt);
    toast("Prompt copied — paste it into a Claude session", "info");
  };

  const moveTo = (status: TaskStatus) => {
    const all = Object.values(useTasksStore.getState().byId);
    const maxOrder = all
      .filter((t) => t.status === status)
      .reduce((m, t) => Math.max(m, t.order), 0);
    moveTask(task, status, maxOrder + 1);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          draggable={!open}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.stopPropagation();
            onDropBefore();
          }}
          onClick={() => !open && setOpen(true)}
          className={cn(
            "rounded-[8px] border border-hair bg-raised p-2.5 transition-opacity",
            !open && "cursor-default hover:border-hairfocus",
            faded && "opacity-45",
          )}
        >
          {open ? (
            <CardEditor
              task={task}
              scopedProject={scopedProject}
              generating={generating}
              onGenerate={generate}
              onCopy={copyPrompt}
              onClose={() => setOpen(false)}
            />
          ) : (
            <>
              <div className="flex items-start gap-1.5">
                {isDone ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      column === "now" ? "bg-[color:var(--accent)]" : "bg-t3/40",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[12.5px] font-medium text-t1",
                    isDone && "text-t2 line-through decoration-t3/50",
                  )}
                >
                  {task.title}
                </span>
              </div>
              {task.body.trim() && (
                <p className="mt-1 line-clamp-2 whitespace-pre-line pl-[14px] text-[11px] text-t2">
                  {task.body}
                </p>
              )}
              <CardThumbs task={task} />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[14px]">
                {!scopedProject &&
                  (projectName ? (
                    <span className="flex items-center gap-1.5 rounded-[4px] bg-panel px-1.5 py-0.5 text-[10px] text-t3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: projectGradient(projectName) }}
                      />
                      {projectName}
                    </span>
                  ) : (
                    <span className="rounded-[4px] border border-dashed border-hair px-1.5 py-0.5 text-[10px] text-t3">
                      no project
                    </span>
                  ))}
                {task.prompt && !isDone && (
                  <Tooltip label="Copy the drafted prompt">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrompt();
                      }}
                      className="flex items-center gap-1 rounded-[4px] bg-panel px-1.5 py-0.5 text-[10px] text-accenttext hover:bg-overlay"
                    >
                      <Copy size={9} /> prompt
                    </button>
                  </Tooltip>
                )}
                {generating && (
                  <Loader2 size={11} className="animate-spin text-t3" />
                )}
              </div>
            </>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          {COLUMNS.filter((c) => c.key !== column).map((c) => (
            <ContextMenu.Item
              key={c.key}
              className={menuItem}
              onSelect={() => moveTo(c.key)}
            >
              <c.icon size={13} /> Move to {c.label}
            </ContextMenu.Item>
          ))}
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

// Inline expanded editor. Fields save on blur; the prompt is editable too (it's
// yours once generated). Images paste/drop/upload straight onto the card.
function CardEditor({
  task,
  scopedProject,
  generating,
  onGenerate,
  onCopy,
  onClose,
}: {
  task: TaskCard;
  scopedProject: boolean;
  generating: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [prompt, setPrompt] = useState(task.prompt ?? "");
  const promptDirty = useRef(false);

  // The generate call updates the card server-side; mirror it in when we're
  // not mid-edit ourselves.
  if (!promptDirty.current && (task.prompt ?? "") !== prompt) {
    setPrompt(task.prompt ?? "");
  }

  const save = (patch: Parameters<typeof api.updateTask>[1]) =>
    void api.updateTask(task.id, patch).catch(() => {});

  const uploadFiles = async (files: File[]) => {
    try {
      for (const f of files) {
        const p = await fileToPending(f);
        await api.addTaskImage(task.id, {
          data: p.dataUrl,
          name: p.name,
          w: p.w,
          h: p.h,
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Image upload failed", "error");
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPaste={(e) => {
        const files = imagesFromClipboard(e);
        if (files.length) {
          e.preventDefault();
          void uploadFiles(files);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        const files = imagesFromDrop(e);
        if (files.length) {
          e.preventDefault();
          e.stopPropagation();
          void uploadFiles(files);
        }
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-7 min-w-0 flex-1 rounded-[5px] border border-hair bg-panel px-2 text-[12.5px] font-medium text-t1 focus:border-hairfocus focus:outline-none"
        />
        <button
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-t3 hover:bg-panel hover:text-t1"
          aria-label="Collapse"
        >
          <X size={13} />
        </button>
      </div>
      {!scopedProject && (
        <div className="mb-1.5">
          <ProjectPicker
            block
            value={task.projectId}
            onChange={(id) => save({ projectId: id })}
          />
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => body !== task.body && save({ body })}
        placeholder="Notes / description — paste images anywhere…"
        rows={3}
        className="mb-1.5 w-full resize-none rounded-[5px] border border-hair bg-panel p-2 text-[12px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
      />

      <EditorImageGrid task={task} onAddFiles={(f) => void uploadFiles(f)} />

      {task.prompt != null && (
        <textarea
          value={prompt}
          onChange={(e) => {
            promptDirty.current = true;
            setPrompt(e.target.value);
          }}
          onBlur={() => {
            promptDirty.current = false;
            if (prompt !== (task.prompt ?? "")) save({ prompt: prompt || null });
          }}
          rows={6}
          className="mono mb-1.5 w-full resize-y rounded-[5px] border border-hair bg-panel p-2 text-[11.5px] leading-relaxed text-t1 focus:border-hairfocus focus:outline-none"
        />
      )}

      <div className="flex items-center gap-1.5">
        <Tooltip
          label={
            task.projectId
              ? "Draft a Claude Code prompt from this card + the project's cliffnotes"
              : "Assign a project first"
          }
        >
          <button
            onClick={onGenerate}
            disabled={generating || !task.projectId}
            className="flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-panel px-2 text-[11.5px] text-t2 hover:bg-overlay hover:text-t1 disabled:opacity-40"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {task.prompt ? "Redraft prompt" : "Draft prompt"}
          </button>
        </Tooltip>
        {task.prompt && (
          <button
            onClick={onCopy}
            className="flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-panel px-2 text-[11.5px] text-accenttext hover:bg-overlay"
          >
            <Copy size={12} /> Copy
          </button>
        )}
        <span className="ml-auto text-[10px] text-t3">added {relTime(task.createdAt)}</span>
        <button
          onClick={() => void api.deleteTask(task.id).catch(() => {})}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-panel hover:text-err"
          aria-label="Delete task"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
