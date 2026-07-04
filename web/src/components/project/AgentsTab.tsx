import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, History } from "lucide-react";
import type { Session } from "@deck/shared";
import { api } from "../../lib/api";
import { useSessionsStore } from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { StatusDot } from "../ui/StatusDot";
import { EmptyState } from "../ui/EmptyState";
import { relTime, dayBucket } from "../../lib/format";

// §9.4 Agents tab: live sessions for this project + history of past transcripts.
export function AgentsTab({ projectId }: { projectId: string }) {
  const upsert = useSessionsStore((s) => s.upsert);
  const { data, isLoading } = useQuery({
    queryKey: ["agent-sessions", projectId],
    queryFn: () => api.projectAgentSessions(projectId),
    refetchInterval: 15_000,
  });

  // Make fetched sessions openable (SessionView reads from the store).
  useEffect(() => {
    if (!data) return;
    for (const s of [...data.live, ...data.history]) upsert(s);
  }, [data, upsert]);

  if (isLoading && !data) {
    return <div className="p-5 text-[13px] text-t3">Loading sessions…</div>;
  }

  const live = data?.live ?? [];
  const history = data?.history ?? [];

  if (live.length === 0 && history.length === 0) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="No agent sessions yet"
        hint={`Live and past Claude sessions for ${projectId} will appear here.`}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {live.length > 0 && (
        <section className="mb-6">
          <div className="section-label mb-2">Live</div>
          <div className="flex flex-col gap-1">
            {live.map((s) => (
              <LiveRow key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}
      {history.length > 0 && (
        <section>
          <div className="section-label mb-2 flex items-center gap-1.5">
            <History size={12} /> History
          </div>
          <HistoryList sessions={history} />
        </section>
      )}
    </div>
  );
}

function LiveRow({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  return (
    <button
      onClick={() => openSession(session.id)}
      className="flex items-center gap-3 rounded-[6px] border border-hair bg-panel px-3 py-2 text-left hover:border-hairfocus"
    >
      <StatusDot status={session.status} />
      <span className="shrink-0 text-[13px] font-medium text-t1">{session.name}</span>
      <span className="truncate text-[12px] text-t2">
        {session.lastActivityLine ?? ""}
      </span>
      <span className="mono ml-auto shrink-0 text-[11px] text-t3">
        {relTime(session.activityAt)}
      </span>
    </button>
  );
}

function HistoryList({ sessions }: { sessions: Session[] }) {
  const openSession = useUIStore((s) => s.openSession);
  const buckets = new Map<string, Session[]>();
  for (const s of sessions) {
    const b = dayBucket(s.activityAt);
    const arr = buckets.get(b) ?? [];
    arr.push(s);
    buckets.set(b, arr);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...buckets.entries()].map(([label, list]) => (
        <div key={label}>
          <div className="mb-1 text-[11px] text-t3">{label}</div>
          <div className="flex flex-col">
            {list.map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s.id)}
                className="flex items-center gap-3 rounded-[6px] px-3 py-1.5 text-left hover:bg-raised"
              >
                <span className="truncate text-[12.5px] text-t1">
                  {s.title ?? s.name}
                </span>
                <span className="truncate text-[12px] text-t3">
                  {s.lastActivityLine ?? ""}
                </span>
                <span className="mono ml-auto shrink-0 text-[11px] text-t3">
                  {relTime(s.activityAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
