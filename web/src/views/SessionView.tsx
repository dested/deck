import { useSessionsStore } from "../stores/sessionsStore";
import { SessionHeader } from "../components/session/SessionHeader";
import { Terminal } from "../components/terminal/Terminal";
import { Feed } from "../components/feed/Feed";
import { AdoptBanner } from "../components/session/AdoptBanner";
import { ClaudeSessionView } from "../components/session/ClaudeSessionView";
import { RestoredSessionView } from "../components/session/RestoredSessionView";

// M3: external claude session = read-only full-width feed + Adopt banner.
// Owned shell = full-pane terminal. Owned claude split view lands in M4.
export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useSessionsStore((s) => s.byId[sessionId]);
  const loaded = useSessionsStore((s) => s.loaded);

  // Don't decide "gone" until the live-session list has loaded, or we'd flash
  // the restore view for a session that's simply not fetched yet.
  if (!session && !loaded) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-t3">
        Loading session…
      </div>
    );
  }

  // Tab restored from a previous run whose live session is gone: reconnect it to
  // its on-disk transcript / captured output instead of a dead "not found".
  if (!session) return <RestoredSessionView sessionId={sessionId} />;

  if (session.kind === "shell" && session.source === "owned") {
    return (
      <div className="flex h-full flex-col">
        <SessionHeader session={session} />
        <div className="min-h-0 flex-1">
          <Terminal sessionId={session.ptyId ?? session.id} />
        </div>
      </div>
    );
  }

  // Owned claude: split feed + terminal + composer (§9.3).
  if (session.kind === "claude" && session.source === "owned") {
    return <ClaudeSessionView session={session} />;
  }

  // External claude: read-only full-width feed + Adopt banner.
  return (
    <div className="flex h-full flex-col">
      <SessionHeader session={session} />
      {session.source === "external" && <AdoptBanner session={session} />}
      <div className="min-h-0 flex-1">
        <Feed sessionId={session.id} transcriptId={session.transcriptSessionId} />
      </div>
    </div>
  );
}
