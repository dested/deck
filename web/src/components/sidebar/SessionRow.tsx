import { useState } from "react";
import { Bot, SquareTerminal } from "lucide-react";
import type { Session } from "@deck/shared";
import { cn } from "../../lib/cn";
import { StatusDot } from "../ui/StatusDot";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/api";
import { SessionContextMenu } from "../session/SessionContextMenu";

export function SessionRow({
  session,
  active,
  showProject,
}: {
  session: Session;
  active: boolean;
  showProject: boolean;
}) {
  const openSession = useUIStore((s) => s.openSession);
  const Icon = session.kind === "claude" ? Bot : SquareTerminal;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session.name);

  const commitName = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== session.name) void api.renameSession(session.id, n).catch(() => {});
  };

  if (editing) {
    return (
      <div className="flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2">
        <StatusDot status={session.status} />
        <Icon size={13} className="shrink-0 text-t3" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setName(session.name);
              setEditing(false);
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-[4px] border border-hairfocus bg-raised px-1.5 text-[13px] text-t1 focus:outline-none"
        />
      </div>
    );
  }

  return (
    <SessionContextMenu
      session={session}
      onRename={() => {
        setName(session.name);
        setEditing(true);
      }}
    >
    <button
      onClick={() => openSession(session.id)}
      className={cn(
        "group flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px]",
        "transition-colors",
        session.status === "attention" &&
          "border-l-2 border-[color:var(--warn)] pl-[6px]",
        active ? "bg-raised text-t1" : "text-t2 hover:bg-raised hover:text-t1",
      )}
    >
      <StatusDot status={session.status} />
      <Icon size={13} className="shrink-0 text-t3" />
      <span className="truncate">{session.name}</span>
      {showProject && (
        <span className="truncate text-[11px] text-t3">{session.projectId}</span>
      )}
      {session.unread && (
        <span
          className="ml-auto h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ background: "var(--accent)" }}
        />
      )}
    </button>
    </SessionContextMenu>
  );
}
