import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen,
  Copy,
  Bot,
  SquareTerminal,
  ChevronDown,
  GitBranch,
  Files,
  BookOpen,
  X,
  Plus,
  PanelLeft,
  Code2,
  MonitorPlay,
  Layers,
  type LucideIcon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { api } from "../lib/api";
import { spawnSession, closeSession, displayTitle } from "../lib/sessions";
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
import { NotesTab } from "../components/project/NotesTab";
import { PreviewTab } from "../components/project/PreviewTab";
import { StackTab } from "../components/project/StackTab";
import { SessionView } from "./SessionView";

const VIEW_META: Record<ProjectViewKind, { label: string; icon: LucideIcon }> = {
  agents: { label: "Agents", icon: Bot },
  notes: { label: "Notes", icon: BookOpen },
  preview: { label: "Preview", icon: MonitorPlay },
  stack: { label: "Stack", icon: Layers },
  git: { label: "Git", icon: GitBranch },
  files: { label: "Files", icon: Files },
};

const NORMAL_VIEWS: ProjectViewKind[] = [
  "agents",
  "notes",
  "preview",
  "stack",
  "git",
  "files",
];
const ROOT_VIEWS: ProjectViewKind[] = ["agents"];

export function ProjectShell({ projectId }: { projectId: string }) {
  const project = useProjectsStore((s) => s.byId[projectId]);
  const tabState = useUIStore((s) => s.projectTabs[projectId]);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const ensureProjectViews = useUIStore((s) => s.ensureProjectViews);
  const isRoot = project?.kind === "root";

  // M10: root has no git watcher. Others keep their repo watcher + live status.
  useEffect(() => {
    if (isRoot) return;
    eventsClient.subscribe([`git:${projectId}`]);
    return () => eventsClient.unsubscribe([`git:${projectId}`]);
  }, [projectId, isRoot]);

  // M16/M10: make sure the tab strip has the right view tabs for this kind
  // (adds "notes" to older projects; keeps root to agents-only).
  useEffect(() => {
    ensureProjectViews(projectId, isRoot ? ROOT_VIEWS : NORMAL_VIEWS);
  }, [projectId, isRoot, ensureProjectViews]);

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
        {!isRoot && p.branch && (
          <span className="mono rounded-[4px] bg-raised px-1.5 py-0.5 text-[11px] text-t2">
            {p.branch}
          </span>
        )}
        {!isRoot && p.dirtyCount != null && p.dirtyCount > 0 && (
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
          {!isRoot && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => api.openInWebstorm(projectId)}
            >
              <Code2 size={14} /> WebStorm
            </Button>
          )}
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
        <TabStrip
          key={projectId}
          projectId={projectId}
          tabs={tabs}
          activeTabId={activeTabId}
          onNewSession={newSession}
        />
      </div>

      {/* Active tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab?.kind === "view" && activeTab.view === "agents" && (
          <AgentsTab projectId={projectId} />
        )}
        {activeTab?.kind === "view" && activeTab.view === "notes" && (
          <NotesTab projectId={projectId} />
        )}
        {activeTab?.kind === "view" && activeTab.view === "preview" && (
          <PreviewTab projectId={projectId} />
        )}
        {activeTab?.kind === "view" && activeTab.view === "stack" && (
          <StackTab projectId={projectId} />
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

function TabStrip({
  tabs,
  activeTabId,
  onNewSession,
}: {
  projectId: string;
  tabs: ProjectTab[];
  activeTabId: string;
  onNewSession: (kind: "claude" | "shell") => void;
}) {
  const reorderTab = useUIStore((s) => s.reorderTab);
  // Which tab is being dragged, and which tab we'd drop before. `null` overId
  // while dragging means "drop at the end" (over empty strip space).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  return (
    <div
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      onDragOver={(e) => {
        if (dragId) {
          e.preventDefault();
          setOverId(null); // hovering empty space → append
        }
      }}
      onDrop={(e) => {
        if (dragId) {
          e.preventDefault();
          reorderTab(dragId, null);
          endDrag();
        }
      }}
    >
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          dragging={dragId === tab.id}
          dropBefore={dragId != null && overId === tab.id && dragId !== tab.id}
          onDragStart={() => setDragId(tab.id)}
          onDragEnterTab={() => dragId && setOverId(tab.id)}
          onDropOnTab={() => {
            if (dragId) {
              reorderTab(dragId, tab.id);
              endDrag();
            }
          }}
          onDragEnd={endDrag}
        />
      ))}
      <NewTabButton onNewSession={onNewSession} />
    </div>
  );
}

function NewTabButton({
  onNewSession,
}: {
  onNewSession: (kind: "claude" | "shell") => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex w-8 shrink-0 items-center justify-center border-r border-hair text-t3 hover:bg-raised hover:text-t1"
          aria-label="New session"
          title="New session or terminal"
        >
          <Plus size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={menuContent}
          style={menuContentStyle}
        >
          <DropdownMenu.Item
            className={menuItem}
            onSelect={() => onNewSession("claude")}
          >
            <Bot size={14} /> Claude session
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItem}
            onSelect={() => onNewSession("shell")}
          >
            <SquareTerminal size={14} /> Terminal
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function TabButton({
  tab,
  active,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnterTab,
  onDropOnTab,
  onDragEnd,
}: {
  tab: ProjectTab;
  active: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnterTab: () => void;
  onDropOnTab: () => void;
  onDragEnd: () => void;
}) {
  const activateTab = useUIStore((s) => s.activateTab);
  const closeTab = useUIStore((s) => s.closeTab);
  const sessions = useSessionsStore((s) => s.byId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const closable = tab.kind === "session";
  const renamable = tab.kind === "session";
  const session = tab.kind === "session" ? sessions[tab.sessionId] : undefined;

  let icon: React.ReactNode;
  let text: string;
  if (tab.kind === "view") {
    const meta = VIEW_META[tab.view];
    const Icon = meta.icon;
    icon = <Icon size={13} className="shrink-0 text-t3" />;
    text = meta.label;
  } else {
    icon = session ? (
      <StatusDot status={session.status} />
    ) : (
      <Bot size={13} className="shrink-0 text-t3" />
    );
    text = session ? displayTitle(session) : "Session";
  }
  const tabTooltip =
    session && (session.aiMeta?.summary || session.name)
      ? [session.aiMeta?.summary, session.name].filter(Boolean).join(" · ")
      : undefined;

  // Closing a session tab CLOSES THE AGENT (kills an owned pty / dismisses an
  // external one) — not just hides the tab. `closeSession` also drops the tab.
  // Only fall back to a bare tab-remove if the session isn't loaded yet.
  const closeThisTab = () => {
    if (tab.kind === "session" && session) closeSession(session);
    else closeTab(tab.id);
  };

  const startRename = () => {
    if (!renamable || !session) return;
    setName(session.name);
    setEditing(true);
  };
  const commitName = () => {
    setEditing(false);
    const n = name.trim();
    if (session && n && n !== session.name)
      void api.renameSession(session.id, n).catch(() => {});
  };

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnterTab();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropOnTab();
      }}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => {
        if (e.button === 1 && closable) {
          e.preventDefault();
          closeThisTab();
        }
      }}
      onClick={() => !editing && activateTab(tab.id)}
      onDoubleClick={startRename}
      title={tabTooltip}
      className={cn(
        "group relative flex h-full min-w-0 max-w-[220px] cursor-default items-center gap-1.5 border-r border-hair px-3 text-[12.5px] transition-colors",
        dropBefore && "border-l-2 border-l-[color:var(--accent)]",
        dragging && "opacity-40",
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
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-5 min-w-0 flex-1 rounded-[4px] border border-hairfocus bg-raised px-1 text-[12.5px] text-t1 focus:outline-none"
        />
      ) : (
        <span className="truncate">{text}</span>
      )}
      {closable && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeThisTab();
          }}
          className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-t3 opacity-0 hover:bg-hair hover:text-t1 group-hover:opacity-100"
          aria-label="Close session"
          title="Close session (kills the agent)"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
