import { useEffect } from "react";
import { api } from "./lib/api";
import { useProjectsStore } from "./stores/projectsStore";
import { useProjectGroupsStore } from "./stores/projectGroupsStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useLibraryStore } from "./stores/libraryStore";
import { useUIStore } from "./stores/uiStore";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Rail } from "./components/Rail";
import { ProjectShell } from "./views/ProjectShell";
import { LibraryView } from "./views/LibraryView";
import { CostsDashboard } from "./components/cost/CostsDashboard";
import { AiAdminView } from "./views/AiAdminView";
import { DigestView } from "./views/DigestView";
import { BoardView } from "./views/BoardView";
import { SystemView } from "./views/SystemView";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { InboxPanel } from "./components/inbox/InboxPanel";
import { RecipesDialog } from "./components/recipes/RecipesDialog";
import { Toaster } from "./components/ui/Toast";
import { SearchDialog } from "./components/SearchDialog";
import { useGlobalKeys } from "./lib/useGlobalKeys";
import { useAttentionBadge } from "./lib/useAttentionBadge";
import { useNotifications } from "./lib/useNotifications";
import { useReviewsBootstrap } from "./stores/reviewsStore";
import { useTasksBootstrap } from "./stores/tasksStore";

export function App() {
  const setProjects = useProjectsStore((s) => s.setAll);
  const setGroups = useProjectGroupsStore((s) => s.setAll);
  const setSessions = useSessionsStore((s) => s.setAll);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const topView = useUIStore((s) => s.topView);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
    api.projectGroups().then(setGroups).catch(() => {});
    api.sessions().then(setSessions).catch(() => {});
    // Library enrichment (cards): inspections + live ports + screenshot times.
    // Live updates ride /ws/events; these endpoints 404 pre-server-restart.
    const lib = useLibraryStore.getState();
    api.inspections().then(lib.setInspections).catch(() => {});
    api.livePorts().then(lib.setLivePorts).catch(() => {});
    api.screenshotTimes().then(lib.setShots).catch(() => {});
  }, [setProjects, setGroups, setSessions]);

  useGlobalKeys();
  useAttentionBadge();
  useNotifications();
  useReviewsBootstrap();
  useTasksBootstrap();

  return (
    <TooltipProvider>
      <div className="flex h-full w-full overflow-hidden bg-root text-t1">
        {!collapsed && <Rail />}
        <div className="flex min-w-0 flex-1 flex-col">
          {topView === "costs" ? (
            <CostsDashboard />
          ) : topView === "ai" ? (
            <AiAdminView />
          ) : topView === "digest" ? (
            <DigestView />
          ) : topView === "board" ? (
            <BoardView />
          ) : topView === "system" ? (
            <SystemView />
          ) : activeProjectId ? (
            <ProjectShell key={activeProjectId} projectId={activeProjectId} />
          ) : (
            <LibraryView />
          )}
        </div>
        <InboxPanel />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <RecipesDialog />
      <SearchDialog />
      <Toaster />
    </TooltipProvider>
  );
}
