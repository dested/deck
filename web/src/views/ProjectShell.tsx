import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen,
  Copy,
  Bot,
  SquareTerminal,
  ChevronDown,
  GitBranch,
  Files,
  X,
  PanelLeft,
  Code2,
  type LucideIcon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { api } from "../lib/api";
import { spawnSession } from "../lib/sessions";
import { eventsClient } from "../lib/ws";
import { useProjectsStore } from "../stores/projectsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import {
  useUIStore,
  type ProjectTab,
  type ProjectViewKind,
} from "../stores/uiStore";
import { relTime } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Tooltip } from "../components/ui/Tooltip";
import { StatusDot } from "../components/ui/StatusDot";
import { cn } from "../lib/cn";
import {
  menuContent,
  menuContentStyle,
  menuItem,
} from "../components/ui/menuStyles";
import { AgentsTab } from "../components/project/AgentsTab";
import { GitTab } from "../components/git/GitTab";
import { FilesTab } from "../components/project/FilesTab";
import { SessionView } from "./SessionView";

const VIEW_META: Record<ProjectViewKind, { label: string; icon: LucideIcon }> = {
  agents: { label: "Agents", icon: Bot },
  git: { label: "Git", icon: GitBranch },
  files: { label: "Files", icon: Files },
};

export function ProjectShell({ projectId }: { projectId: string }) {
  const project = useProjectsStore((s) => s.byId[projectId]);
  const tabState = useUIStore((s) => s.projectTabs[projectId]);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Keep this project's repo watcher + live git status running while it's open.
  useEffect(() => {
    eventsClient.subscribe([`git:${projectId}`]);
    return () => eventsClient.unsubscribe([`git:${projectId}`]);
  }, [projectId]);

  const { data: detail, isError, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.project(projectId),
    retry: false,
  });

  const p = project ?? detail;
  if (!p) {
    if (isError || (!isLoading && !detail)) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <div className="text-[14px] font-medium text-t1">
            Project not found
          </div>
          <div className="text-[13px] text-t2">
            {projectId} may have been moved or deleted.
          </div>
        </div>
      );
    }
    return <div className="p-6 text-[13px] text-t3">Loading project…</div>;
  }

  const tabs = tabState?.tabs ?? [];
  const activeTabId = tabState?.activeTabId ?? "";
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const newSession = (kind: "claude" | "shell") =>
    void spawnSession(projectId, kind).catch(() => {});

  return (
    <div className="flex h-full flex-col">
      {/* Header strip */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
        <span className="text-[14px] font-semibold text-t1">{p.name}</span>
        {p.branch && (
          <span className="mono rounded-[4px] bg-raised px-1.5 py-0.5 text-[11px] text-t2">
            {p.branch}
          </span>
        )}
        {p.dirtyCount != null && p.dirtyCount > 0 && (
          <span className="mono text-[11px] text-t2">{p.dirtyCount} changed</span>
        )}
        <span className="mono text-[11px] text-t3">{relTime(p.activityAt)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button size="sm" variant="default">
                New session <ChevronDown size={13} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className={menuContent}
                style={menuContentStyle}
              >
                <DropdownMenu.Item
                  className={menuItem}
                  onSelect={() => newSession("claude")}
                >
                  <Bot size={14} /> Claude session
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItem}
                  onSelect={() => newSession("shell")}
                >
                  <SquareTerminal size={14} /> Terminal
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => api.revealProject(projectId)}
          >
            <FolderOpen size={14} /> Explorer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => api.openInWebstorm(projectId)}
          >
            <Code2 size={14} /> WebStorm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigator.clipboard?.writeText(p.path)}
          >
            <Copy size={14} /> Copy path
          </Button>
        </div>
      </div>

      {/* Per-project tab strip */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-hair bg-panel">
        {collapsed && (
          <Tooltip label="Show sidebar (Ctrl+B)">
            <button
              onClick={toggleSidebar}
              className="flex w-9 shrink-0 items-center justify-center border-r border-hair text-t3 hover:bg-raised hover:text-t1"
              aria-label="Show sidebar"
            >
              <PanelLeft size={14} />
            </button>
          </Tooltip>
        )}
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => (
            <TabButton key={tab.id} tab={tab} active={tab.id === activeTabId} />
          ))}
        </div>
      </div>

      {/* Active tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab?.kind === "view" && activeTab.view === "agents" && (
          <AgentsTab projectId={projectId} />
        )}
        {activeTab?.kind === "view" && activeTab.view === "git" && (
          <GitTab projectId={projectId} />
        )}
        {activeTab?.kind === "view" && activeTab.view === "files" && (
          <FilesTab projectId={projectId} />
        )}
        {activeTab?.kind === "session" && (
          <SessionView key={activeTab.sessionId} sessionId={activeTab.sessionId} />
        )}
      </div>
    </div>
  );
}

function TabButton({ tab, active }: { tab: ProjectTab; active: boolean }) {
  const activateTab = useUIStore((s) => s.activateTab);
  const closeTab = useUIStore((s) => s.closeTab);
  const sessions = useSessionsStore((s) => s.byId);

  const closable = tab.kind === "session";
  let icon: React.ReactNode;
  let text: string;
  if (tab.kind === "view") {
    const meta = VIEW_META[tab.view];
    const Icon = meta.icon;
    icon = <Icon size={13} className="shrink-0 text-t3" />;
    text = meta.label;
  } else {
    const s = sessions[tab.sessionId];
    icon = s ? (
      <StatusDot status={s.status} />
    ) : (
      <Bot size={13} className="shrink-0 text-t3" />
    );
    text = s?.name ?? "Session";
  }

  return (
    <div
      onMouseDown={(e) => {
        if (e.button === 1 && closable) {
          e.preventDefault();
          closeTab(tab.id);
        }
      }}
      onClick={() => activateTab(tab.id)}
      className={cn(
        "group relative flex h-full min-w-0 max-w-[220px] cursor-default items-center gap-1.5 border-r border-hair px-3 text-[12.5px] transition-colors",
        active
          ? "bg-root text-t1"
          : "bg-panel text-t2 hover:bg-raised hover:text-t1",
      )}
    >
      {active && (
        <span
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: "var(--accent)" }}
        />
      )}
      {icon}
      <span className="truncate">{text}</span>
      {closable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-t3 opacity-0 hover:bg-hair hover:text-t1 group-hover:opacity-100"
          aria-label="Close tab"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
