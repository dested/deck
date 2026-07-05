import { useMemo } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  LayoutGrid,
  Settings,
  DollarSign,
  X,
  FolderOpen,
  Code2,
} from "lucide-react";
import { useProjectsStore } from "../stores/projectsStore";
import {
  useSessionsStore,
  selectProjectStats,
} from "../stores/sessionsStore";
import { useUIStore } from "../stores/uiStore";
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

// The rail: a thin Discord-style strip of OPEN projects. The full project list
// lives in the Library (Home); the rail is only what you're working on now.
export function Rail() {
  const byId = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const openProjects = useUIStore((s) => s.openProjects);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const costsOpen = useUIStore((s) => s.costsOpen);
  const goHome = useUIStore((s) => s.goHome);
  const openProject = useUIStore((s) => s.openProject);
  const closeRailProject = useUIStore((s) => s.closeRailProject);
  const setCostsOpen = useUIStore((s) => s.setCostsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const stats = useMemo(() => selectProjectStats(sessions), [sessions]);

  // A restored session (pre-rail localStorage) may have an active project that
  // was never added to openProjects — always show it.
  const railIds = useMemo(() => {
    const ids = [...openProjects];
    if (activeProjectId && !ids.includes(activeProjectId))
      ids.push(activeProjectId);
    return ids.filter((id) => byId[id]);
  }, [openProjects, activeProjectId, byId]);

  const homeActive = activeProjectId === null && !costsOpen;

  return (
    <aside className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-hair bg-panel py-2">
      {/* Home / Library */}
      <Tooltip label="Library" side="right">
        <button
          onClick={goHome}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors",
            homeActive
              ? "bg-raised text-t1"
              : "text-t3 hover:bg-raised hover:text-t1",
          )}
        >
          <LayoutGrid size={18} />
          {homeActive && <ActiveBar />}
        </button>
      </Tooltip>

      <div className="my-2 h-px w-7 shrink-0 bg-hair" />

      {/* Open projects */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-1 [scrollbar-width:none]">
        {railIds.map((id) => {
          const p = byId[id]!;
          const st = stats.get(id);
          const active = id === activeProjectId && !costsOpen;
          return (
            <ContextMenu.Root key={id}>
              <ContextMenu.Trigger asChild>
                <div className="relative">
                  <Tooltip label={p.name} side="right">
                    <button
                      onClick={() => openProject(id)}
                      onAuxClick={(e) => {
                        if (e.button === 1) closeRailProject(id);
                      }}
                      className={cn(
                        "relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-[10px] text-[12px] font-bold text-white/85 transition-all",
                        active
                          ? "ring-1 ring-[color:var(--accent)]"
                          : "opacity-80 hover:opacity-100",
                      )}
                      style={{ background: projectGradient(p.name) }}
                    >
                      {projectInitials(p.name)}
                    </button>
                  </Tooltip>
                  {active && <ActiveBar />}
                  {st && (
                    <span
                      className={cn(
                        "pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel",
                        st.attention
                          ? "bg-[color:var(--warn)]"
                          : "bg-[color:var(--ok)] deck-pulse",
                      )}
                    />
                  )}
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className={menuContent}
                  style={menuContentStyle}
                >
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => closeRailProject(id)}
                  >
                    <X size={14} /> Close
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => {
                      for (const other of railIds)
                        if (other !== id) closeRailProject(other);
                      openProject(id);
                    }}
                  >
                    <X size={14} /> Close others
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={menuSeparator} />
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => api.revealProject(id)}
                  >
                    <FolderOpen size={14} /> Open in Explorer
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => api.openInWebstorm(id)}
                  >
                    <Code2 size={14} /> Open in WebStorm
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
        <Tooltip label="Costs" side="right">
          <button
            onClick={() => setCostsOpen(true)}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors",
              costsOpen
                ? "bg-raised text-t1"
                : "text-t3 hover:bg-raised hover:text-t1",
            )}
          >
            <DollarSign size={16} />
            {costsOpen && <ActiveBar />}
          </button>
        </Tooltip>
        <Tooltip label="Settings" side="right">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-t3 transition-colors hover:bg-raised hover:text-t1"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function ActiveBar() {
  return (
    <span className="pointer-events-none absolute -left-[6px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--accent)]" />
  );
}
