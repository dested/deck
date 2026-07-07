import { useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Star,
  Inbox,
  ListTodo,
  Trophy,
  X,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  CornerDownLeft,
  Copy,
  Trash2,
  Zap,
  Heart,
  CircleSlash,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { TaskCard, TaskStatus } from "@deck/shared";
import { useTasksStore } from "../stores/tasksStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useUIStore } from "../stores/uiStore";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { projectGradient, projectInitials } from "../lib/identity";
import {
  LIFE_PROJECT_ID,
  LIFE_NAME,
  isLife,
  focusBuckets,
  moveTask,
  moveToStatus,
} from "../lib/tasks";
import { Tooltip } from "../components/ui/Tooltip";
import { menuContent, menuContentStyle, menuItem } from "../components/ui/menuStyles";
import { toast } from "../components/ui/Toast";
import { ProjectPicker } from "../components/board/ProjectPicker";
import { TaskPanel } from "../components/board/TaskPanel";
import { TriageMode } from "../components/board/TriageMode";
import {
  type PendingImage,
  imagesFromClipboard,
  imagesFromDrop,
  fileToPending,
  uploadPending,
  CardThumbs,
  AddImageTile,
} from "../components/board/taskImages";

// M17v3 — the Focus Stack. Kanban columns are gone: your reality is a big pile
// plus one thing, so the view is vertical — NOW hero (impossible to miss), a
// short ON DECK queue, THE PILE grouped by project (collapsed counts, not card
// walls), and a quiet wins strip. Triage mode deals the pile one card at a
// time. Still a pure personal board: nothing here can start a session.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// `projectId` set = the project tab's scoped stack: only that project's cards,
// capture auto-assigns it, the pile is flat (no groups), pickers hidden.
export function BoardView({ projectId }: { projectId?: string }) {
  const tasks = useTasksStore((s) => s.byId);
  const panelId = useUIStore((s) => s.taskPanelId);
  const setTaskPanel = useUIStore((s) => s.setTaskPanel);
  const [triage, setTriage] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const b = useMemo(() => focusBuckets(tasks, projectId), [tasks, projectId]);
  const panelTask = panelId ? tasks[panelId] : undefined;
  const dragTask = dragId ? tasks[dragId] : undefined;

  // Section-level drop = move to that status (append). Rows handle their own
  // insert-before via onDropBefore.
  const sectionDrop = (status: TaskStatus) => {
    if (!dragTask) return;
    setDragId(null);
    moveToStatus(dragTask, status);
  };
  const dropBefore = (target: TaskCard) => {
    if (!dragTask || dragTask.id === target.id) return;
    setDragId(null);
    const bucket = b[target.status].filter((t) => t.id !== dragTask.id);
    const i = bucket.findIndex((t) => t.id === target.id);
    const prev = bucket[i - 1];
    const order = prev ? (prev.order + target.order) / 2 : target.order - 1;
    moveTask(dragTask, target.status, order);
  };
  // Dropping a card on a pile group header files it under that project (and
  // back into the pile — the group IS an inbox bucket).
  const dropOnGroup = (pid: string | null) => {
    if (!dragTask) return;
    setDragId(null);
    useTasksStore.getState().upsert({ ...dragTask, projectId: pid, status: "inbox", doneAt: null });
    void api.updateTask(dragTask.id, { projectId: pid, status: "inbox" }).catch(() => {});
  };
  const dnd = {
    dragging: dragId != null,
    onDragCard: setDragId,
    onDragEnd: () => setDragId(null),
    dropBefore,
    dropOnGroup,
  };

  return (
    <div className="relative flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div className="mx-auto w-full max-w-[900px] px-5 pb-20">
          <TaskComposer scopedProjectId={projectId} />
          <NowSection tasks={b.now} next={b.next} dnd={dnd} onDrop={() => sectionDrop("now")} />
          <OnDeckSection tasks={b.next} dnd={dnd} onDrop={() => sectionDrop("next")} />
          <PileSection
            tasks={b.inbox}
            grouped={!projectId}
            dnd={dnd}
            onDrop={() => sectionDrop("inbox")}
            onTriage={() => setTriage(true)}
          />
          <WinsSection tasks={b.done} onDrop={() => sectionDrop("done")} dnd={dnd} />
        </div>
      </div>

      {panelTask && (
        <TaskPanel
          task={panelTask}
          scopedProject={!!projectId}
          onClose={() => setTaskPanel(null)}
        />
      )}
      {triage && <TriageMode projectId={projectId} onClose={() => setTriage(false)} />}
    </div>
  );
}

interface Dnd {
  dragging: boolean;
  onDragCard: (id: string) => void;
  onDragEnd: () => void;
  dropBefore: (target: TaskCard) => void;
  dropOnGroup: (projectId: string | null) => void;
}

// Shared drag/drop-before props for any task row.
function rowDnd(task: TaskCard, dnd: Dnd) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      dnd.onDragCard(task.id);
    },
    onDragEnd: dnd.onDragEnd,
    onDragOver: (e: React.DragEvent) => {
      if (dnd.dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      dnd.dropBefore(task);
    },
  };
}

function SectionHeader({
  icon: Icon,
  label,
  accent,
  warn,
  children,
}: {
  icon: LucideIcon;
  label: string;
  accent?: boolean;
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon
        size={13}
        className={warn ? "text-warn" : accent ? "text-accenttext" : "text-t3"}
      />
      <span
        className={cn(
          "text-[12px] font-semibold uppercase tracking-[0.06em]",
          warn ? "text-warn" : accent ? "text-accenttext" : "text-t2",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// Tiny project identity chip (Life gets a heart, unassigned a dashed slash).
function ProjectChip({ projectId }: { projectId: string | null }) {
  const name = useProjectsStore((s) =>
    projectId && !isLife(projectId) ? s.byId[projectId]?.name ?? projectId : null,
  );
  if (isLife(projectId))
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-raised px-1.5 py-0.5 text-[10px] text-t3">
        <span
          className="flex h-2.5 w-2.5 items-center justify-center rounded-[3px] text-white/85"
          style={{ background: projectGradient(LIFE_NAME) }}
        >
          <Heart size={6} fill="currentColor" />
        </span>
        {LIFE_NAME}
      </span>
    );
  if (!name)
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-[4px] border border-dashed border-hair px-1.5 py-0.5 text-[10px] text-t3">
        <CircleSlash size={8} /> no project
      </span>
    );
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-[4px] bg-raised px-1.5 py-0.5 text-[10px] text-t3">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ background: projectGradient(name) }}
      />
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NOW — the hero. One big card you cannot miss. Empty = a pull-from-deck
// invitation, never a guilt trip.
// ---------------------------------------------------------------------------

function NowSection({
  tasks,
  next,
  dnd,
  onDrop,
}: {
  tasks: TaskCard[];
  next: TaskCard[];
  dnd: Dnd;
  onDrop: () => void;
}) {
  const setTaskPanel = useUIStore((s) => s.setTaskPanel);
  const overloaded = tasks.length > 1;

  return (
    <section
      className="mb-6"
      onDragOver={(e) => dnd.dragging && e.preventDefault()}
      onDrop={onDrop}
    >
      <SectionHeader icon={Star} label="Now" accent warn={overloaded}>
        {overloaded && <span className="text-[10.5px] text-warn">one thing at a time</span>}
      </SectionHeader>

      {tasks.length === 0 ? (
        <div className="flex min-h-[86px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-hair px-4 py-5 text-center">
          <p className="text-[12px] text-t3">Nothing in Now.</p>
          {next[0] ? (
            <button
              onClick={() => moveToStatus(next[0]!, "now")}
              className="flex max-w-full items-center gap-1.5 rounded-[7px] border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-1.5 text-[12px] font-medium text-accenttext hover:bg-[color:var(--accent)]/20"
            >
              <Star size={12} className="shrink-0" />
              <span className="truncate">Start: {next[0]!.title}</span>
            </button>
          ) : (
            <p className="text-[11px] text-t3/70">Queue something on deck, then pull it here.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <NowHero key={t.id} task={t} onOpen={() => setTaskPanel(t.id)} dnd={dnd} />
          ))}
        </div>
      )}
    </section>
  );
}

function NowHero({ task, onOpen, dnd }: { task: TaskCard; onOpen: () => void; dnd: Dnd }) {
  const copyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.prompt) return;
    void navigator.clipboard?.writeText(task.prompt);
    toast("Prompt copied — paste it into a Claude session", "info");
  };

  return (
    <div
      {...rowDnd(task, dnd)}
      onClick={onOpen}
      className="cursor-pointer rounded-[12px] border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/5 p-4 transition-colors hover:border-[color:var(--accent)]/60"
    >
      <div className="flex items-start gap-3">
        <Star size={16} className="mt-0.5 shrink-0 text-accenttext" fill="currentColor" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15.5px] font-semibold leading-snug text-t1">{task.title}</h2>
          {task.body.trim() && (
            <p className="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-relaxed text-t2">
              {task.body}
            </p>
          )}
          <CardThumbs task={task} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ProjectChip projectId={task.projectId} />
            {task.prompt && (
              <button
                onClick={copyPrompt}
                className="flex items-center gap-1 rounded-[4px] bg-raised px-1.5 py-0.5 text-[10px] text-accenttext hover:bg-overlay"
              >
                <Copy size={9} /> prompt
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveToStatus(task, "done");
              toast("Win banked 🏆", "info");
            }}
            className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[color:var(--ok)]/40 bg-[color:var(--ok)]/10 px-3 text-[12px] font-medium text-ok hover:bg-[color:var(--ok)]/20"
          >
            <Check size={13} /> Done
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveToStatus(task, "next");
            }}
            className="flex h-7 items-center gap-1 rounded-[7px] px-3 text-[11px] text-t3 hover:bg-raised hover:text-t1"
          >
            Later <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ON DECK — the short curated queue. Compact rows, promote with one click.
// ---------------------------------------------------------------------------

function OnDeckSection({
  tasks,
  dnd,
  onDrop,
}: {
  tasks: TaskCard[];
  dnd: Dnd;
  onDrop: () => void;
}) {
  return (
    <section
      className="mb-6"
      onDragOver={(e) => dnd.dragging && e.preventDefault()}
      onDrop={onDrop}
    >
      <SectionHeader icon={ListTodo} label="On deck">
        <span className="mono text-[11px] text-t3">{tasks.length}</span>
      </SectionHeader>
      {tasks.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-hair px-4 py-3 text-[11.5px] text-t3">
          The short list you actually intend to do — promote from the pile below.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} dnd={dnd} showProject actions="deck" />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE PILE — the inbox, grouped by project so 24 cards read as 4 headers.
// Triage deals it one card at a time.
// ---------------------------------------------------------------------------

const NONE_KEY = "__none__";

function PileSection({
  tasks,
  grouped,
  dnd,
  onDrop,
  onTriage,
}: {
  tasks: TaskCard[];
  grouped: boolean;
  dnd: Dnd;
  onDrop: () => void;
  onTriage: () => void;
}) {
  const projects = useProjectsStore((s) => s.byId);
  const collapsed = useUIStore((s) => s.taskGroupsCollapsed);
  const toggleGroup = useUIStore((s) => s.toggleTaskGroup);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const map = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      const key = t.projectId ?? NONE_KEY;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    // Biggest pile first; unassigned last (it's the least decided).
    return [...map.entries()].sort((a, b) => {
      if (a[0] === NONE_KEY) return 1;
      if (b[0] === NONE_KEY) return -1;
      return b[1].length - a[1].length;
    });
  }, [tasks, grouped]);

  return (
    <section
      className="mb-6"
      onDragOver={(e) => dnd.dragging && e.preventDefault()}
      onDrop={onDrop}
    >
      <SectionHeader icon={Inbox} label="The pile">
        <span className="mono text-[11px] text-t3">{tasks.length}</span>
        {tasks.length > 0 && (
          <button
            onClick={onTriage}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-[7px] border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-2.5 text-[11.5px] font-medium text-accenttext transition-colors hover:bg-[color:var(--accent)]/20"
          >
            <Zap size={12} /> Triage {tasks.length}
          </button>
        )}
      </SectionHeader>

      {tasks.length === 0 && (
        <p className="rounded-[10px] border border-dashed border-hair px-4 py-3 text-[11.5px] text-t3">
          Pile's empty. Dump everything here — no dates, no guilt.
        </p>
      )}

      {!grouped ? (
        <div className="flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} dnd={dnd} actions="pile" />
          ))}
        </div>
      ) : (
        groups!.map(([key, list]) => {
          const isNone = key === NONE_KEY;
          const life = key === LIFE_PROJECT_ID;
          const name = life ? LIFE_NAME : isNone ? "Unassigned" : projects[key]?.name ?? key;
          const isCollapsed = !!collapsed[key];
          return (
            <div key={key} className="mb-1.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleGroup(key)}
                // Dropping a card on a group header files it under that project.
                onDragOver={(e) => {
                  if (dnd.dragging) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  dnd.dropOnGroup(isNone ? null : key);
                }}
                className="group flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-1.5 py-1.5 transition-colors hover:bg-raised/60"
              >
                {isCollapsed ? (
                  <ChevronRight size={12} className="shrink-0 text-t3" />
                ) : (
                  <ChevronDown size={12} className="shrink-0 text-t3" />
                )}
                {isNone ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-dashed border-hair text-t3">
                    <CircleSlash size={9} />
                  </span>
                ) : (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[8px] font-bold text-white/85"
                    style={{ background: projectGradient(name) }}
                  >
                    {life ? <Heart size={9} fill="currentColor" /> : projectInitials(name)}
                  </span>
                )}
                <span className="text-[12.5px] font-medium text-t1">{name}</span>
                <span className="mono text-[11px] text-t3">{list.length}</span>
              </div>
              {!isCollapsed && (
                <div className="ml-[26px] flex flex-col gap-0.5 border-l border-hair pl-2">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} dnd={dnd} actions="pile" />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// WINS — done, quiet, fades away. Never a column, never a guilt pile.
// ---------------------------------------------------------------------------

function WinsSection({
  tasks,
  dnd,
  onDrop,
}: {
  tasks: TaskCard[];
  dnd: Dnd;
  onDrop: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (tasks.length === 0) return null;
  const shown = showAll ? tasks : tasks.slice(0, 5);

  const clearDone = async () => {
    if (!confirm(`Delete all ${tasks.length} done cards?`)) return;
    const { cleared } = await api.clearDoneTasks().catch(() => ({ cleared: 0 }));
    if (cleared) toast(`Cleared ${cleared} done ${cleared === 1 ? "task" : "tasks"}`, "info");
  };

  return (
    <section onDragOver={(e) => dnd.dragging && e.preventDefault()} onDrop={onDrop}>
      <SectionHeader icon={Trophy} label="Wins">
        <span className="mono text-[11px] text-t3">{tasks.length}</span>
        <span className="text-[10.5px] text-t3/70">they fade after a week</span>
        <button
          onClick={() => void clearDone()}
          className="ml-auto rounded-[5px] px-1.5 py-0.5 text-[10.5px] text-t3 hover:bg-raised hover:text-t1"
        >
          Clear
        </button>
      </SectionHeader>
      <div className="flex flex-col gap-0.5">
        {shown.map((t) => (
          <TaskRow key={t.id} task={t} dnd={dnd} showProject actions="done" />
        ))}
      </div>
      {tasks.length > 5 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 px-1.5 text-[11px] text-t3 hover:text-t1"
        >
          {showAll ? "Show fewer" : `+${tasks.length - 5} more`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A single compact task row — one line, hover actions, click opens the panel.
// ---------------------------------------------------------------------------

function TaskRow({
  task,
  dnd,
  showProject,
  actions,
}: {
  task: TaskCard;
  dnd: Dnd;
  showProject?: boolean;
  actions: "deck" | "pile" | "done";
}) {
  const setTaskPanel = useUIStore((s) => s.setTaskPanel);
  const isDone = actions === "done";
  const faded = isDone && (task.doneAt ?? 0) < Date.now() - WEEK_MS;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          {...rowDnd(task, dnd)}
          onClick={() => setTaskPanel(task.id)}
          className={cn(
            "group flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-raised/70",
            faded && "opacity-45",
          )}
        >
          {isDone ? (
            <Check size={12} className="shrink-0 text-ok" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-t3/50" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12.5px] text-t1",
              actions === "deck" && "font-medium",
              isDone && "text-t2 line-through decoration-t3/50",
            )}
          >
            {task.title}
          </span>
          {(task.images?.length ?? 0) > 0 && (
            <ImageIcon size={11} className="shrink-0 text-t3" />
          )}
          {task.body.trim() && (
            <span className="hidden max-w-[220px] truncate text-[11px] text-t3 lg:inline">
              {task.body.split("\n")[0]}
            </span>
          )}
          {showProject && <ProjectChip projectId={task.projectId} />}

          {/* Hover actions */}
          {!isDone && (
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {actions === "pile" && (
                <Tooltip label="Queue it (On deck)">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveToStatus(task, "next");
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-overlay hover:text-t1"
                    aria-label="Move to On deck"
                  >
                    <ListTodo size={12} />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Make it the Now">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveToStatus(task, "now");
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-overlay hover:text-accenttext"
                  aria-label="Move to Now"
                >
                  <Star size={12} />
                </button>
              </Tooltip>
              <Tooltip label="Done">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveToStatus(task, "done");
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-overlay hover:text-ok"
                  aria-label="Mark done"
                >
                  <Check size={12} />
                </button>
              </Tooltip>
            </span>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          {(
            [
              { key: "inbox", label: "the pile", icon: Inbox },
              { key: "next", label: "On deck", icon: ListTodo },
              { key: "now", label: "Now", icon: Star },
              { key: "done", label: "Done", icon: Trophy },
            ] as { key: TaskStatus; label: string; icon: LucideIcon }[]
          )
            .filter((c) => c.key !== task.status)
            .map((c) => (
              <ContextMenu.Item
                key={c.key}
                className={menuItem}
                onSelect={() => moveToStatus(task, c.key)}
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

// ---------------------------------------------------------------------------
// Composer: one bar, two gears. Enter = quick capture; the edit panel opens on
// the fresh card but focus STAYS here so dumping continues. Expand for notes,
// a target section, and image attachments.
// ---------------------------------------------------------------------------

const TARGETS: { key: Exclude<TaskStatus, "done">; label: string; icon: LucideIcon }[] = [
  { key: "inbox", label: "Pile", icon: Inbox },
  { key: "next", label: "On deck", icon: ListTodo },
  { key: "now", label: "Now", icon: Star },
];

function TaskComposer({ scopedProjectId }: { scopedProjectId?: string }) {
  const setTaskPanel = useUIStore((s) => s.setTaskPanel);
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
      // Auto-open the edit panel on the fresh card; focus stays here so the
      // next Enter keeps dumping (each add just swaps the panel).
      setTaskPanel(card.id);
      if (pending.length)
        await uploadPending(card.id, pending).catch(() =>
          toast("Task added, but some images failed to upload", "error"),
        );
      setTitle("");
      setNotes("");
      setPending([]);
      setExpanded(false);
      titleRef.current?.focus();
    } catch {
      toast("Failed to add task", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-10 -mx-1 bg-root px-1 pb-3 pt-4">
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
          <Tooltip label={expanded ? "Collapse" : "Notes, images, target section"}>
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
