import { Plus, SquareTerminal, X, Maximize2 } from "lucide-react";
import { useSessionsStore, selectSessions } from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/api";
import { spawnSession } from "../../lib/sessions";
import { Terminal } from "../terminal/Terminal";
import { StatusDot } from "../ui/StatusDot";

export function TerminalsTab({ projectId }: { projectId: string }) {
  const byId = useSessionsStore((s) => s.byId);
  const openSession = useUIStore((s) => s.openSession);
  const shells = selectSessions(byId).filter(
    (s) => s.projectId === projectId && s.kind === "shell" && s.source === "owned",
  );

  const newTerminal = () =>
    void spawnSession(projectId, "shell").catch(() => {});

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
        {shells.map((s) => (
          <div
            key={s.id}
            className="flex h-[340px] flex-col overflow-hidden rounded-[8px] border border-hair bg-panel"
          >
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-hair px-2.5">
              <StatusDot status={s.status} />
              <SquareTerminal size={13} className="text-t3" />
              <span className="truncate text-[12px] text-t1">{s.name}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => openSession(s.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
                  aria-label="Open full"
                >
                  <Maximize2 size={13} />
                </button>
                <button
                  onClick={() => void api.killSession(s.id).catch(() => {})}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-[color:var(--err)]"
                  aria-label="Kill"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Terminal sessionId={s.ptyId ?? s.id} />
            </div>
          </div>
        ))}
        <button
          onClick={newTerminal}
          className="flex h-[340px] flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-hair text-t3 transition-colors hover:border-hairfocus hover:text-t2"
        >
          <Plus size={20} />
          <span className="text-[13px]">New terminal</span>
        </button>
      </div>
    </div>
  );
}
