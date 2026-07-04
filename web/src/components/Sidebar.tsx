import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Settings, Eye } from "lucide-react";
import { useProjectsStore, selectSortedProjects } from "../stores/projectsStore";
import { useUIStore } from "../stores/uiStore";
import { ProjectRow } from "./sidebar/ProjectRow";
import { SessionList } from "./sidebar/SessionList";
import { useState } from "react";

export function Sidebar() {
  const byId = useProjectsStore((s) => s.byId);
  const loaded = useProjectsStore((s) => s.loaded);
  const search = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const [showHidden, setShowHidden] = useState(false);

  const visible = useMemo(
    () => selectSortedProjects(byId, { query: search }),
    [byId, search],
  );
  const hiddenCount = useMemo(
    () => Object.values(byId).filter((p) => p.hidden).length,
    [byId],
  );
  const hiddenList = useMemo(
    () =>
      showHidden
        ? selectSortedProjects(byId, { query: search, includeHidden: true }).filter(
            (p) => p.hidden,
          )
        : [],
    [byId, search, showHidden],
  );

  const activeProjectId = activeTabId.startsWith("project:")
    ? activeTabId.slice("project:".length)
    : null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = showHidden ? [...visible, ...hiddenList] : visible;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  return (
    <aside className="flex h-full flex-col border-r border-hair bg-panel">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="text-[12px] font-semibold tracking-wide text-t2">
          DECK
        </span>
      </div>
      <div className="px-3 pb-2">
        <div className="flex h-8 items-center gap-2 rounded-[6px] border border-hair bg-raised px-2 focus-within:border-hairfocus">
          <Search size={13} className="text-t3" />
          <input
            id="deck-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects"
            className="h-full w-full bg-transparent text-[13px] text-t1 placeholder:text-t3 focus:outline-none"
          />
        </div>
      </div>

      {/* Sessions section */}
      <div className="shrink-0 px-3 pb-2">
        <div className="section-label mb-1 px-1">Sessions</div>
        <div className="max-h-[38vh] overflow-y-auto">
          <SessionList />
        </div>
      </div>

      {/* Projects section */}
      <div className="section-label mb-1 px-4">Projects</div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {!loaded && (
          <div className="px-2 py-1 text-[12px] text-t3">Scanning…</div>
        )}
        {loaded && visible.length === 0 && (
          <div className="px-2 py-1 text-[12px] text-t3">No projects</div>
        )}
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const p = rows[vi.index]!;
            return (
              <div
                key={p.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: 30,
                }}
              >
                <ProjectRow project={p} active={p.id === activeProjectId} />
              </div>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="mt-1 flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-t3 hover:bg-raised hover:text-t2"
          >
            <Eye size={12} />
            {showHidden ? "Hide hidden" : `Show ${hiddenCount} hidden`}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-hair px-3">
        <span className="mono text-[11px] text-t3">
          {Object.keys(byId).length} repos
        </span>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1"
          aria-label="Settings"
        >
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}
