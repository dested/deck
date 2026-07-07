import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, GitBranch, CircleSlash, Check } from "lucide-react";
import type { ProjectSummary } from "@deck/shared";
import { useProjectsStore, selectSortedProjects } from "../../stores/projectsStore";
import {
  useSessionsStore,
  selectProjectStats,
  type ProjectSessionStats,
} from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { projectGradient, projectInitials } from "../../lib/identity";
import { cn } from "../../lib/cn";

// Task-board project picker. Looks like the Rail's "Open projects" rows —
// gradient avatar + name + branch/dirty/agent meta — instead of a bare
// <select>. Open projects are listed first (that's almost always the answer),
// then everything else, with type-to-filter and arrow-key navigation.

type Entry =
  | { kind: "none" }
  | { kind: "project"; project: ProjectSummary; open: boolean };

export function ProjectPicker({
  value,
  onChange,
  block,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  block?: boolean; // full-width trigger (card editor); default = compact chip
}) {
  const [open, setOpen] = useState(false);
  const byId = useProjectsStore((s) => s.byId);
  const selected = value ? byId[value] : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-1.5 text-[11.5px] transition-colors",
            block && "h-8 w-full px-2 text-[12px]",
            selected
              ? "border-hair bg-panel text-t2 hover:border-hairfocus hover:text-t1"
              : "border-dashed border-hair text-t3 hover:border-hairfocus hover:text-t2",
            "data-[state=open]:border-hairfocus data-[state=open]:text-t1",
          )}
        >
          {selected ? (
            <>
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-[4px] text-[7px] font-bold text-white/85",
                  block ? "h-5 w-5 rounded-[5px] text-[8px]" : "h-4 w-4",
                )}
                style={{ background: projectGradient(selected.name) }}
              >
                {projectInitials(selected.name)}
              </span>
              <span className={cn("truncate font-medium", block && "min-w-0 flex-1 text-left")}>
                {selected.name}
              </span>
            </>
          ) : (
            <>
              <CircleSlash size={12} className="shrink-0" />
              <span className={cn(block && "min-w-0 flex-1 text-left")}>No project</span>
            </>
          )}
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[320px] rounded-[10px] border border-hair bg-overlay p-1.5 deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <PickerList
            value={value}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickerList({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  const byId = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const openIds = useUIStore((s) => s.openProjects);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => selectProjectStats(sessions), [sessions]);

  const { entries, firstOpenIdx, firstRestIdx } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ProjectSummary) => !q || p.name.toLowerCase().includes(q);
    const openSet = new Set(openIds.filter((id) => id !== "__root__" && byId[id]));
    const open = [...openSet]
      .map((id) => byId[id]!)
      .filter((p) => p.kind !== "root" && match(p));
    const rest = selectSortedProjects(byId).filter(
      (p) => p.kind !== "root" && !openSet.has(p.id) && match(p),
    );
    const out: Entry[] = [];
    if (!q) out.push({ kind: "none" });
    const firstOpen = open.length ? out.length : -1;
    for (const p of open) out.push({ kind: "project", project: p, open: true });
    const firstRest = rest.length && open.length ? out.length : -1;
    for (const p of rest) out.push({ kind: "project", project: p, open: false });
    return { entries: out, firstOpenIdx: firstOpen, firstRestIdx: firstRest };
  }, [byId, openIds, query]);

  const clampedActive = Math.min(active, Math.max(0, entries.length - 1));

  const move = (delta: number) => {
    if (!entries.length) return;
    const next = (clampedActive + delta + entries.length) % entries.length;
    setActive(next);
    listRef.current
      ?.querySelector(`[data-pp-idx="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const pick = (e: Entry) => onPick(e.kind === "none" ? null : e.project.id);

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const entry = entries[clampedActive];
            if (entry) pick(entry);
          }
        }}
        placeholder="Find a project…"
        className="mb-1.5 h-8 w-full rounded-[6px] border border-hair bg-raised px-2.5 text-[12.5px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
      />
      <div ref={listRef} className="max-h-[340px] overflow-y-auto">
        {entries.length === 0 && (
          <div className="px-2 py-3 text-center text-[12px] text-t3">
            No project matches “{query}”
          </div>
        )}
        {entries.map((e, i) => {
          return (
            <div key={e.kind === "none" ? "__none__" : e.project.id}>
              {i === firstOpenIdx && <SectionLabel>Open projects</SectionLabel>}
              {i === firstRestIdx && <SectionLabel>All projects</SectionLabel>}
              {e.kind === "none" ? (
                <NoProjectRow
                  active={clampedActive === i}
                  selected={value === null}
                  idx={i}
                  onHover={() => setActive(i)}
                  onPick={() => pick(e)}
                />
              ) : (
                <ProjectPickRow
                  project={e.project}
                  stats={stats.get(e.project.id)}
                  active={clampedActive === i}
                  selected={value === e.project.id}
                  idx={i}
                  onHover={() => setActive(i)}
                  onPick={() => pick(e)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-t3">
      {children}
    </div>
  );
}

function NoProjectRow({
  active,
  selected,
  idx,
  onHover,
  onPick,
}: {
  active: boolean;
  selected: boolean;
  idx: number;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-pp-idx={idx}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left",
        active && "bg-raised",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-hair text-t3">
        <CircleSlash size={13} />
      </span>
      <span className="flex-1 text-[13px] text-t2">No project</span>
      {selected && <Check size={13} className="shrink-0 text-accenttext" />}
    </button>
  );
}

// The Rail ProjectRow look, reused as a menu row: avatar + status dot, name,
// branch/dirty/agents meta line.
function ProjectPickRow({
  project: p,
  stats,
  active,
  selected,
  idx,
  onHover,
  onPick,
}: {
  project: ProjectSummary;
  stats: ProjectSessionStats | undefined;
  active: boolean;
  selected: boolean;
  idx: number;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-pp-idx={idx}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left",
        active && "bg-raised",
      )}
    >
      <span className="relative shrink-0">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[11px] font-bold text-white/85"
          style={{ background: projectGradient(p.name) }}
        >
          {projectInitials(p.name)}
        </span>
        {stats && (
          <span
            className={cn(
              "pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-overlay",
              stats.attention ? "bg-[color:var(--warn)]" : "bg-[color:var(--ok)]",
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-5 text-t1">
          {p.name}
        </span>
        <span className="flex items-center gap-1.5 truncate text-[11px] leading-4 text-t3">
          {p.branch && (
            <span className="flex min-w-0 items-center gap-1">
              <GitBranch size={10} className="shrink-0" />
              <span className="truncate">{p.branch}</span>
            </span>
          )}
          {(p.dirtyCount ?? 0) > 0 && (
            <span className="shrink-0 text-[color:var(--warn)]">{p.dirtyCount}±</span>
          )}
          {stats && (
            <span
              className={cn(
                "shrink-0",
                stats.attention ? "text-[color:var(--warn)]" : "text-[color:var(--ok)]",
              )}
            >
              {stats.attention
                ? "needs input"
                : `${stats.running} agent${stats.running > 1 ? "s" : ""}`}
            </span>
          )}
        </span>
      </span>
      {selected && <Check size={13} className="shrink-0 text-accenttext" />}
    </button>
  );
}
