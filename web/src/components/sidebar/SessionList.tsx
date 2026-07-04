import { useState } from "react";
import { ChevronRight, LayoutGrid } from "lucide-react";
import type { Session, Group } from "@deck/shared";
import { cn } from "../../lib/cn";
import { useSessionsStore, selectSessions, isLive } from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { SessionRow } from "./SessionRow";
import { Tooltip } from "../ui/Tooltip";

export function SessionList() {
  const byId = useSessionsStore((s) => s.byId);
  const groups = useSessionsStore((s) => s.groups);
  const activeTabId = useUIStore((s) => s.activeTabId);

  const sessions = selectSessions(byId).filter(isLive);
  const grouped = new Map<string, Session[]>();
  const ungrouped: Session[] = [];
  for (const s of sessions) {
    if (s.groupId) {
      const arr = grouped.get(s.groupId) ?? [];
      arr.push(s);
      grouped.set(s.groupId, arr);
    } else {
      ungrouped.push(s);
    }
  }

  const activeSessionId =
    activeTabId.startsWith("session:") ? activeTabId.slice("session:".length) : null;

  if (sessions.length === 0) {
    return (
      <div className="px-2 py-1 text-[12px] text-t3">No live sessions</div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map((g) => {
        const list = grouped.get(g.id) ?? [];
        if (list.length === 0) return null;
        return (
          <GroupBlock
            key={g.id}
            group={g}
            sessions={list}
            activeSessionId={activeSessionId}
          />
        );
      })}
      {ungrouped.length > 0 && groups.length > 0 && (
        <div className="mt-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3">
          Other
        </div>
      )}
      {ungrouped.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          active={s.id === activeSessionId}
          showProject
        />
      ))}
    </div>
  );
}

function GroupBlock({
  group,
  sessions,
  activeSessionId,
}: {
  group: Group;
  sessions: Session[];
  activeSessionId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const openGrid = useUIStore((s) => s.openGrid);
  const spansProjects = new Set(sessions.map((s) => s.projectId)).size > 1;
  const runningCount = sessions.filter((s) => s.status === "working").length;
  return (
    <div>
      <div className="group flex h-[26px] items-center gap-1 rounded-[6px] px-1.5 text-t2 hover:bg-raised">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-1 text-left"
        >
          <ChevronRight
            size={12}
            className={cn("shrink-0 transition-transform", !collapsed && "rotate-90")}
          />
          <span className="truncate text-[12px] font-medium">{group.name}</span>
          {runningCount > 0 && (
            <span className="mono text-[11px] text-t3">{runningCount}</span>
          )}
        </button>
        <Tooltip label="Open grid">
          <button
            onClick={() => openGrid(group.id)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <LayoutGrid size={13} className="text-t3 hover:text-t1" />
          </button>
        </Tooltip>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pl-1">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              showProject={spansProjects}
            />
          ))}
        </div>
      )}
    </div>
  );
}
