import type { SessionStatus } from "@deck/shared";
import { cn } from "../../lib/cn";

const COLOR: Record<SessionStatus, string> = {
  working: "var(--ok)",
  attention: "var(--warn)",
  idle: "var(--text-3)",
  stale: "transparent",
  exited: "transparent",
};

// §8.4: 7px circles. working pulses; idle solid; stale/exited hollow ring.
export function StatusDot({
  status,
  size = 7,
  className,
}: {
  status: SessionStatus;
  size?: number;
  className?: string;
}) {
  const hollow = status === "stale" || status === "exited";
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full",
        status === "working" && "deck-pulse",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: hollow ? "transparent" : COLOR[status],
        border: hollow ? `1.5px solid var(--text-3)` : "none",
      }}
      aria-label={status}
    />
  );
}
