import { useMemo, useState } from "react";
import { Search, ChevronRight, ChevronDown, Eye } from "lucide-react";
import type { ProjectSummary, Session, Group } from "@deck/shared";
import { useProjectsStore, selectSortedProjects } from "../stores/projectsStore";
import { useProjectGroupsStore } from "../stores/projectGroupsStore";
import { useLibraryStore } from "../stores/libraryStore";
import {
  useSessionsStore,
  selectSessions,
  selectProjectStats,
} from "../stores/sessionsStore";
import { useUIStore } from "../stores/uiStore";
import { ProjectCard } from "../components/library/ProjectCard";
import { SessionCard } from "../components/home/SessionCard";
import { api } from "../lib/api";
import { projectGradient, projectColor, projectInitials } from "../lib/identity";
import { cn } from "../lib/cn";

// §9.2 rethought — Home is the LIBRARY: a visual, browsable grid of every
// project. Recognition over recall: cards carry a screenshot/gradient face,
// readme blurb, framework badges, live ports and one-click run buttons.
// Ungrouped projects decay on their own: Active (<7d) → Shelf (<30d) →
// Archive (collapsed). Pins and groups float above the decay.

const DAY = 86_400_000;
const ACTIVE_WINDOW = 7 * DAY;
const SHELF_WINDOW = 30 * DAY;

export function LibraryView() {
  const byId = useProjectsStore((s) => s.byId);
  const loaded = useProjectsStore((s) => s.loaded);
  const groups = useProjectGroupsStore((s) => s.groups);
  const sessionsById = useSessionsStore((s) => s.byId);
  const search = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const [showArchive, setShowArchive] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const stats = useMemo(
    () => selectProjectStats(sessionsById),
    [sessionsById],
  );
  const sessions = selectSessions(sessionsById);
  const attention = sessions.filter((s) => s.status === "attention");

  const searching = search.trim().length > 0;
  const list = useMemo(
    () =>
      selectSortedProjects(byId, {
        query: search,
        includeHidden: showHidden || searching,
      }),
    [byId, search, showHidden, searching],
  );
  const hiddenCount = useMemo(
    () => Object.values(byId).filter((p) => p.hidden).length,
    [byId],
  );

  // Partition: pinned → groups → decay buckets for the ungrouped rest.
  const parts = useMemo(() => {
    const gset = new Set(groups.map((g) => g.id));
    const pinned: ProjectSummary[] = [];
    const grouped = new Map<string, ProjectSummary[]>();
    const active: ProjectSummary[] = [];
    const shelf: ProjectSummary[] = [];
    const archive: ProjectSummary[] = [];
    const now = Date.now();
    for (const p of list) {
      if (p.kind === "root") continue; // has its own fixed Rail entry (M10)
      if (p.pinned) {
        pinned.push(p);
      } else if (p.groupId && gset.has(p.groupId)) {
        const arr = grouped.get(p.groupId) ?? [];
        arr.push(p);
        grouped.set(p.groupId, arr);
      } else if (now - p.activityAt < ACTIVE_WINDOW) {
        active.push(p);
      } else if (now - p.activityAt < SHELF_WINDOW) {
        shelf.push(p);
      } else {
        archive.push(p);
      }
    }
    return { pinned, grouped, active, shelf, archive };
  }, [list, groups]);

  const renderGrid = (items: ProjectSummary[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-3">
      {items.map((p) => (
        <CardWithData key={p.id} project={p} stats={stats} />
      ))}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
      <div className="mx-auto max-w-[1600px] px-6 py-5">
        {/* header */}
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-[15px] font-semibold text-t1">Library</h1>
          <span className="mono text-[12px] text-t3">
            {Object.keys(byId).length} repos
          </span>
          <div className="ml-auto flex h-8 w-[280px] items-center gap-2 rounded-[6px] border border-hair bg-raised px-2 focus-within:border-hairfocus">
            <Search size={13} className="text-t3" />
            <input
              id="deck-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects  ( / )"
              className="h-full w-full bg-transparent text-[13px] text-t1 placeholder:text-t3 focus:outline-none"
            />
          </div>
        </div>

        {!loaded && (
          <div className="py-8 text-center text-[13px] text-t3">Scanning…</div>
        )}

        {loaded && searching ? (
          list.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-t3">
              No projects match “{search.trim()}”
            </div>
          ) : (
            renderGrid(list)
          )
        ) : loaded ? (
          <div className="flex flex-col gap-6">
            {attention.length > 0 && (
              <Section label="Needs attention" count={attention.length} accent>
                <AttentionStrip sessions={attention} />
              </Section>
            )}

            {parts.pinned.length > 0 && (
              <Section label="Pinned" count={parts.pinned.length}>
                {renderGrid(parts.pinned)}
              </Section>
            )}

            {groups.map((g) => {
              const items = parts.grouped.get(g.id) ?? [];
              if (items.length === 0) return null;
              return (
                <CategoryBand key={g.id} group={g} items={items} stats={stats}>
                  {renderGrid(items)}
                </CategoryBand>
              );
            })}

            {(parts.active.length > 0 || parts.shelf.length > 0) &&
              parts.grouped.size > 0 && (
                <div className="-mt-1 flex items-center gap-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-t3/70">
                    Uncategorized
                  </span>
                  <div className="h-px flex-1 bg-hair" />
                </div>
              )}

            {parts.active.length > 0 && (
              <Section label="Active" hint="last 7 days" count={parts.active.length}>
                {renderGrid(parts.active)}
              </Section>
            )}

            {parts.shelf.length > 0 && (
              <Section label="Shelf" hint="last 30 days" count={parts.shelf.length}>
                {renderGrid(parts.shelf)}
              </Section>
            )}

            {(parts.archive.length > 0 || hiddenCount > 0) && (
              <div>
                <button
                  onClick={() => setShowArchive((v) => !v)}
                  className="mb-2 flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3 hover:text-t1"
                >
                  {showArchive ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                  Archive
                  <span className="mono font-normal normal-case tracking-normal">
                    {parts.archive.length}
                  </span>
                </button>
                {showArchive && (
                  <>
                    {renderGrid(parts.archive)}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setShowHidden((v) => !v)}
                        className="mt-3 flex items-center gap-1.5 rounded-[6px] px-1 py-1 text-[12px] text-t3 hover:text-t2"
                      >
                        <Eye size={12} />
                        {showHidden
                          ? "Hide hidden projects"
                          : `Show ${hiddenCount} hidden`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  label,
  hint,
  count,
  accent,
  children,
}: {
  label: string;
  hint?: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-[0.06em]",
            accent ? "text-[color:var(--warn)]" : "text-t3",
          )}
        >
          {label}
        </span>
        <span className="mono text-[11px] text-t3">{count}</span>
        {hint && <span className="text-[11px] text-t3">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

// A user-created project group, rendered as a dominant "category" band — its
// own colour identity (gradient avatar + accent rule), a big name, live-agent
// signal, and a collapse toggle persisted server-side. These are the shelves
// the user hand-curated, so they outrank the auto-decay buckets below.
function CategoryBand({
  group,
  items,
  stats,
  children,
}: {
  group: Group;
  items: ProjectSummary[];
  stats: Map<string, { running: number; attention: boolean }>;
  children: React.ReactNode;
}) {
  const collapsed = group.collapsed ?? false;
  const accent = projectColor(group.name);

  // Live signal across the whole category: how many agents are running, and
  // whether anything in here needs input.
  let running = 0;
  let attention = false;
  for (const p of items) {
    const s = stats.get(p.id);
    if (s) {
      running += s.running;
      attention ||= s.attention;
    }
  }

  const toggle = () =>
    void api
      .updateProjectGroup(group.id, { collapsed: !collapsed })
      .catch(() => {});

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={toggle}
          className="group flex min-w-0 items-center gap-3 text-left"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold text-white/90 shadow-sm"
            style={{ background: projectGradient(group.name) }}
          >
            {projectInitials(group.name)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold leading-5 text-t1">
                {group.name}
              </span>
              {collapsed ? (
                <ChevronRight size={15} className="shrink-0 text-t3" />
              ) : (
                <ChevronDown
                  size={15}
                  className="shrink-0 text-t3 opacity-0 transition-opacity group-hover:opacity-100"
                />
              )}
            </span>
            <span className="flex items-center gap-2 text-[11px] leading-4 text-t3">
              <span className="mono">
                {items.length} repo{items.length === 1 ? "" : "s"}
              </span>
              {running > 0 && (
                <span
                  className="mono flex items-center gap-1"
                  style={{ color: attention ? "var(--warn)" : "var(--ok)" }}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      !attention && "deck-pulse",
                    )}
                    style={{
                      background: attention ? "var(--warn)" : "var(--ok)",
                    }}
                  />
                  {running} live
                </span>
              )}
            </span>
          </span>
        </button>
        {/* colour rule carries the category identity across the row */}
        <div
          className="ml-1 h-[2px] flex-1 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${accent} 0%, color-mix(in srgb, ${accent} 22%, transparent) 40%, transparent 100%)`,
          }}
        />
      </div>
      {!collapsed && children}
    </section>
  );
}

function AttentionStrip({ sessions }: { sessions: Session[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} />
      ))}
    </div>
  );
}

// Small wrapper so each card subscribes to only its own slices of the library
// store (inspection / ports / shot) instead of the whole map.
function CardWithData({
  project,
  stats,
}: {
  project: ProjectSummary;
  stats: Map<string, { running: number; attention: boolean }>;
}) {
  const inspection = useLibraryStore((s) => s.inspections[project.id]);
  const livePorts = useLibraryStore((s) => s.livePorts[project.id]);
  const shotAt = useLibraryStore((s) => s.shots[project.id]);
  const groups = useProjectGroupsStore((s) => s.groups);
  return (
    <ProjectCard
      project={project}
      inspection={inspection}
      livePorts={livePorts}
      shotAt={shotAt}
      stats={stats.get(project.id)}
      groups={groups}
    />
  );
}
