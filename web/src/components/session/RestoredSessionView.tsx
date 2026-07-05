import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Play, Terminal as TerminalIcon, History, X } from "lucide-react";
import type { Session } from "@deck/shared";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Feed } from "../feed/Feed";
import { useUIStore } from "../../stores/uiStore";
import { useSessionsStore } from "../../stores/sessionsStore";

// A tab whose live session is gone (server bounced, transcript aged out of the
// <30min live set, or it was closed). We resolve the stale id to its on-disk
// transcript (claude → read-only feed + Resume) or captured screen (shell).
export function RestoredSessionView({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["restore", sessionId],
    queryFn: () => api.restoreSession(sessionId),
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-t3">
        Looking for what was here…
      </div>
    );
  }

  if (isError || !data || data.kind === "none") {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="Nothing left to restore"
        hint="This session ended and left no transcript or saved output. Claude sessions can still be browsed under the project's Agents → History."
      />
    );
  }

  if (data.kind === "claude") return <RestoredClaude sessionId={sessionId} session={data.session} />;
  return <RestoredShell scrollback={data.scrollback} name={data.name} />;
}

function RestoredClaude({
  sessionId,
  session,
}: {
  sessionId: string;
  session: Session;
}) {
  const openSession = useUIStore((s) => s.openSession);
  const removeSessionTabs = useUIStore((s) => s.removeSessionTabs);
  const upsert = useSessionsStore((s) => s.upsert);
  const [resuming, setResuming] = useState(false);

  const resume = async () => {
    if (!session.transcriptSessionId) return;
    setResuming(true);
    try {
      const live = await api.resumeTranscript({
        transcriptId: session.transcriptSessionId,
        projectId: session.projectId,
        name: session.name,
      });
      upsert(live); // render immediately; ws will keep it fresh
      removeSessionTabs(sessionId); // drop this ghost tab
      openSession(live.id); // open + activate the live one
    } catch {
      setResuming(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
        <History size={14} className="text-t3" />
        <span className="truncate text-[14px] font-medium text-t1">
          {session.name}
        </span>
        <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[11px] text-t2">
          restored · read-only
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="default"
            onClick={resume}
            disabled={resuming || !session.transcriptSessionId}
          >
            <Play size={13} /> {resuming ? "Resuming…" : "Resume"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Feed
          sessionId={session.transcriptSessionId ?? session.id}
          transcriptId={session.transcriptSessionId}
        />
      </div>
    </div>
  );
}

function RestoredShell({
  scrollback,
  name,
}: {
  scrollback: string;
  name: string | null;
}) {
  const closeActiveTab = useUIStore((s) => s.closeActiveTab);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
        <TerminalIcon size={14} className="text-t3" />
        <span className="truncate text-[14px] font-medium text-t1">
          {name ?? "Terminal"}
        </span>
        <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[11px] text-t2">
          ended · last output
        </span>
        <button
          onClick={closeActiveTab}
          className="ml-auto flex h-6 items-center gap-1 rounded-[5px] px-2 text-[12px] text-t3 hover:bg-raised hover:text-t1"
        >
          <X size={13} /> Close tab
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-root px-5 py-4">
        <pre className="mono whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-t2">
          {scrollback}
        </pre>
      </div>
    </div>
  );
}
