import { Maximize2, X } from "lucide-react";
import type { Session } from "@deck/shared";
import { useSessionsStore, selectSessions, isLive } from "../stores/sessionsStore";
import { useUIStore } from "../stores/uiStore";
import { Terminal } from "../components/terminal/Terminal";
import { Feed } from "../components/feed/Feed";
import { StatusDot } from "../components/ui/StatusDot";
import { EmptyState } from "../components/ui/EmptyState";
import { api } from "../lib/api";
import { LayoutGrid } from "lucide-react";

// §9.5 — watch 2–6 of a group's sessions at once. Cap 6 (chooser beyond).
export function GridView({ groupId }: { groupId: string }) {
  const byId = useSessionsStore((s) => s.byId);
  const groups = useSessionsStore((s) => s.groups);
  const group = groups.find((g) => g.id === groupId);
  const sessions = selectSessions(byId)
    .filter((s) => s.groupId === groupId && isLive(s))
    .slice(0, 6);

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid size={22} />}
        title={group ? `${group.name} is empty` : "Group not found"}
        hint="Assign live sessions to this group to watch them side by side."
      />
    );
  }

  const cols = sessions.length <= 1 ? 1 : sessions.length <= 4 ? 2 : 3;

  return (
    <div
      className="grid h-full gap-2 p-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: "minmax(0, 1fr)",
      }}
    >
      {sessions.map((s) => (
        <Cell key={s.id} session={s} />
      ))}
    </div>
  );
}

function Cell({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-hair bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-hair px-2.5">
        <StatusDot status={session.status} />
        <button
          onClick={() => openSession(session.id)}
          className="truncate text-[12px] text-t1 hover:text-accenttext"
        >
          {session.name}
        </button>
        <span className="truncate text-[11px] text-t3">{session.projectId}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => openSession(session.id)}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
            aria-label="Open full"
          >
            <Maximize2 size={12} />
          </button>
          {session.source === "owned" && (
            <button
              onClick={() => void api.killSession(session.id).catch(() => {})}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-[color:var(--err)]"
              aria-label="Kill"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {session.source === "owned" ? (
          <Terminal sessionId={session.ptyId ?? session.id} claudeNewline={session.kind === "claude"} />
        ) : (
          <Feed sessionId={session.id} transcriptId={session.transcriptSessionId} />
        )}
      </div>
    </div>
  );
}
