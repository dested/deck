import * as ContextMenu from "@radix-ui/react-context-menu";
import { Pin, PinOff, EyeOff, Bot, SquareTerminal, FolderOpen, Copy } from "lucide-react";
import type { ProjectSummary } from "@deck/shared";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import { spawnSession } from "../../lib/sessions";
import { useUIStore } from "../../stores/uiStore";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuSeparator,
} from "../ui/menuStyles";

export function ProjectRow({
  project,
  active,
}: {
  project: ProjectSummary;
  active: boolean;
}) {
  const openProject = useUIStore((s) => s.openProject);

  const newSession = (kind: "claude" | "shell") =>
    void spawnSession(project.id, kind).catch(() => {});

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          onClick={() => openProject(project.id)}
          className={cn(
            "group flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px]",
            "transition-colors",
            active
              ? "bg-raised text-t1"
              : "text-t2 hover:bg-raised hover:text-t1",
          )}
        >
          {project.pinned && (
            <Pin size={11} className="shrink-0 text-t3" fill="currentColor" />
          )}
          <span className="truncate">{project.name}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {project.runningSessionCount > 0 && (
              <span
                className="h-[6px] w-[6px] rounded-full deck-pulse"
                style={{ background: "var(--ok)" }}
              />
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
