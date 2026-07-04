import { useEffect } from "react";
import { api } from "./lib/api";
import { useProjectsStore } from "./stores/projectsStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useUIStore } from "./stores/uiStore";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Sidebar } from "./components/Sidebar";
import { ProjectShell } from "./views/ProjectShell";
import { HomeView } from "./views/HomeView";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { useGlobalKeys } from "./lib/useGlobalKeys";
import { useAttentionBadge } from "./lib/useAttentionBadge";
import { useNotifications } from "./lib/useNotifications";

export function App() {
  const setProjects = useProjectsStore((s) => s.setAll);
  const setSessions = useSessionsStore((s) => s.setAll);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const width = useUIStore((s) => s.sidebarWidth);
  const activeProjectId = useUIStore((s) => s.activeProjectId);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
    api.sessions().then(setSessions).catch(() => {});
  }, [setProjects, setSessions]);

  useGlobalKeys();
  useAttentionBadge();
  useNotifications();

  return (
    <TooltipProvider>
      <div className="flex h-full w-full overflow-hidden bg-root text-t1">
        {!collapsed && (
          <div style={{ width }} className="h-full shrink-0">
            <Sidebar />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {activeProjectId ? (
            <ProjectShell key={activeProjectId} projectId={activeProjectId} />
          ) : (
            <HomeView />
          )}
        </div>
      </div>
      <CommandPalette />
      <SettingsDialog />
    </TooltipProvider>
  );
}
