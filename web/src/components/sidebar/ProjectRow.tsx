import * as ContextMenu from "@radix-ui/react-context-menu";
import { Pin, PinOff, EyeOff, Bot, SquareTerminal, FolderOpen, Copy, Zap } from "lucide-react";
import type { ProjectSummary } from "@deck/shared";
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
}: {
  project: ProjectSummary;
  active: boolean;
  stats?: ProjectSessionStats;
  lastOpenedAt?: number;
}) {
  const openProject = useUIStore((s) => s.openProject);

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
            onSelect={() => navigator.clipboard?.writeText(project.path)}
          >
            <Copy size={14} /> Copy path
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
