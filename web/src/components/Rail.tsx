import { useMemo } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  LayoutGrid,
  Settings,
  DollarSign,
  X,
  FolderOpen,
  Code2,
  Sparkles,
  Newspaper,
  Kanban,
  Bell,
  SquareTerminal,
  Activity,
  GitBranch,
} from "lucide-react";
import { useProjectsStore } from "../stores/projectsStore";
import {
  useSessionsStore,
  selectProjectStats,
  type ProjectSessionStats,
} from "../stores/sessionsStore";
import { useUIStore, type TopView } from "../stores/uiStore";
import { useInboxCount } from "../lib/useInbox";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { projectGradient, projectInitials } from "../lib/identity";
import { Tooltip } from "./ui/Tooltip";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuSeparator,
} from "./ui/menuStyles";

// The rail: a sidebar of OPEN projects (full names, branch + agent status).
// The full project list lives in the Library (Home); the rail is only what
// you're working on now. Width is persisted (uiStore.sidebarWidth) and
// drag-resizable via the right-edge handle.
export function Rail() {
  const byId = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const openProjects = useUIStore((s) => s.openProjects);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const topView = useUIStore((s) => s.topView);
  const width = useUIStore((s) => s.sidebarWidth);
  const goHome = useUIStore((s) => s.goHome);
  const openProject = useUIStore((s) => s.openProject);
  const closeRailProject = useUIStore((s) => s.closeRailProject);
  const setTopView = useUIStore((s) => s.setTopView);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setInboxOpen = useUIStore((s) => s.setInboxOpen);
  const inboxOpen = useUIStore((s) => s.inboxOpen);
  const inboxCount = useInboxCount();

  const stats = useMemo(() => selectProjectStats(sessions), [sessions]);

  // A restored session (pre-rail localStorage) may have an active project that
  // was never added to openProjects — always show it.
  const railIds = useMemo(() => {
    const ids = [...openProjects];
    if (activeProjectId && !ids.includes(activeProjectId))
      ids.push(activeProjectId);
    // Root has its own fixed row above.
    return ids.filter((id) => byId[id] && id !== "__root__");
  }, [openProjects, activeProjectId, byId]);

  const homeActive = activeProjectId === null && topView === null;
  const rootActive = activeProjectId === "__root__" && topView === null;

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-hair bg-panel py-2"
      style={{ width }}
    >
      <div className="flex flex-col gap-0.5 px-2">
        <NavRow
          icon={<LayoutGrid size={16} />}
          label="Library"
          active={homeActive}
          onClick={goHome}
        />
        <NavRow
          icon={<Bell size={16} />}
          label="Inbox"
          hint="Ctrl+I"
          active={inboxOpen}
          onClick={() => setInboxOpen(!inboxOpen)}
          trailing={
            inboxCount > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--warn)] px-1 text-[9px] font-bold text-black">
                {inboxCount > 9 ? "9+" : inboxCount}
              </span>
            ) : null
          }
        />
        {byId["__root__"] && (
          <NavRow
            icon={<SquareTerminal size={16} />}
            label="~ code"
            active={rootActive}
            onClick={() => openProject("__root__")}
          />
        )}
      </div>

      <div className="mt-2 flex items-center px-4 pb-1 pt-2">
        <span className="section-label">Open projects</span>
      </div>

      {/* Open projects */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-1">
        {railIds.length === 0 && (
          <div className="px-2 py-3 text-[12px] leading-5 text-t3">
            Nothing open yet — pick a project from the Library.
          </div>
        )}
        {railIds.map((id) => (
          <ProjectRow
            key={id}
            project={byId[id]!}
            stats={stats.get(id)}
            active={id === activeProjectId && topView === null}
            onOpen={() => openProject(id)}
            onClose={() => closeRailProject(id)}
            onCloseOthers={() => {
              for (const other of railIds) if (other !== id) closeRailProject(other);
              openProject(id);
            }}
          />
        ))}
      </div>

      {/* Footer: top-level views as a compact icon row */}
      <div className="mt-1 flex shrink-0 items-center justify-between border-t border-hair px-3 pt-2">
        <FooterView view="system" label="System (ports + processes)" icon={<Activity size={16} />} topView={topView} onClick={setTopView} />
        <FooterView view="board" label="Task board" icon={<Kanban size={16} />} topView={topView} onClick={setTopView} />
        <FooterView view="digest" label="Daily digest" icon={<Newspaper size={16} />} topView={topView} onClick={setTopView} />
        <FooterView view="ai" label="AI Admin" icon={<Sparkles size={16} />} topView={topView} onClick={setTopView} />
        <FooterView view="costs" label="Costs" icon={<DollarSign size={16} />} topView={topView} onClick={setTopView} />
        <Tooltip label="Settings" side="top">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-t3 transition-colors hover:bg-raised hover:text-t1"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </Tooltip>
      </div>

      <ResizeHandle />
    </aside>
  );
}

// Top-of-rail navigation row (Library / Inbox / root project).
function NavRow({
  icon,
  label,
  hint,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left transition-colors",
        active ? "bg-raised text-t1" : "text-t2 hover:bg-raised hover:text-t1",
      )}
    >
      <span className={cn("flex w-5 justify-center", active ? "text-t1" : "text-t3 group-hover:text-t1")}>
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px] font-medium">{label}</span>
      {trailing}
      {hint && (
        <span className="text-[10px] text-t3 opacity-0 transition-opacity group-hover:opacity-100">
          {hint}
        </span>
      )}
    </button>
  );
}

function ProjectRow({
  project: p,
  stats,
  active,
  onOpen,
  onClose,
  onCloseOthers,
}: {
  project: {
    id: string;
    name: string;
    branch: string | null;
    dirtyCount: number | null;
  };
  stats: ProjectSessionStats | undefined;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onOpen();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose();
          }}
          className={cn(
            "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors",
            active ? "bg-raised" : "hover:bg-raised/60",
          )}
        >
          {active && (
            <span className="pointer-events-none absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--accent)]" />
          )}
          {/* Avatar + status dot */}
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
                  "pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-panel",
                  stats.attention
                    ? "bg-[color:var(--warn)]"
                    : "bg-[color:var(--ok)] deck-pulse",
                )}
              />
            )}
          </span>

          {/* Name + meta */}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-[13px] font-medium leading-5",
                active ? "text-t1" : "text-t2 group-hover:text-t1",
              )}
            >
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
                <span className="shrink-0 text-[color:var(--warn)]">
                  {p.dirtyCount}±
                </span>
              )}
              {stats && (
                <span
                  className={cn(
                    "shrink-0",
                    stats.attention
                      ? "text-[color:var(--warn)]"
                      : "text-[color:var(--ok)]",
                  )}
                >
                  {stats.attention
                    ? "needs input"
                    : `${stats.running} agent${stats.running > 1 ? "s" : ""}`}
                </span>
              )}
            </span>
          </span>

          {/* Close (hover) */}
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
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.revealProject(p.id)}
          >
            <FolderOpen size={14} /> Open in Explorer
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.openInWebstorm(p.id)}
          >
            <Code2 size={14} /> Open in WebStorm
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function FooterView({
  view,
  label,
  icon,
  topView,
  onClick,
}: {
  view: TopView;
  label: string;
  icon: React.ReactNode;
  topView: TopView | null;
  onClick: (v: TopView) => void;
}) {
  const active = topView === view;
  return (
    <Tooltip label={label} side="top">
      <button
        onClick={() => onClick(view)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors",
          active ? "bg-raised text-t1" : "text-t3 hover:bg-raised hover:text-t1",
        )}
        aria-label={label}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// Right-edge drag handle: the rail starts at x=0, so pointer clientX is the
// desired width (setSidebarWidth clamps to 200–420).
function ResizeHandle() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        const move = (ev: PointerEvent) => setSidebarWidth(ev.clientX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className="absolute -right-px top-0 z-10 h-full w-[3px] cursor-col-resize transition-colors hover:bg-[color:var(--accent)]"
    />
  );
}
