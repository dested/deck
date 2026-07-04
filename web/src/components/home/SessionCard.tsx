import { useState, useEffect } from "react";
import { Bot, SquareTerminal, X } from "lucide-react";
import type { Session } from "@deck/shared";
import { StatusDot } from "../ui/StatusDot";
import { useUIStore } from "../../stores/uiStore";
import { relTime } from "../../lib/format";
import { closeSession } from "../../lib/sessions";
import { cn } from "../../lib/cn";

export function SessionCard({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  const Icon = session.kind === "claude" ? Bot : SquareTerminal;
  const [, force] = useState(0);
  // Re-render relative timestamps every 15s.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <button
      onClick={() => openSession(session.id)}
      className={cn(
        "group flex flex-col gap-2 rounded-[8px] border bg-panel p-3 text-left transition-colors hover:border-hairfocus",
        session.status === "attention"
          ? "border-l-2 border-[color:var(--warn)]"
          : "border-hair",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={session.status} />
        <span className="truncate text-[13px] font-medium text-t1">
          {session.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeSession(session);
          }}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded-[4px] text-t3 opacity-0 hover:bg-hair hover:text-[color:var(--err)] group-hover:opacity-100"
          aria-label={session.source === "external" ? "Dismiss session" : "Kill session"}
        >
          <X size={13} />
        </button>
      </div>
      <div className="truncate text-[12px] text-t2">{session.projectId}</div>
      <div className="min-h-[18px] truncate text-[12.5px] text-t2">
        {session.lastActivityLine ?? (
          <span className="text-t3">—</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-t3">
        <Icon size={12} />
        <span className="mono text-[11px]">{relTime(session.activityAt)}</span>
      </div>
    </button>
  );
}
