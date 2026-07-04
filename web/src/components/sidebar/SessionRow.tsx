import { Bot, SquareTerminal } from "lucide-react";
import type { Session } from "@deck/shared";
import { cn } from "../../lib/cn";
import { StatusDot } from "../ui/StatusDot";
import { useUIStore } from "../../stores/uiStore";
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
  return (
    <SessionContextMenu session={session}>
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
