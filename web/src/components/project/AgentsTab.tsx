import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  SquareTerminal,
  History,
  MessageSquare,
  Wrench,
  PenLine,
  Cpu,
  Clock,
  DollarSign,
  Search,
} from "lucide-react";
import type { Session, SessionStatus } from "@deck/shared";
import { api } from "../../lib/api";
import {
  useSessionsStore,
  selectSessions,
  isLive,
} from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { SessionContextMenu } from "../session/SessionContextMenu";
import { EmptyState } from "../ui/EmptyState";
import { relTime, dayBucket, fmtUsd } from "../../lib/format";
import { useSessionCost } from "../../lib/useCost";

// §9.4 Agents tab: rich live cards (what each agent is, its model, how much it's
// done, what it's doing right now) + a compact per-day history.
export function AgentsTab({ projectId }: { projectId: string }) {
  const upsert = useSessionsStore((s) => s.upsert);
  const storeById = useSessionsStore((s) => s.byId);
  const { data, isLoading } = useQuery({
    queryKey: ["agent-sessions", projectId],
    queryFn: () => api.projectAgentSessions(projectId),
    refetchInterval: 15_000,
  });

  // Only push LIVE sessions into the shared store. History rows render straight
  // from `data.history`; upserting them would let a dismissed-but-still-writing
  // agent (live status, but parked in history) leak back into the Live section
  // via the store scan below.
  useEffect(() => {
    if (!data) return;
    for (const s of data.live) upsert(s);
  }, [data, upsert]);

  if (isLoading && !data) {
    return <div className="p-5 text-[13px] text-t3">Loading sessions…</div>;
  }

  // An owned session and the transcript it writes are one agent; never show the
  // external "twin" next to the owned card.
  const ownedTranscriptIds = new Set(
    Object.values(storeById)
      .filter((s) => s.source === "owned" && s.transcriptSessionId)
      .map((s) => s.transcriptSessionId as string),
  );
  const isTwin = (s: Session) =>
    s.source === "external" && ownedTranscriptIds.has(s.id);

  const history = (data?.history ?? []).filter((s) => !isTwin(s));
  // A session the server has parked in history is closed/old — never let the
  // live store scan promote it back, even if its intrinsic status reads live.
  const historyIds = new Set(history.map((s) => s.id));

  const liveById: Record<string, Session> = {};
  for (const s of data?.live ?? []) if (!isTwin(s)) liveById[s.id] = s;
  for (const s of Object.values(storeById)) {
    if (
      s.projectId === projectId &&
      isLive(s) &&
      !isTwin(s) &&
      !historyIds.has(s.id)
    )
      liveById[s.id] = s;
  }
  const live = selectSessions(liveById);

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
        <section className="mb-7">
          <div className="section-label mb-2.5 flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--ok)" }}
            />
            Live
            <span className="mono text-t3">{live.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {live.map((s) => (
              <LiveCard key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}
      {history.length > 0 && (
        <section>
          <div className="section-label mb-2.5 flex items-center gap-1.5">
            <History size={12} /> History
            <span className="mono text-t3">{history.length}</span>
            <button
              onClick={() => useUIStore.getState().openSearch(projectId)}
              className="ml-auto flex items-center gap-1 rounded-[5px] border border-hair px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-t3 hover:bg-raised hover:text-t1"
              title="Search this project's transcripts"
            >
              <Search size={11} /> Search
            </button>
          </div>
          <HistoryList sessions={history} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATUS_META: Record<SessionStatus, { label: string; color: string }> = {
  working: { label: "Working", color: "var(--ok)" },
  attention: { label: "Needs input", color: "var(--warn)" },
  idle: { label: "Idle", color: "var(--text-3)" },
  stale: { label: "Stale", color: "var(--text-3)" },
  exited: { label: "Exited", color: "var(--err)" },
};

function modelLabel(m: string | null | undefined): string | null {
  if (!m) return null;
  const s = m.toLowerCase();
  const fam = ["opus", "sonnet", "haiku", "fable"].find((f) => s.includes(f));
  if (!fam) return m.replace(/^claude-/, "").split("-").slice(0, 2).join(" ");
  const ver = s.match(new RegExp(`${fam}-(\\d+)(?:-(\\d+))?`));
  const v = ver ? (ver[2] ? `${ver[1]}.${ver[2]}` : ver[1]) : "";
  return fam[0]!.toUpperCase() + fam.slice(1) + (v ? ` ${v}` : "");
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function Chip({
  icon,
  children,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className="flex items-center gap-1 text-[11px] text-t3 tabular-nums"
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}

function LiveCard({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  const Icon = session.kind === "claude" ? Bot : SquareTerminal;
  const meta = STATUS_META[session.status];
  const st = session.stats;
  const model = modelLabel(st?.model);
  const pulse = session.status === "working";
  const cost = useSessionCost(session.transcriptSessionId ?? session.id);

  return (
    <SessionContextMenu session={session}>
      <button
        onClick={() => openSession(session.id)}
        className="group flex w-full items-start gap-3 rounded-[9px] border border-hair bg-panel px-3.5 py-3 text-left transition-colors hover:border-hairfocus hover:bg-raised"
      >
        {/* Kind badge, tinted by status */}
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]"
          style={{ background: "var(--bg-raised)", color: meta.color }}
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          {/* Title + status */}
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-t1">
              {session.aiMeta?.title ?? session.title ?? session.name}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span
                className={
                  "h-1.5 w-1.5 rounded-full " + (pulse ? "deck-pulse" : "")
                }
                style={{ background: meta.color }}
              />
              <span className="text-[11px]" style={{ color: meta.color }}>
                {meta.label}
              </span>
            </span>
          </div>

          {/* Secondary line: session name (if a title took the top slot) */}
          {session.title && (
            <div className="mono truncate text-[11px] text-t3">
              {session.name}
            </div>
          )}

          {/* What it's doing right now — the live activity line while working,
              falling back to the AI summary when idle (M12). */}
          {(() => {
            const line =
              session.status === "working"
                ? session.lastActivityLine
                : (session.aiMeta?.summary ?? session.lastActivityLine);
            return line ? (
              <div className="mt-1.5 truncate text-[12.5px] text-t2">{line}</div>
            ) : null;
          })()}

          {/* Stat chips */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            {model && (
              <Chip icon={<Cpu size={11} />} title="Model">
                {model}
              </Chip>
            )}
            {st && st.messages > 0 && (
              <Chip icon={<MessageSquare size={11} />} title="Messages">
                {st.messages}
              </Chip>
            )}
            {st && st.tools > 0 && (
              <Chip icon={<Wrench size={11} />} title="Tool calls">
                {st.tools}
              </Chip>
            )}
            {st && st.edits > 0 && (
              <Chip icon={<PenLine size={11} />} title="Edits / writes">
                {st.edits}
              </Chip>
            )}
            {cost && cost.cost > 0 && (
              <Chip icon={<DollarSign size={11} />} title="Session cost (ccusage)">
                <span className="text-accenttext">{fmtUsd(cost.cost)}</span>
              </Chip>
            )}
            <Chip icon={<Clock size={11} />} title="Last activity">
              {relTime(session.activityAt)}
            </Chip>
            <span className="text-[11px] text-t3">
              · {fmtDuration(session.activityAt - session.createdAt)} active
            </span>
            <span className="ml-auto rounded-[4px] bg-raised px-1.5 py-0.5 text-[10px] text-t3">
              {session.source === "owned" ? "attached" : "external"}
            </span>
            {session.unread && (
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
          </div>
        </div>
      </button>
    </SessionContextMenu>
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
          <div className="flex flex-col gap-1">
            {list.map((s) => {
              const st = s.stats;
              const model = modelLabel(st?.model);
              return (
                <SessionContextMenu key={s.id} session={s}>
                  <button
                    onClick={() => openSession(s.id)}
                    className="group flex items-center gap-3 rounded-[6px] border border-transparent px-3 py-2 text-left hover:border-hair hover:bg-raised"
                  >
                    <Bot size={13} className="shrink-0 text-t3" />
                    <span className="truncate text-[13px] text-t1">
                      {s.title ?? s.name}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-3">
                      {model && (
                        <span className="hidden text-[11px] text-t3 sm:inline">
                          {model}
                        </span>
                      )}
                      {st && st.messages > 0 && (
                        <Chip icon={<MessageSquare size={10} />}>
                          {st.messages}
                        </Chip>
                      )}
                      {st && st.edits > 0 && (
                        <Chip icon={<PenLine size={10} />}>{st.edits}</Chip>
                      )}
                      <span className="mono text-[11px] text-t3">
                        {relTime(s.activityAt)}
                      </span>
                    </span>
                  </button>
                </SessionContextMenu>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
