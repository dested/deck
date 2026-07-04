import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { X, RotateCw, Pencil } from "lucide-react";
import type { Session } from "@deck/shared";
import { api } from "../../lib/api";
import { closeSession } from "../../lib/sessions";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuItemDanger,
  menuSeparator,
} from "../ui/menuStyles";

// Right-click menu for session rows/cards: rename, restart, and close (kill
// owned / dismiss external — every session can be gotten rid of). `onRename`,
// when given, lets the row host an inline edit instead of a prompt.
export function SessionContextMenu({
  session,
  children,
  onRename,
}: {
  session: Session;
  children: ReactNode;
  onRename?: () => void;
}) {
  const canRestart = session.source === "owned" && session.kind === "claude";
  const isExternal = session.source === "external";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          {onRename && (
            <ContextMenu.Item className={menuItem} onSelect={onRename}>
              <Pencil size={14} /> Rename
            </ContextMenu.Item>
          )}
          {canRestart && (
            <ContextMenu.Item
              className={menuItem}
              onSelect={() => void api.restartSession(session.id).catch(() => {})}
            >
              <RotateCw size={14} /> Restart
            </ContextMenu.Item>
          )}
          {(onRename || canRestart) && (
            <ContextMenu.Separator className={menuSeparator} />
          )}
          <ContextMenu.Item
            className={menuItemDanger}
            onSelect={() => closeSession(session)}
          >
            <X size={14} /> {isExternal ? "Dismiss" : "Kill"}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
