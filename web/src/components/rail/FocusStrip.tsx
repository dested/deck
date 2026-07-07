import { useMemo } from "react";
import { Star, ListTodo, Zap, Heart } from "lucide-react";
import type { TaskCard } from "@deck/shared";
import { cn } from "../../lib/cn";
import { projectGradient, projectInitials } from "../../lib/identity";
import { LIFE_NAME, isLife, focusBuckets } from "../../lib/tasks";
import { useTasksStore } from "../../stores/tasksStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUIStore } from "../../stores/uiStore";

// The ambient Focus block at the top of the mission-control sidebar: the NOW
// task + the next few on deck, always visible. Click-through opens the board
// with that card's panel already open. Deliberately tiny — this is a compass,
// not a second board.

const NEXT_SHOWN = 3;

export function FocusStrip() {
  const tasks = useTasksStore((s) => s.byId);
  const setTopView = useUIStore((s) => s.setTopView);
  const setTaskPanel = useUIStore((s) => s.setTaskPanel);

  const b = useMemo(() => focusBuckets(tasks), [tasks]);
  if (b.now.length + b.next.length + b.inbox.length === 0) return null;

  const openTask = (t: TaskCard) => {
    setTaskPanel(t.id);
    setTopView("board");
  };

  return (
    <div className="mx-2 mt-2 rounded-[10px] border border-hair bg-panel">
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2">
        <Star size={11} className="text-accenttext" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-t2">
          Focus
        </span>
        {b.inbox.length > 0 && (
          <button
            onClick={() => setTopView("board")}
            className="ml-auto flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] text-t3 transition-colors hover:bg-raised hover:text-accenttext"
            title={`${b.inbox.length} in the pile — open the board to triage`}
          >
            <Zap size={10} /> {b.inbox.length} in pile
          </button>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
        {b.now.length === 0 ? (
          <button
            onClick={() => setTopView("board")}
            className="rounded-[7px] px-2 py-1.5 text-left text-[11.5px] text-t3 transition-colors hover:bg-raised/60 hover:text-t2"
          >
            Nothing in Now — pick the one thing.
          </button>
        ) : (
          b.now.map((t) => (
            <FocusRow key={t.id} task={t} now onOpen={() => openTask(t)} />
          ))
        )}
        {b.next.slice(0, NEXT_SHOWN).map((t) => (
          <FocusRow key={t.id} task={t} onOpen={() => openTask(t)} />
        ))}
        {b.next.length > NEXT_SHOWN && (
          <button
            onClick={() => setTopView("board")}
            className="px-2 py-0.5 text-left text-[10.5px] text-t3 hover:text-t1"
          >
            +{b.next.length - NEXT_SHOWN} more on deck
          </button>
        )}
      </div>
    </div>
  );
}

function FocusRow({
  task,
  now,
  onOpen,
}: {
  task: TaskCard;
  now?: boolean;
  onOpen: () => void;
}) {
  const projectName = useProjectsStore((s) =>
    task.projectId && !isLife(task.projectId)
      ? s.byId[task.projectId]?.name ?? null
      : null,
  );
  const life = isLife(task.projectId);
  const chipName = life ? LIFE_NAME : projectName;

  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors",
        now
          ? "bg-[color:var(--accent)]/10 hover:bg-[color:var(--accent)]/15"
          : "hover:bg-raised/60",
      )}
    >
      {now ? (
        <Star size={11} className="shrink-0 text-accenttext" fill="currentColor" />
      ) : (
        <ListTodo size={11} className="shrink-0 text-t3" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[12px] leading-4",
          now ? "font-medium text-t1" : "text-t2",
        )}
      >
        {task.title}
      </span>
      {chipName && (
        <span
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] text-[6.5px] font-bold text-white/85"
          style={{ background: projectGradient(chipName) }}
          title={chipName}
        >
          {life ? <Heart size={7} fill="currentColor" /> : projectInitials(chipName)}
        </span>
      )}
    </button>
  );
}
