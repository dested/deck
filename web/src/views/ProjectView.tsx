import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Copy, Bot, SquareTerminal, ChevronDown } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { api } from "../lib/api";
import { spawnSession } from "../lib/sessions";
import { eventsClient } from "../lib/ws";
import { useProjectsStore } from "../stores/projectsStore";
import { useUIStore, type ProjectSubtab } from "../stores/uiStore";
import { relTime } from "../lib/format";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { menuContent, menuContentStyle, menuItem } from "../components/ui/menuStyles";
import { AgentsTab } from "../components/project/AgentsTab";
import { GitTab } from "../components/git/GitTab";
import { FilesTab } from "../components/project/FilesTab";
import { TerminalsTab } from "../components/project/TerminalsTab";

const SUBTABS: { key: ProjectSubtab; label: string }[] = [
  { key: "agents", label: "Agents" },
  { key: "git", label: "Git" },
  { key: "files", label: "Files" },
  { key: "terminals", label: "Terminals" },
];

export function ProjectView({
  projectId,
  tabId,
}: {
  projectId: string;
  tabId: string;
}) {
  const project = useProjectsStore((s) => s.byId[projectId]);
  const tab = useUIStore((s) => s.tabs.find((t) => t.id === tabId));
  const setSubtab = useUIStore((s) => s.setProjectSubtab);
  const subtab: ProjectSubtab =
    tab && tab.kind === "project" ? tab.subtab : "agents";

  // Subscribe to this project's git topic while open (drives repo watcher + live).
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
          <div className="text-[14px] font-medium text-t1">Project not found</div>
          <div className="text-[13px] text-t2">
            {projectId} may have been moved or deleted. Close this tab (Ctrl+W).
          </div>
        </div>
      );
    }
    return <div className="p-6 text-[13px] text-t3">Loading project…</div>;
  }

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
          <span className="mono text-[11px] text-t2">
            {p.dirtyCount} changed
          </span>
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
                <DropdownMenu.Item className={menuItem} onSelect={() => newSession("claude")}>
                  <Bot size={14} /> Claude session
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menuItem} onSelect={() => newSession("shell")}>
                  <SquareTerminal size={14} /> Terminal
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button size="sm" variant="ghost" onClick={() => api.revealProject(projectId)}>
            <FolderOpen size={14} /> Explorer
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

      {/* Subtab bar */}
      <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-hair px-4">
        {SUBTABS.map((st) => (
          <button
            key={st.key}
            onClick={() => setSubtab(tabId, st.key)}
            className={cn(
              "relative flex items-center px-3 text-[12.5px] transition-colors",
              subtab === st.key ? "text-t1" : "text-t2 hover:text-t1",
            )}
          >
            {st.label}
            {subtab === st.key && (
              <span
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Subtab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {subtab === "agents" && <AgentsTab projectId={projectId} />}
        {subtab === "git" && <GitTab projectId={projectId} />}
        {subtab === "files" && <FilesTab projectId={projectId} />}
        {subtab === "terminals" && <TerminalsTab projectId={projectId} />}
      </div>
    </div>
  );
}
