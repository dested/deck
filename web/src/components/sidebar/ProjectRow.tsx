import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Pin,
  PinOff,
  EyeOff,
  Bot,
  SquareTerminal,
  FolderOpen,
  Copy,
  Zap,
  Code2,
  FolderInput,
  ChevronRight,
  Check,
  FolderPlus,
  FolderMinus,
} from "lucide-react";
import type { ProjectSummary, Group } from "@deck/shared";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import { spawnSession } from "../../lib/sessions";
import { useUIStore } from "../../stores/uiStore";
import type { ProjectSessionStats } from "../../stores/sessionsStore";
import { relTime } from "../../lib/format";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuSeparator,
} from "../ui/menuStyles";

export function ProjectRow({
  project,
  active,
  stats,
  lastOpenedAt,
  groups = [],
}: {
  project: ProjectSummary;
  active: boolean;
  stats?: ProjectSessionStats;
  lastOpenedAt?: number;
  groups?: Group[];
}) {
  const openProject = useUIStore((s) => s.openProject);

  const moveToNewGroup = async () => {
    const g = await api.createProjectGroup("New group");
    await api.assignProjectGroup(g.id, project.id);
  };

  const newSession = (kind: "claude" | "shell") =>
    void spawnSession(project.id, kind).catch(() => {});

  const running = stats?.running ?? 0;
  const attention = stats?.attention ?? false;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          onClick={() => openProject(project.id)}
          className={cn(
            "group flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] transition-colors",
            attention && "border-l-2 border-[color:var(--warn)] pl-[6px]",
            active ? "bg-raised text-t1" : "text-t2 hover:bg-raised hover:text-t1",
          )}
        >
          {project.pinned && (
            <Pin size={11} className="shrink-0 text-t3" fill="currentColor" />
          )}
          <span className="truncate">{project.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {lastOpenedAt != null && (
              <span className="mono text-[10.5px] text-t3 opacity-0 transition-opacity group-hover:opacity-100">
                {relTime(lastOpenedAt)}
              </span>
            )}
            {running > 0 && (
              <span
                className={cn(
                  "flex items-center gap-0.5 tabular-nums",
                  attention ? "text-[color:var(--warn)]" : "text-[color:var(--ok)]",
                )}
              >
                <Zap size={11} className={cn(!attention && "deck-pulse")} fill="currentColor" />
                <span className="mono text-[11px]">{running}</span>
              </span>
            )}
            {project.dirtyCount != null && project.dirtyCount > 0 && (
              <span className="mono text-[11px] tabular-nums text-t2">
                {project.dirtyCount}
              </span>
            )}
          </span>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.pinProject(project.id, !project.pinned)}
          >
            {project.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {project.pinned ? "Unpin" : "Pin"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.hideProject(project.id, true)}
          >
            <EyeOff size={14} /> Hide
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={menuItem}>
              <FolderInput size={14} /> Move to group
              <ChevronRight size={13} className="ml-auto text-t3" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className={menuContent}
                style={menuContentStyle}
              >
                {groups.map((g) => (
                  <ContextMenu.Item
                    key={g.id}
                    className={menuItem}
                    onSelect={() => api.assignProjectGroup(g.id, project.id)}
                  >
                    {project.groupId === g.id ? (
                      <Check size={14} />
                    ) : (
                      <span className="w-[14px]" />
                    )}
                    <span className="truncate">{g.name}</span>
                  </ContextMenu.Item>
                ))}
                {groups.length > 0 && (
                  <ContextMenu.Separator className={menuSeparator} />
                )}
                {project.groupId && (
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => api.assignProjectGroup(null, project.id)}
                  >
                    <FolderMinus size={14} /> Remove from group
                  </ContextMenu.Item>
                )}
                <ContextMenu.Item className={menuItem} onSelect={moveToNewGroup}>
                  <FolderPlus size={14} /> New group…
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item className={menuItem} onSelect={() => newSession("claude")}>
            <Bot size={14} /> New Claude session
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => newSession("shell")}>
            <SquareTerminal size={14} /> New terminal
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.revealProject(project.id)}
          >
            <FolderOpen size={14} /> Open in Explorer
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.openInWebstorm(project.id)}
          >
            <Code2 size={14} /> Open in WebStorm
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => navigator.clipboard?.writeText(project.path)}
          >
            <Copy size={14} /> Copy path
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
