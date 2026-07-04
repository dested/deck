import { useEffect, useRef, useState, useCallback } from "react";
import { PanelRight } from "lucide-react";
import type { Session } from "@deck/shared";
import { SessionHeader } from "./SessionHeader";
import { Feed } from "../feed/Feed";
import { Composer } from "./Composer";
import { Terminal } from "../terminal/Terminal";
import { IconButton } from "../ui/IconButton";

// §9.3 owned claude session: split Agent feed (left) + Terminal (right), with a
// draggable divider, a collapsible terminal pane, and the composer under the feed.
export function ClaudeSessionView({ session }: { session: Session }) {
  const [showTerminal, setShowTerminal] = useState(true);
  const [pct, setPct] = useState(60);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Ctrl+` toggles the terminal pane (§10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setShowTerminal((v) => !v);
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
      setPct(Math.max(30, Math.min(80, p)));
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
            label={showTerminal ? "Hide terminal" : "Show terminal"}
            active={showTerminal}
            onClick={() => setShowTerminal((v) => !v)}
          >
            <PanelRight size={15} />
          </IconButton>
        }
      />
      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div
          className="flex min-w-0 flex-col"
          style={{ width: showTerminal ? `${pct}%` : "100%" }}
        >
          <div className="min-h-0 flex-1">
            <Feed
              sessionId={session.id}
              transcriptId={session.transcriptSessionId}
            />
          </div>
          <Composer sessionId={session.id} />
        </div>
        {showTerminal && (
          <>
            <div
              onMouseDown={onMouseDown}
              className="w-px shrink-0 cursor-col-resize bg-hair transition-colors hover:bg-hairfocus"
              style={{ boxShadow: "0 0 0 2px transparent" }}
            />
            <div className="min-w-0 flex-1">
              <Terminal sessionId={session.ptyId ?? session.id} claudeNewline />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
