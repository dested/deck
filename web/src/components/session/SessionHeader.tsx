import { useState, type ReactNode } from "react";
import { RotateCw, X } from "lucide-react";
import type { Session } from "@deck/shared";
import { StatusDot } from "../ui/StatusDot";
import { IconButton } from "../ui/IconButton";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/api";

// M2: dot, editable name, project link, kill. Restart/adopt/group added in M4.
export function SessionHeader({
  session,
  right,
}: {
  session: Session;
  right?: ReactNode;
}) {
  const openProject = useUIStore((s) => s.openProject);
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
        <button
          onClick={() => {
            setName(session.name);
            setEditing(true);
          }}
          className="text-[14px] font-semibold text-t1 hover:text-accenttext"
        >
          {session.name}
        </button>
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
        {session.source === "owned" && (
          <IconButton
            label="Kill"
            danger
            onClick={() => void api.killSession(session.id).catch(() => {})}
          >
            <X size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
