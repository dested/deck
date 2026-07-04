import { useSessionsStore } from "../stores/sessionsStore";
import { SessionHeader } from "../components/session/SessionHeader";
import { Terminal } from "../components/terminal/Terminal";
import { Feed } from "../components/feed/Feed";
import { AdoptBanner } from "../components/session/AdoptBanner";
import { ClaudeSessionView } from "../components/session/ClaudeSessionView";
import { EmptyState } from "../components/ui/EmptyState";
import { Bot } from "lucide-react";

// M3: external claude session = read-only full-width feed + Adopt banner.
// Owned shell = full-pane terminal. Owned claude split view lands in M4.
export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useSessionsStore((s) => s.byId[sessionId]);

  if (!session) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="Session not found"
        hint="It may have been closed or hasn't loaded yet."
      />
    );
  }

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
