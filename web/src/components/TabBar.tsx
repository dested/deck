import { Home, X, Bot, SquareTerminal, FolderGit2, LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUIStore, type Tab } from "../stores/uiStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { StatusDot } from "./ui/StatusDot";

export function TabBar() {
  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const activateTab = useUIStore((s) => s.activateTab);
  const closeTab = useUIStore((s) => s.closeTab);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-hair bg-panel">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onClick={() => activateTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  active,
  onClick,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const label = useTabLabel(tab);
  const closable = tab.kind !== "home";
  return (
    <div
      onMouseDown={(e) => {
        if (e.button === 1 && closable) {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={onClick}
      className={cn(
        "group relative flex h-full min-w-0 max-w-[220px] cursor-default items-center gap-1.5 border-r border-hair px-3 text-[12.5px] transition-colors",
        active
          ? "bg-root text-t1"
          : "bg-panel text-t2 hover:bg-raised hover:text-t1",
      )}
    >
      {active && (
        <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "var(--accent)" }} />
      )}
      {label.icon}
      <span className="truncate">{label.text}</span>
      {closable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-t3 opacity-0 hover:bg-hair hover:text-t1 group-hover:opacity-100"
          aria-label="Close tab"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function useTabLabel(tab: Tab): { icon: ReactNode; text: string } {
  const projects = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const groups = useSessionsStore((s) => s.groups);
  switch (tab.kind) {
    case "home":
      return { icon: <Home size={13} className="shrink-0" />, text: "Home" };
    case "project":
      return {
        icon: <FolderGit2 size={13} className="shrink-0 text-t3" />,
        text: projects[tab.projectId]?.name ?? tab.projectId,
      };
    case "session": {
      const s = sessions[tab.sessionId];
      return {
        icon: s ? (
          <StatusDot status={s.status} />
        ) : (
          <Bot size={13} className="shrink-0 text-t3" />
        ),
        text: s?.name ?? "Session",
      };
    }
    case "grid": {
      const g = groups.find((x) => x.id === tab.groupId);
      return {
        icon: <LayoutGrid size={13} className="shrink-0 text-t3" />,
        text: g ? `${g.name} grid` : "Grid",
      };
    }
    default:
      return { icon: <SquareTerminal size={13} />, text: "Tab" };
  }
}
