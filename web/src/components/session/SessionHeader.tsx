import { useState, type ReactNode } from "react";
import { RotateCw, X } from "lucide-react";
import type { Session } from "@deck/shared";
import { StatusDot } from "../ui/StatusDot";
import { IconButton } from "../ui/IconButton";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/api";
import { closeSession } from "../../lib/sessions";
import { useSessionCost } from "../../lib/useCost";
import { fmtUsd } from "../../lib/format";

// M2: dot, editable name, project link, kill. Restart/adopt/group added in M4.
export function SessionHeader({
  session,
  right,
}: {
  session: Session;
  right?: ReactNode;
}) {
  const openProject = useUIStore((s) => s.openProject);
  const cost = useSessionCost(session.transcriptSessionId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session.name);

  const commitName = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== session.name) void api.renameSession(session.id, n);
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
      <StatusDot status={session.status} />
      {editing ? (
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
          className="h-7 rounded-[5px] border border-hairfocus bg-raised px-2 text-[13px] text-t1 focus:outline-none"
        />
      ) : (
        <div className="flex min-w-0 flex-col justify-center">
          <button
            onClick={() => {
              setName(session.name);
              setEditing(true);
            }}
            className="truncate text-left text-[14px] font-semibold leading-tight text-t1 hover:text-accenttext"
          >
            {session.name}
          </button>
          {session.aiMeta?.summary && (
            <span className="truncate text-[11px] leading-tight text-t3">
              {session.aiMeta.summary}
            </span>
          )}
        </div>
      )}
      <button
        onClick={() => openProject(session.projectId)}
        className="text-[12px] text-t2 hover:text-t1"
      >
        {session.projectId}
      </button>
      {session.source === "external" && (
        <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-t3">
          external
        </span>
      )}
      {cost && cost.cost > 0 && (
        <span
          className="mono rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-accenttext"
          title="Session cost (ccusage)"
        >
          {fmtUsd(cost.cost)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {right}
        {session.source === "owned" && session.kind === "claude" && (
          <IconButton
            label="Restart"
            onClick={() => void api.restartSession(session.id).catch(() => {})}
          >
            <RotateCw size={15} />
          </IconButton>
        )}
        <IconButton
          label={session.source === "owned" ? "Close" : "Dismiss"}
          danger
          onClick={() => closeSession(session)}
        >
          <X size={16} />
        </IconButton>
      </div>
    </div>
  );
}
