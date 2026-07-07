import { useEffect, useMemo, useReducer } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  X,
  FolderOpen,
  Code2,
  GitBranch,
  Bot,
  SquareTerminal,
  Pencil,
  Globe,
  ListTodo,
  Star,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { ProjectSummary, Session, TaskCard } from "@deck/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";
import { displayTitle } from "../../lib/sessions";
import { projectGradient, projectInitials } from "../../lib/identity";
import { useProjectsStore } from "../../stores/projectsStore";
import { useSessionsStore } from "../../stores/sessionsStore";
import { useReviewsStore } from "../../stores/reviewsStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useUIStore } from "../../stores/uiStore";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuSeparator,
} from "../ui/menuStyles";

// The expanded rail body: every open project as a rich mission-control card —
// each agent with its status, AI title, YOUR ORIGINAL PROMPT (the "what did I
// even ask it" line), live summary, and waiting prompt; plus a reviews / dev
// server / tasks strip. All data is already live in the client stores; this
// only derives. Card order = openProjects order (yours, stable).

interface CardData {
  attention: Session[];
  working: Session[];
  finished: Session[]; // owned, idle, unread — "done, look at me"
  exited: Session[]; // owned, nonzero exit code
  idle: Session[];
  reviews: number;
  nowTask: TaskCard | null; // the project's one thing (lowest order wins)
  nextTasks: number;
  ports: number[];
}

export function ExpandedProjects({ railIds }: { railIds: string[] }) {
  const byId = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const reviews = useReviewsStore((s) => s.byId);
  const tasks = useTasksStore((s) => s.byId);
  const livePorts = useLibraryStore((s) => s.livePorts);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const topView = useUIStore((s) => s.topView);
  const openProject = useUIStore((s) => s.openProject);
  const closeRailProject = useUIStore((s) => s.closeRailProject);

  // Waiting-times must age even when no WS event arrives.
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, []);

  const data = useMemo(() => {
    const map = new Map<string, CardData>();
    const ensure = (pid: string): CardData => {
      let d = map.get(pid);
      if (!d) {
        d = {
          attention: [], working: [], finished: [], exited: [], idle: [],
          reviews: 0, nowTask: null, nextTasks: 0,
          ports: livePorts[pid] ?? [],
        };
        map.set(pid, d);
      }
      return d;
    };
    for (const pid of railIds) ensure(pid);
    const reviewedSessionIds = new Set<string>();
    for (const r of Object.values(reviews)) {
      if (r.dismissed) continue;
      reviewedSessionIds.add(r.sessionId);
      if (map.has(r.projectId)) ensure(r.projectId).reviews += 1;
    }
    for (const s of Object.values(sessions)) {
      if (!map.has(s.projectId) || s.status === "stale") continue;
      const d = ensure(s.projectId);
      if (s.status === "exited") {
        if (s.source === "owned" && s.exitCode != null && s.exitCode !== 0)
          d.exited.push(s);
      } else if (s.status === "attention") d.attention.push(s);
      else if (s.status === "working") d.working.push(s);
      else if (s.source === "owned" && s.unread && !reviewedSessionIds.has(s.id))
        d.finished.push(s);
      else d.idle.push(s);
    }
    for (const t of Object.values(tasks)) {
      if (!t.projectId || !map.has(t.projectId)) continue;
      const d = ensure(t.projectId);
      if (t.status === "now") {
        if (!d.nowTask || t.order < d.nowTask.order) d.nowTask = t;
      } else if (t.status === "next") d.nextTasks += 1;
    }
    for (const d of map.values()) {
      // Stable row order: attention by how long it's been waiting, the rest by
      // creation — never by raw activity, which reshuffles on every WS tick.
      d.attention.sort((a, z) => a.activityAt - z.activityAt);
      d.working.sort((a, z) => a.createdAt - z.createdAt);
      d.finished.sort((a, z) => a.createdAt - z.createdAt);
      d.idle.sort((a, z) => a.createdAt - z.createdAt);
    }
    return map;
  }, [railIds, sessions, reviews, tasks, livePorts]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ scrollbarGutter: "stable" }}>
      {railIds.length === 0 && (
        <div className="px-2 py-3 text-[12px] leading-5 text-t3">
          Nothing open yet — pick a project from the Library.
        </div>
      )}
      {railIds.map((id) => {
        const p = byId[id];
        if (!p) return null;
        return (
          <ProjectCard
            key={id}
            project={p}
            data={data.get(id)!}
            active={id === activeProjectId && topView === null}
            onOpen={(view) => openProject(id, view)}
            onClose={() => closeRailProject(id)}
            onCloseOthers={() => {
              for (const other of railIds) if (other !== id) closeRailProject(other);
              openProject(id);
            }}
          />
        );
      })}
    </div>
  );
}

function ProjectCard({
  project: p,
  data: d,
  active,
  onOpen,
  onClose,
  onCloseOthers,
}: {
  project: ProjectSummary;
  data: CardData;
  active: boolean;
  onOpen: (view?: "git" | "tasks" | "agents") => void;
  onClose: () => void;
  onCloseOthers: () => void;
}) {
  const hasAttention = d.attention.length > 0;
  const liveCount =
    d.attention.length + d.working.length + d.finished.length + d.exited.length;
  const quiet = liveCount === 0 && d.idle.length === 0;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={cn(
            "relative flex flex-col rounded-[10px] border bg-panel transition-colors",
            active && "bg-raised/40",
          )}
          style={{
            borderColor: hasAttention
              ? "color-mix(in srgb, var(--warn) 45%, transparent)"
              : "var(--color-hair)",
          }}
        >
          {active && (
            <span className="pointer-events-none absolute left-0 top-3 h-7 w-[3px] rounded-full bg-[color:var(--accent)]" />
          )}

          {/* Header */}
          <div className="group flex items-center gap-2.5 px-3 pb-1.5 pt-2.5">
            <button
              onClick={() => onOpen()}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span className="relative shrink-0">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[10px] font-bold text-white/85"
                  style={{ background: projectGradient(p.name) }}
                >
                  {projectInitials(p.name)}
                </span>
                {liveCount + d.idle.length > 0 && (
                  <span
                    className={cn(
                      "pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-panel",
                      hasAttention
                        ? "bg-[color:var(--warn)]"
                        : d.working.length > 0
                          ? "bg-[color:var(--ok)] deck-pulse"
                          : "bg-[color:var(--color-t3)]",
                    )}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[13.5px] font-semibold leading-5",
                    active ? "text-t1" : "text-t1/90",
                  )}
                >
                  {p.name}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] leading-4 text-t3">
                  {p.branch && (
                    <span className="flex min-w-0 items-center gap-1">
                      <GitBranch size={10} className="shrink-0" />
                      <span className="max-w-[140px] truncate">{p.branch}</span>
                    </span>
                  )}
                  {p.aheadBehind && p.aheadBehind.ahead > 0 && (
                    <span className="flex items-center"><ArrowUp size={10} />{p.aheadBehind.ahead}</span>
                  )}
                  {p.aheadBehind && p.aheadBehind.behind > 0 && (
                    <span className="flex items-center"><ArrowDown size={10} />{p.aheadBehind.behind}</span>
                  )}
                  {(p.dirtyCount ?? 0) > 0 && (
                    <span className="shrink-0 text-[color:var(--warn)]">{p.dirtyCount}±</span>
                  )}
                </span>
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="shrink-0 rounded p-1 text-t3 opacity-0 transition-opacity hover:bg-overlay hover:text-t1 group-hover:opacity-100"
              aria-label={`Close ${p.name}`}
            >
              <X size={13} />
            </button>
          </div>

          {/* Agent rows */}
          {!quiet && (
            <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
              {d.attention.map((s) => <AgentRow key={s.id} session={s} kind="attention" />)}
              {d.working.map((s) => <AgentRow key={s.id} session={s} kind="working" />)}
              {d.finished.map((s) => <AgentRow key={s.id} session={s} kind="finished" />)}
              {d.exited.map((s) => <AgentRow key={s.id} session={s} kind="exited" />)}
              {d.idle.slice(0, 3).map((s) => <AgentRow key={s.id} session={s} kind="idle" />)}
              {d.idle.length > 3 && (
                <button
                  onClick={() => onOpen("agents")}
                  className="px-2 py-0.5 text-left text-[11px] text-t3 hover:text-t1"
                >
                  +{d.idle.length - 3} more idle
                </button>
              )}
            </div>
          )}
          {quiet && (
            <div className="px-3 pb-2 text-[11px] leading-4 text-t3/70">
              No agents running.
            </div>
          )}

          {/* Footer strip: reviews / dev server / tasks — only when there's something */}
          {(d.reviews > 0 || d.ports.length > 0 || d.nowTask || d.nextTasks > 0) && (
            <div className="flex flex-wrap items-center gap-1 border-t border-hair px-2 py-1.5">
              {d.reviews > 0 && (
                <Chip
                  title={`${d.reviews} pending review${d.reviews === 1 ? "" : "s"} — open Git`}
                  onClick={() => onOpen("git")}
                >
                  <Pencil size={10} /> {d.reviews} review{d.reviews === 1 ? "" : "s"}
                </Chip>
              )}
              {d.ports.map((port) => (
                <Chip
                  key={port}
                  title={`Dev server on :${port} — open in browser`}
                  onClick={() => window.open(`http://localhost:${port}`, "_blank")}
                >
                  <Globe size={10} /> :{port}
                </Chip>
              ))}
              {/* The project's NOW task by name — the one thing, not a count */}
              {d.nowTask && (
                <Chip
                  title={`Now: ${d.nowTask.title} — open Tasks`}
                  onClick={() => onOpen("tasks")}
                >
                  <Star size={10} className="text-accenttext" />
                  <span className="max-w-[200px] truncate text-t2">{d.nowTask.title}</span>
                </Chip>
              )}
              {d.nextTasks > 0 && (
                <Chip
                  title={`${d.nextTasks} queued on deck — open Tasks`}
                  onClick={() => onOpen("tasks")}
                >
                  <ListTodo size={10} /> {d.nextTasks}
                </Chip>
              )}
            </div>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          <ContextMenu.Item className={menuItem} onSelect={onClose}>
            <X size={14} /> Close
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={onCloseOthers}>
            <X size={14} /> Close others
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item className={menuItem} onSelect={() => api.revealProject(p.id)}>
            <FolderOpen size={14} /> Open in Explorer
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => api.openInWebstorm(p.id)}>
            <Code2 size={14} /> Open in WebStorm
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const ROW_META = {
  attention: { color: "var(--warn)" },
  working: { color: "var(--ok)" },
  finished: { color: "var(--accent)" },
  exited: { color: "var(--err)" },
  idle: { color: "var(--color-t3)" },
} as const;

function AgentRow({ session: s, kind }: { session: Session; kind: keyof typeof ROW_META }) {
  const openSession = useUIStore((st) => st.openSession);
  const meta = ROW_META[kind];
  const summary = s.aiMeta?.summary ?? s.lastActivityLine;

  const open = () => {
    if (s.unread) void api.markSessionRead(s.id).catch(() => {});
    openSession(s.id, s.projectId);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
      className={cn(
        "cursor-pointer rounded-[8px] px-2 py-1.5 transition-colors",
        kind === "attention" ? "bg-raised hover:bg-raised" : "hover:bg-raised/60",
        kind === "idle" && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", kind === "working" && "deck-pulse")}
          style={{ background: meta.color }}
        />
        {s.kind === "claude" ? (
          <Bot size={12} className="shrink-0 text-t3" />
        ) : (
          <SquareTerminal size={12} className="shrink-0 text-t3" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-t1">
          {displayTitle(s)}
        </span>
        {kind === "attention" ? (
          <span className="mono shrink-0 text-[10.5px] font-semibold" style={{ color: meta.color }}>
            waiting {relTime(s.activityAt)}
          </span>
        ) : kind === "exited" ? (
          <span className="mono shrink-0 text-[10.5px]" style={{ color: meta.color }}>
            exit {s.exitCode}
          </span>
        ) : (
          <span className="mono shrink-0 text-[10.5px] text-t3">{relTime(s.activityAt)}</span>
        )}
      </div>

      {/* The original ask — "what did I even tell this thing to do" */}
      {s.firstPrompt && (
        <p
          className="mt-1 ml-[7px] line-clamp-2 border-l-2 pl-2.5 text-[11.5px] leading-4 text-t2"
          style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)" }}
          title={s.firstPrompt}
        >
          {s.firstPrompt}
        </p>
      )}

      {/* What it's doing right now */}
      {summary && summary !== s.firstPrompt && (
        <p className="mt-0.5 truncate pl-[24px] text-[11px] leading-4 text-t3">{summary}</p>
      )}

      {/* What it's stuck on */}
      {kind === "attention" && s.promptTail && s.promptTail.length > 0 && (
        <div className="ml-[24px] mt-1.5 max-h-[110px] overflow-y-auto rounded-[6px] bg-panel p-2">
          <pre className="mono whitespace-pre-wrap break-words text-[10.5px] leading-[1.5] text-t2">
            {s.promptTail.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded-[5px] border border-hair px-1.5 py-0.5 text-[10.5px] text-t3 transition-colors hover:bg-raised hover:text-t1"
    >
      {children}
    </button>
  );
}
