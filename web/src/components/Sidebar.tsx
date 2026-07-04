import { useMemo, useState, useRef } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Search,
  Settings,
  Eye,
  Home,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ProjectSummary } from "@deck/shared";
import { useProjectsStore, selectSortedProjects } from "../stores/projectsStore";
import { useProjectGroupsStore } from "../stores/projectGroupsStore";
import {
  useSessionsStore,
  selectProjectStats,
} from "../stores/sessionsStore";
import { useUIStore } from "../stores/uiStore";
import { ProjectRow } from "./sidebar/ProjectRow";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuItemDanger,
  menuSeparator,
} from "./ui/menuStyles";

type DragKind = "project" | "group";

export function Sidebar() {
  const byId = useProjectsStore((s) => s.byId);
  const loaded = useProjectsStore((s) => s.loaded);
  const groups = useProjectGroupsStore((s) => s.groups);
  const sessions = useSessionsStore((s) => s.byId);
  const search = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const lastOpenedAt = useUIStore((s) => s.lastOpenedAt);
  const goHome = useUIStore((s) => s.goHome);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [showHidden, setShowHidden] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Native HTML5 drag state. `dragRef` is read inside drop handlers; `dragKind`
  // is mirrored to state so drop-target styling re-renders while dragging.
  const dragRef = useRef<{ kind: DragKind; id: string } | null>(null);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const stats = useMemo(() => selectProjectStats(sessions), [sessions]);
  const searching = search.trim().length > 0;

  const list = useMemo(
    () => selectSortedProjects(byId, { query: search, includeHidden: showHidden }),
    [byId, search, showHidden],
  );
  const hiddenCount = useMemo(
    () => Object.values(byId).filter((p) => p.hidden).length,
    [byId],
  );

  // Partition the (already sorted) visible list into group buckets + ungrouped.
  const { grouped, ungrouped } = useMemo(() => {
    const gset = new Set(groups.map((g) => g.id));
    const grouped = new Map<string, ProjectSummary[]>();
    const ungrouped: ProjectSummary[] = [];
    for (const p of list) {
      const gid = p.groupId ?? null;
      if (gid && gset.has(gid)) {
        const arr = grouped.get(gid) ?? [];
        arr.push(p);
        grouped.set(gid, arr);
      } else {
        ungrouped.push(p);
      }
    }
    return { grouped, ungrouped };
  }, [list, groups]);

  // ---- drag/drop helpers ----
  const startDrag = (
    e: React.DragEvent,
    kind: DragKind,
    id: string,
  ) => {
    dragRef.current = { kind, id };
    setDragKind(kind);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragKind(null);
    setOver(null);
  };
  const allowDrop = (e: React.DragEvent, key: string) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(key);
  };

  const reorderBefore = (dragged: string, target: string) => {
    if (dragged === target) return;
    const ids = groups.map((g) => g.id).filter((x) => x !== dragged);
    const idx = ids.indexOf(target);
    if (idx < 0) return;
    ids.splice(idx, 0, dragged);
    void api.reorderProjectGroups(ids).catch(() => {});
  };

  const dropOnGroup = (e: React.DragEvent, gid: string) => {
    e.preventDefault();
    const d = dragRef.current;
    endDrag();
    if (!d) return;
    if (d.kind === "project") {
      if ((byId[d.id]?.groupId ?? null) !== gid)
        void api.assignProjectGroup(gid, d.id).catch(() => {});
    } else {
      reorderBefore(d.id, gid);
    }
  };

  const dropOnUngrouped = (e: React.DragEvent) => {
    e.preventDefault();
    const d = dragRef.current;
    endDrag();
    if (!d) return;
    if (d.kind === "project") {
      if ((byId[d.id]?.groupId ?? null) !== null)
        void api.assignProjectGroup(null, d.id).catch(() => {});
    } else {
      // Drop a group onto the ungrouped zone -> send it to the end.
      const ids = groups.map((g) => g.id).filter((x) => x !== d.id);
      ids.push(d.id);
      void api.reorderProjectGroups(ids).catch(() => {});
    }
  };

  const startRename = (id: string, name: string) => {
    setEditingGroupId(id);
    setEditName(name);
  };
  const commitRename = (id: string) => {
    const name = editName.trim();
    if (name) void api.updateProjectGroup(id, { name }).catch(() => {});
    setEditingGroupId(null);
  };
  const newGroup = async () => {
    try {
      const g = await api.createProjectGroup("New group");
      startRename(g.id, g.name);
    } catch {
      /* ignore (pre-restart the endpoint 404s) */
    }
  };

  const renderRow = (p: ProjectSummary) => (
    <div
      key={p.id}
      draggable
      onDragStart={(e) => startDrag(e, "project", p.id)}
      onDragEnd={endDrag}
    >
      <ProjectRow
        project={p}
        active={p.id === activeProjectId}
        stats={stats.get(p.id)}
        lastOpenedAt={lastOpenedAt[p.id]}
        groups={groups}
      />
    </div>
  );

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

      {/* Home / overview */}
      <div className="px-3 pb-2">
        <button
          onClick={goHome}
          className={cn(
            "flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] transition-colors",
            activeProjectId === null
              ? "bg-raised text-t1"
              : "text-t2 hover:bg-raised hover:text-t1",
          )}
        >
          <Home size={14} className="shrink-0 text-t3" />
          <span>Overview</span>
        </button>
      </div>

      {/* Projects section */}
      <div className="mb-1 flex items-center justify-between px-4">
        <span className="section-label">Projects</span>
        <button
          onClick={newGroup}
          title="New group"
          className="flex h-5 w-5 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
        >
          <FolderPlus size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {!loaded && <div className="px-2 py-1 text-[12px] text-t3">Scanning…</div>}
        {loaded && list.length === 0 && (
          <div className="px-2 py-1 text-[12px] text-t3">No projects</div>
        )}

        {/* Groups */}
        {groups.map((g) => {
          const items = grouped.get(g.id) ?? [];
          if (searching && items.length === 0) return null;
          const collapsed = !!g.collapsed && !searching;
          const isOver = over === `grp:${g.id}`;
          const editing = editingGroupId === g.id;
          return (
            <div key={g.id} className="mb-0.5">
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
                  <div
                    draggable={!editing}
                    onDragStart={(e) => startDrag(e, "group", g.id)}
                    onDragEnd={endDrag}
                    onDragOver={(e) => allowDrop(e, `grp:${g.id}`)}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => dropOnGroup(e, g.id)}
                    className={cn(
                      "group/gh flex h-[26px] items-center gap-1 rounded-[6px] pr-1.5 text-t2 transition-colors",
                      isOver && dragKind === "project" &&
                        "bg-raised ring-1 ring-[color:var(--accent)]",
                      isOver && dragKind === "group" &&
                        "border-t-2 border-[color:var(--accent)]",
                      !isOver && "hover:bg-raised",
                    )}
                  >
                    <button
                      onClick={() =>
                        void api
                          .updateProjectGroup(g.id, { collapsed: !g.collapsed })
                          .catch(() => {})
                      }
                      className="flex h-full w-6 shrink-0 items-center justify-center text-t3 hover:text-t1"
                    >
                      {collapsed ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                    {editing ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => commitRename(g.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(g.id);
                          if (e.key === "Escape") setEditingGroupId(null);
                        }}
                        className="h-5 min-w-0 flex-1 rounded-[4px] border border-hairfocus bg-root px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-t1 focus:outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => startRename(g.id, g.name)}
                        className="min-w-0 flex-1 cursor-default select-none truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-t3"
                      >
                        {g.name}
                      </span>
                    )}
                    <span className="mono shrink-0 text-[11px] text-t3">
                      {items.length}
                    </span>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    className={menuContent}
                    style={menuContentStyle}
                  >
                    <ContextMenu.Item
                      className={menuItem}
                      onSelect={() => startRename(g.id, g.name)}
                    >
                      <Pencil size={14} /> Rename
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={menuSeparator} />
                    <ContextMenu.Item
                      className={menuItemDanger}
                      onSelect={() =>
                        void api.deleteProjectGroup(g.id).catch(() => {})
                      }
                    >
                      <Trash2 size={14} /> Delete group
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
              {!collapsed && items.map(renderRow)}
            </div>
          );
        })}

        {/* Ungrouped */}
        {groups.length > 0 && ungrouped.length > 0 && (
          <div
            onDragOver={(e) => allowDrop(e, "ungrouped")}
            onDragLeave={() => setOver(null)}
            onDrop={dropOnUngrouped}
            className={cn(
              "mt-1 flex h-[22px] items-center rounded-[6px] px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3 transition-colors",
              over === "ungrouped" &&
                dragKind === "project" &&
                "bg-raised ring-1 ring-[color:var(--accent)]",
            )}
          >
            Ungrouped
          </div>
        )}
        <div
          onDragOver={(e) => allowDrop(e, "ungrouped")}
          onDrop={dropOnUngrouped}
        >
          {ungrouped.map(renderRow)}
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
