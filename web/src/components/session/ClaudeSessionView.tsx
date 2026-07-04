import { useEffect, useRef, useState, useCallback } from "react";
import { PanelLeft } from "lucide-react";
import type { Session } from "@deck/shared";
import { SessionHeader } from "./SessionHeader";
import { Feed } from "../feed/Feed";
import { Composer } from "./Composer";
import { Terminal } from "../terminal/Terminal";
import { IconButton } from "../ui/IconButton";

// Owned claude session. The xterm terminal is the session — it's always shown
// full-width. The Agent transcript (feed + composer) is HIDDEN by default and
// slides in on the left when you enable it (header toggle or Ctrl+`).
export function ClaudeSessionView({ session }: { session: Session }) {
  const [showFeed, setShowFeed] = useState(false);
  const [pct, setPct] = useState(45); // feed width when shown
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Ctrl+` toggles the transcript pane (§10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setShowFeed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const p = ((e.clientX - rect.left) / rect.width) * 100;
      setPct(Math.max(25, Math.min(70, p)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <SessionHeader
        session={session}
        right={
          <IconButton
            label={showFeed ? "Hide transcript" : "Show transcript"}
            active={showFeed}
            onClick={() => setShowFeed((v) => !v)}
          >
            <PanelLeft size={15} />
          </IconButton>
        }
      />
      <div ref={containerRef} className="flex min-h-0 flex-1">
        {showFeed && (
          <>
            <div
              className="flex min-w-0 flex-col"
              style={{ width: `${pct}%` }}
            >
              <div className="min-h-0 flex-1">
                <Feed
                  sessionId={session.id}
                  transcriptId={session.transcriptSessionId}
                />
              </div>
              <Composer sessionId={session.id} />
            </div>
            <div
              onMouseDown={onMouseDown}
              className="w-px shrink-0 cursor-col-resize bg-hair transition-colors hover:bg-hairfocus"
              style={{ boxShadow: "0 0 0 2px transparent" }}
            />
          </>
        )}
        {/* Terminal is always mounted (keeps its socket alive across toggles). */}
        <div className="min-w-0 flex-1">
          <Terminal sessionId={session.ptyId ?? session.id} claudeNewline />
        </div>
      </div>
    </div>
  );
}
