import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Radar,
  CircleAlert,
  CheckCircle2,
  Pencil,
  DollarSign,
  GitBranch,
  Globe,
  Kanban,
  Bot,
  SquareTerminal,
  Loader2,
  X,
  ArrowUp,
  ArrowDown,
  CheckCheck,
} from "lucide-react";
import type { ProjectSummary, ReviewItem, Session } from "@deck/shared";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { relTime, fmtUsd } from "../lib/format";
import { displayTitle, closeSession } from "../lib/sessions";
import { projectGradient, projectInitials } from "../lib/identity";
import { useCostReport } from "../lib/useCost";
import { useProjectsStore } from "../stores/projectsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useReviewsStore } from "../stores/reviewsStore";
import { useTasksStore } from "../stores/tasksStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useUIStore } from "../stores/uiStore";

// Mission Control — the full-screen replacement for the old Inbox slide-over.
// One page that answers "what is going on in every open project": every live
// agent with its AI summary, everything waiting on you (answerable inline),
// pending reviews, uncommitted work, dev servers, and queued tasks — grouped
// by project and ranked by urgency. All data is already live in the client
// stores via /ws/events; this view only derives.

type Filter = "attention" | "working" | "finished" | "review" | "dirty" | null;

interface ProjectBrief {
  project: ProjectSummary;
  attention: Session[]; // waiting on you — longest-waiting first
  working: Session[];
  finished: Session[]; // owned, idle, unread ("done, look at me")
  exited: Session[]; // owned, exited with a nonzero code
  idle: Session[]; // live but quiet (read idle / external idle)
  reviews: ReviewItem[];
  nextTasks: number; // task board: Next column
  nowTasks: number; // task board: Now column
  ports: number[];
  rank: number; // 0 attention · 1 actionable · 2 working · 3 lingering
  sortAt: number;
}

function buildBriefs(
  projects: Record<string, ProjectSummary>,
  sessions: Record<string, Session>,
  reviews: Record<string, ReviewItem>,
  tasks: ReturnType<typeof useTasksStore.getState>["byId"],
  livePorts: Record<string, number[]>,
  openProjects: string[],
): { active: ProjectBrief[]; quiet: ProjectBrief[] } {
  const byProject = new Map<string, ProjectBrief>();
  const ensure = (pid: string): ProjectBrief | null => {
    const project = projects[pid];
    if (!project) return null;
    let b = byProject.get(pid);
    if (!b) {
      b = {
        project,
        attention: [],
        working: [],
        finished: [],
        exited: [],
        idle: [],
        reviews: [],
        nextTasks: 0,
        nowTasks: 0,
        ports: livePorts[pid] ?? [],
        rank: 4,
        sortAt: 0,
      };
      byProject.set(pid, b);
    }
    return b;
  };

  const reviewedSessionIds = new Set<string>();
  for (const r of Object.values(reviews)) {
    if (r.dismissed) continue;
    reviewedSessionIds.add(r.sessionId);
    ensure(r.projectId)?.reviews.push(r);
  }

  for (const s of Object.values(sessions)) {
    if (s.status === "stale") continue;
    if (s.status === "exited") {
      if (s.source === "owned" && s.exitCode != null && s.exitCode !== 0)
        ensure(s.projectId)?.exited.push(s);
      continue;
    }
    const b = ensure(s.projectId);
    if (!b) continue;
    if (s.status === "attention") b.attention.push(s);
    else if (s.status === "working") b.working.push(s);
    else if (s.source === "owned" && s.unread && !reviewedSessionIds.has(s.id))
      b.finished.push(s);
    else b.idle.push(s);
  }

  for (const t of Object.values(tasks)) {
    if (!t.projectId) continue; // unassigned dumps don't belong to a brief
    const b = byProject.get(t.projectId) ?? ensure(t.projectId);
    if (!b) continue;
    if (t.status === "next") b.nextTasks += 1;
    else if (t.status === "now") b.nowTasks += 1;
  }
  // Task-only projects with nothing live are noise — drop the empties they made.
  for (const [pid, b] of byProject) {
    if (
      b.attention.length + b.working.length + b.finished.length +
        b.exited.length + b.idle.length + b.reviews.length === 0 &&
      b.nextTasks + b.nowTasks === 0
    )
      byProject.delete(pid);
  }

  // Open-in-rail projects always get a row, even if fully quiet.
  for (const pid of openProjects) ensure(pid);

  const active: ProjectBrief[] = [];
  const quiet: ProjectBrief[] = [];
  for (const b of byProject.values()) {
    // Stable row order: attention by how long it's been waiting (fixed while
    // it waits), everything else by creation time — NOT last activity, which
    // reshuffles rows on every WS tick when several agents are running.
    b.attention.sort((a, z) => a.activityAt - z.activityAt); // longest waiting first
    b.working.sort((a, z) => a.createdAt - z.createdAt);
    b.finished.sort((a, z) => a.createdAt - z.createdAt);
    b.idle.sort((a, z) => a.createdAt - z.createdAt);
    const all = [...b.attention, ...b.working, ...b.finished, ...b.exited, ...b.idle];
    b.sortAt = Math.max(b.project.activityAt, ...all.map((s) => s.activityAt), ...b.reviews.map((r) => r.ts));
    b.rank =
      b.attention.length > 0 ? 0
      : b.finished.length + b.reviews.length + b.exited.length > 0 ? 1
      : b.working.length > 0 ? 2
      : 3;
    if (b.rank <= 2) active.push(b);
    else quiet.push(b);
  }
  // Card order must be STABLE while agents chatter: urgency bands first, then
  // alphabetical within a band. A card only moves when its band changes (an
  // agent starts waiting / finishes), never because of raw output activity.
  active.sort((a, z) => {
    if (a.rank !== z.rank) return a.rank - z.rank;
    return a.project.name.localeCompare(z.project.name);
  });
  quiet.sort((a, z) => a.project.name.localeCompare(z.project.name));
  return { active, quiet };
}

export function OverviewView() {
  const projects = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const reviews = useReviewsStore((s) => s.byId);
  const tasks = useTasksStore((s) => s.byId);
  const livePorts = useLibraryStore((s) => s.livePorts);
  const openProjects = useUIStore((s) => s.openProjects);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const setTopView = useUIStore((s) => s.setTopView);
  const { data: cost } = useCostReport();
  const [filter, setFilter] = useState<Filter>(null);
  // Waiting-times must age even when no WS event arrives.
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && !useUIStore.getState().paletteOpen)
        setTopView(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTopView]);

  const { active, quiet } = useMemo(
    () =>
      buildBriefs(
        projects, sessions, reviews, tasks, livePorts,
        // The active project counts as open even if it never joined the rail
        // list (same fallback the Rail itself applies).
        activeProjectId ? [...openProjects, activeProjectId] : openProjects,
      ),
    [projects, sessions, reviews, tasks, livePorts, openProjects, activeProjectId],
  );

  const totals = useMemo(() => {
    const sum = (f: (b: ProjectBrief) => number) =>
      [...active, ...quiet].reduce((n, b) => n + f(b), 0);
    return {
      attention: sum((b) => b.attention.length),
      working: sum((b) => b.working.length),
      finished: sum((b) => b.finished.length),
      reviews: sum((b) => b.reviews.length),
      exited: sum((b) => b.exited.length),
      dirty: [...active, ...quiet].filter((b) => (b.project.dirtyCount ?? 0) > 0).length,
      agents: sum((b) => b.attention.length + b.working.length + b.finished.length + b.idle.length),
    };
  }, [active, quiet]);

  const matches = (b: ProjectBrief): boolean => {
    if (!filter) return true;
    if (filter === "attention") return b.attention.length > 0;
    if (filter === "working") return b.working.length > 0;
    if (filter === "finished") return b.finished.length > 0 || b.exited.length > 0;
    if (filter === "review") return b.reviews.length > 0;
    return (b.project.dirtyCount ?? 0) > 0;
  };
  const shownActive = active.filter(matches);
  const shownQuiet = quiet.filter(matches);

  const markAllRead = () => {
    for (const b of active)
      for (const s of b.finished) void api.markSessionRead(s.id).catch(() => {});
  };

  // Budget banner (same trigger as the old inbox card).
  const budgetOver =
    cost?.available && cost.budgets?.blockUSD != null && cost.activeBlock?.projection &&
    cost.activeBlock.projection.totalCost > cost.budgets.blockUSD
      ? cost.activeBlock.projection.totalCost
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: title + the global pulse (tiles double as filters) */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hair px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Radar size={18} className="text-t2" />
          <div>
            <div className="text-[15px] font-semibold leading-5 text-t1">Mission Control</div>
            <div className="text-[11.5px] leading-4 text-t3">
              {totals.agents} agent{totals.agents === 1 ? "" : "s"} across{" "}
              {active.length + quiet.length} project{active.length + quiet.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <StatTile
            icon={<CircleAlert size={14} />} color="var(--warn)" label="need input"
            count={totals.attention} active={filter === "attention"}
            onClick={() => setFilter(filter === "attention" ? null : "attention")}
          />
          <StatTile
            icon={<Loader2 size={14} className="animate-spin [animation-duration:3s]" />} color="var(--ok)" label="working"
            count={totals.working} active={filter === "working"}
            onClick={() => setFilter(filter === "working" ? null : "working")}
          />
          <StatTile
            icon={<CheckCircle2 size={14} />} color="var(--accent)" label="finished"
            count={totals.finished + totals.exited} active={filter === "finished"}
            onClick={() => setFilter(filter === "finished" ? null : "finished")}
          />
          <StatTile
            icon={<Pencil size={14} />} color="var(--accent)" label="reviews"
            count={totals.reviews} active={filter === "review"}
            onClick={() => setFilter(filter === "review" ? null : "review")}
          />
          <StatTile
            icon={<GitBranch size={14} />} color="var(--warn)" label="dirty"
            count={totals.dirty} active={filter === "dirty"}
            onClick={() => setFilter(filter === "dirty" ? null : "dirty")}
          />
          {cost?.available && cost.activeBlock && (
            <button
              onClick={() => setTopView("costs")}
              title="Current 5h billing block (click for Costs)"
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-hair px-2.5 text-[12px] text-t2 hover:bg-raised hover:text-t1"
            >
              <DollarSign size={14} className="text-t3" />
              <span className="mono">{fmtUsd(cost.activeBlock.costUSD)}</span>
              {cost.activeBlock.projection && (
                <span className="mono text-[10.5px] text-t3">
                  →{fmtUsd(cost.activeBlock.projection.totalCost)}
                </span>
              )}
            </button>
          )}
          {totals.finished > 0 && (
            <button
              onClick={markAllRead}
              title="Mark every finished session read"
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-hair px-2.5 text-[12px] text-t2 hover:bg-raised hover:text-t1"
            >
              <CheckCheck size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {budgetOver != null && (
        <button
          onClick={() => setTopView("costs")}
          className="flex shrink-0 items-center gap-2 border-b border-hair bg-[color:var(--warn)]/10 px-5 py-1.5 text-left text-[12px] text-[color:var(--warn)] hover:bg-[color:var(--warn)]/15"
        >
          <DollarSign size={13} />
          Current block projected {fmtUsd(budgetOver)} — over your {fmtUsd(cost!.budgets!.blockUSD!)} budget
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        {shownActive.length === 0 && shownQuiet.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-t3">
            <CheckCircle2 size={32} className="opacity-40" />
            <span className="text-[14px]">
              {filter ? "Nothing matches this filter." : "All clear — nothing open, nothing waiting."}
            </span>
            {filter && (
              <button onClick={() => setFilter(null)} className="text-[12px] text-accenttext hover:underline">
                Show everything
              </button>
            )}
          </div>
        ) : (
          <div className="p-4">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
              {shownActive.map((b) => (
                <ProjectCard key={b.project.id} brief={b} />
              ))}
            </div>

            {shownQuiet.length > 0 && (
              <>
                <div className="mt-6 flex items-center gap-2 px-1 pb-2">
                  <span className="section-label">Quiet</span>
                  <span className="text-[11px] text-t3">open, nothing needs you</span>
                </div>
                <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                  {shownQuiet.map((b) => (
                    <QuietRow key={b.project.id} brief={b} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon, color, label, count, active, onClick,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] transition-colors",
        active ? "border-hairfocus bg-raised text-t1" : "border-hair text-t2 hover:bg-raised hover:text-t1",
        count === 0 && !active && "opacity-45",
      )}
      title={`Filter: ${label}`}
    >
      <span style={{ color: count > 0 ? color : undefined }} className={cn(count === 0 && "text-t3")}>
        {icon}
      </span>
      <span className="mono font-semibold">{count}</span>
      <span className="text-t3">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function ProjectCard({ brief: b }: { brief: ProjectBrief }) {
  const openProject = useUIStore((s) => s.openProject);
  const p = b.project;
  const hasAttention = b.attention.length > 0;
  const isRoot = p.kind === "root";

  return (
    <div
      className="flex flex-col rounded-[10px] border bg-panel"
      style={{
        borderColor: hasAttention
          ? "color-mix(in srgb, var(--warn) 45%, transparent)"
          : "var(--color-hair)",
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-3">
        <button onClick={() => openProject(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[10px] font-bold text-white/85"
            style={{ background: projectGradient(p.name) }}
          >
            {projectInitials(p.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold leading-5 text-t1 hover:underline">
              {isRoot ? "~ code" : p.name}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] leading-4 text-t3">
              {p.branch && (
                <span className="flex min-w-0 items-center gap-1">
                  <GitBranch size={10} className="shrink-0" />
                  <span className="max-w-[140px] truncate">{p.branch}</span>
                </span>
              )}
              {p.aheadBehind && p.aheadBehind.ahead > 0 && (
                <span className="flex items-center text-t3"><ArrowUp size={10} />{p.aheadBehind.ahead}</span>
              )}
              {p.aheadBehind && p.aheadBehind.behind > 0 && (
                <span className="flex items-center text-t3"><ArrowDown size={10} />{p.aheadBehind.behind}</span>
              )}
              <span className="shrink-0">{relTime(b.sortAt)}</span>
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {(p.dirtyCount ?? 0) > 0 && !isRoot && (
            <Chip
              title={`${p.dirtyCount} uncommitted file${p.dirtyCount === 1 ? "" : "s"} — open Git`}
              warn
              onClick={() => openProject(p.id, "git")}
            >
              {p.dirtyCount}± uncommitted
            </Chip>
          )}
          {b.ports.map((port) => (
            <Chip
              key={port}
              title={`Dev server on :${port} — open in browser`}
              onClick={() => window.open(`http://localhost:${port}`, "_blank")}
            >
              <Globe size={10} /> :{port}
            </Chip>
          ))}
          {b.nextTasks + b.nowTasks > 0 && (
            <Chip title={`${b.nowTasks} now · ${b.nextTasks} next on the task board`} onClick={() => useUIStore.getState().setTopView("board")}>
              <Kanban size={10} /> {b.nowTasks > 0 ? `${b.nowTasks}★` : ""}{b.nextTasks > 0 ? ` ${b.nextTasks}⋯` : ""}
            </Chip>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-1 px-2 pb-2">
        {b.attention.map((s) => <SessionRow key={s.id} session={s} kind="attention" />)}
        {b.reviews.map((r) => <ReviewRow key={r.id} review={r} />)}
        {b.finished.map((s) => <SessionRow key={s.id} session={s} kind="finished" />)}
        {b.exited.map((s) => <SessionRow key={s.id} session={s} kind="exited" />)}
        {b.working.map((s) => <SessionRow key={s.id} session={s} kind="working" />)}
        {b.idle.slice(0, 3).map((s) => <SessionRow key={s.id} session={s} kind="idle" />)}
        {b.idle.length > 3 && (
          <button
            onClick={() => openProject(p.id, "agents")}
            className="px-2 py-0.5 text-left text-[11px] text-t3 hover:text-t1"
          >
            +{b.idle.length - 3} more idle
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({
  children, title, warn, onClick,
}: {
  children: React.ReactNode;
  title: string;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-5.5 items-center gap-1 rounded-[5px] border border-hair px-1.5 py-0.5 text-[10.5px] transition-colors hover:bg-raised",
        warn ? "text-[color:var(--warn)]" : "text-t3 hover:text-t1",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

const ROW_META = {
  attention: { color: "var(--warn)", label: "needs input" },
  working: { color: "var(--ok)", label: "working" },
  finished: { color: "var(--accent)", label: "finished" },
  exited: { color: "var(--err)", label: "exited" },
  idle: { color: "var(--color-t3)", label: "idle" },
} as const;

function SessionRow({ session: s, kind }: { session: Session; kind: keyof typeof ROW_META }) {
  const openSession = useUIStore((st) => st.openSession);
  const meta = ROW_META[kind];
  const summary = s.aiMeta?.summary ?? s.lastActivityLine;

  const open = () => {
    if (s.unread) void api.markSessionRead(s.id).catch(() => {});
    openSession(s.id, s.projectId);
  };

  return (
    <div
      className={cn(
        "group rounded-[8px] px-2 py-1.5",
        kind === "attention" ? "bg-raised" : "hover:bg-raised/60",
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
        <button onClick={open} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-t1 hover:underline">
          {displayTitle(s)}
        </button>
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
        {(kind === "finished" || kind === "exited") && (
          <button
            onClick={() =>
              kind === "exited" ? closeSession(s) : void api.markSessionRead(s.id).catch(() => {})
            }
            title={kind === "exited" ? "Close" : "Mark read"}
            className="shrink-0 rounded p-0.5 text-t3 opacity-0 transition-opacity hover:bg-overlay hover:text-t1 group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {summary && kind !== "attention" && (
        <p className="mt-0.5 truncate pl-[24px] text-[11.5px] leading-4 text-t2">{summary}</p>
      )}

      {kind === "attention" && (
        <>
          {s.promptTail && s.promptTail.length > 0 && (
            <div className="ml-[24px] mt-1.5 max-h-[130px] overflow-y-auto rounded-[6px] bg-panel p-2">
              <pre className="mono whitespace-pre-wrap break-words text-[10.5px] leading-[1.5] text-t2">
                {s.promptTail.join("\n")}
              </pre>
            </div>
          )}
          {s.source === "owned" ? (
            <div className="ml-[24px] mt-1.5">
              <QuickRespond session={s} />
            </div>
          ) : (
            summary && <p className="mt-1 truncate pl-[24px] text-[11.5px] text-t2">{summary}</p>
          )}
        </>
      )}
    </div>
  );
}

function ReviewRow({ review: r }: { review: ReviewItem }) {
  const openProject = useUIStore((s) => s.openProject);
  const setGitFocusPath = useUIStore((s) => s.setGitFocusPath);
  const open = () => {
    const first = r.files[0];
    if (first) setGitFocusPath({ projectId: r.projectId, path: first });
    openProject(r.projectId, "git");
  };
  return (
    <div className="group rounded-[8px] px-2 py-1.5 hover:bg-raised/60">
      <div className="flex items-center gap-2">
        <Pencil size={12} className="shrink-0 text-[color:var(--accent)]" />
        <button onClick={open} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-t1 hover:underline">
          {r.summary ?? `Review ${r.files.length} changed file${r.files.length === 1 ? "" : "s"}`}
        </button>
        <span className="mono shrink-0 text-[10.5px] text-t3">{relTime(r.ts)}</span>
        <button
          onClick={() => void api.dismissReview(r.id).catch(() => {})}
          title="Dismiss review"
          className="shrink-0 rounded p-0.5 text-t3 opacity-0 transition-opacity hover:bg-overlay hover:text-t1 group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 pl-[20px]">
        {r.files.slice(0, 5).map((f) => (
          <span key={f} className="mono rounded-[4px] bg-raised px-1 py-0.5 text-[10px] text-t3">
            {f.split("/").pop()}
          </span>
        ))}
        {r.files.length > 5 && <span className="text-[10px] text-t3">+{r.files.length - 5}</span>}
      </div>
    </div>
  );
}

function QuietRow({ brief: b }: { brief: ProjectBrief }) {
  const openProject = useUIStore((s) => s.openProject);
  const p = b.project;
  const isRoot = p.kind === "root";
  return (
    <button
      onClick={() => openProject(p.id)}
      className="flex items-center gap-2.5 rounded-[8px] border border-hair bg-panel px-2.5 py-2 text-left transition-colors hover:bg-raised"
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white/85"
        style={{ background: projectGradient(p.name) }}
      >
        {projectInitials(p.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-4 text-t1">
          {isRoot ? "~ code" : p.name}
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] leading-4 text-t3">
          {p.branch && <span className="max-w-[120px] truncate">{p.branch}</span>}
          {(p.dirtyCount ?? 0) > 0 && (
            <span className="text-[color:var(--warn)]">{p.dirtyCount}±</span>
          )}
          {b.idle.length > 0 && <span>{b.idle.length} idle</span>}
          {b.nextTasks > 0 && <span>{b.nextTasks} next</span>}
        </span>
      </span>
      <span className="mono shrink-0 text-[10px] text-t3">{relTime(b.sortAt)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Quick-respond (moved here from the old InboxPanel): answer an owned claude
// waiting on a prompt without opening its tab. Digits/letters go as-is; Esc as
// \x1b; free text as text + ⏎.
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
        placeholder="Reply without opening…"
        className="h-6 w-full rounded-[5px] border border-hair bg-panel px-1.5 text-[11px] text-t1 focus:border-hairfocus focus:outline-none"
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
