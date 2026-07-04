import { Bot } from "lucide-react";
import { useSessionsStore, selectSessions } from "../stores/sessionsStore";
import { EmptyState } from "../components/ui/EmptyState";
import { SessionCard } from "../components/home/SessionCard";
import { dayBucket } from "../lib/format";
import type { Session } from "@deck/shared";

// §9.2 — Sessions overview. attention first, then working, then idle; history
// bucketed by day. Live cards update via WS.
export function HomeView() {
  const byId = useSessionsStore((s) => s.byId);
  const sessions = selectSessions(byId);

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="No active sessions"
        hint="Start a Claude session or terminal from a project to see it here."
        action={{
          label: "New Claude session",
          onClick: () => useSessionsStore.getState(), // opened via palette/project
        }}
      />
    );
  }

  const live = sessions.filter(
    (s) => s.status === "attention" || s.status === "working" || s.status === "idle",
  );
  const history = sessions.filter(
    (s) => s.status === "stale" || s.status === "exited",
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <h1 className="mb-4 text-[15px] font-semibold text-t1">Sessions</h1>
      <CardGrid sessions={live} />
      {history.length > 0 && <HistorySections sessions={history} />}
    </div>
  );
}

function CardGrid({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} />
      ))}
    </div>
  );
}

function HistorySections({ sessions }: { sessions: Session[] }) {
  const buckets = new Map<string, Session[]>();
  for (const s of sessions) {
    const b = dayBucket(s.activityAt);
    const arr = buckets.get(b) ?? [];
    arr.push(s);
    buckets.set(b, arr);
  }
  return (
    <div className="mt-6 flex flex-col gap-4">
      {[...buckets.entries()].map(([label, list]) => (
        <div key={label}>
          <div className="section-label mb-2">{label}</div>
          <CardGrid sessions={list} />
        </div>
      ))}
    </div>
  );
}
