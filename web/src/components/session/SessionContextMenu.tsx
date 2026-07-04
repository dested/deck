import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { FolderPlus, Users, X, RotateCw, LogOut } from "lucide-react";
import type { Session } from "@deck/shared";
import { api } from "../../lib/api";
import { useSessionsStore } from "../../stores/sessionsStore";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuItemDanger,
  menuSeparator,
  menuLabel,
} from "../ui/menuStyles";

// Right-click menu for session rows/cards: group assignment, restart, kill.
export function SessionContextMenu({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const groups = useSessionsStore((s) => s.groups);
  const addGroup = useSessionsStore((s) => s.addGroup);

  const newGroupWith = async () => {
    const g = await api.createGroup("New group");
    addGroup(g);
    await api.assignGroup(g.id, session.id);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          <div className={menuLabel}>Move to group</div>
          {groups.map((g) => (
            <ContextMenu.Item
              key={g.id}
              className={menuItem}
              disabled={g.id === session.groupId}
              onSelect={() => api.assignGroup(g.id, session.id)}
            >
              <Users size={14} /> {g.name}
            </ContextMenu.Item>
          ))}
          <ContextMenu.Item className={menuItem} onSelect={newGroupWith}>
            <FolderPlus size={14} /> New group…
          </ContextMenu.Item>
          {session.groupId && (
            <ContextMenu.Item
              className={menuItem}
              onSelect={() => api.ungroupSession(session.id)}
            >
              <LogOut size={14} /> Remove from group
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className={menuSeparator} />
          {session.source === "owned" && session.kind === "claude" && (
            <ContextMenu.Item
              className={menuItem}
              onSelect={() => void api.restartSession(session.id).catch(() => {})}
            >
              <RotateCw size={14} /> Restart
            </ContextMenu.Item>
          )}
          {session.source === "owned" && (
            <ContextMenu.Item
              className={menuItemDanger}
              onSelect={() => void api.killSession(session.id).catch(() => {})}
            >
              <X size={14} /> Kill
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
