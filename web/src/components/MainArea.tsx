import { useUIStore } from "../stores/uiStore";
import { HomeView } from "../views/HomeView";
import { ProjectView } from "../views/ProjectView";
import { SessionView } from "../views/SessionView";
import { GridView } from "../views/GridView";

// Renders the active tab's view. Inactive tabs are unmounted EXCEPT we keep
// session/grid terminals alive via the PTY-reattach model (§5), so remounting
// is cheap and safe.
export function MainArea() {
  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-root">
      {tab.kind === "home" && <HomeView />}
      {tab.kind === "project" && (
        <ProjectView key={tab.id} projectId={tab.projectId} tabId={tab.id} />
      )}
      {tab.kind === "session" && (
        <SessionView key={tab.id} sessionId={tab.sessionId} />
      )}
      {tab.kind === "grid" && <GridView key={tab.id} groupId={tab.groupId} />}
    </main>
  );
}
