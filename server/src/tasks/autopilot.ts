import { getState } from "../state.js";
import { sessionManager } from "../sessions/manager.js";
import { startTask } from "./service.js";

// M17 autopilot (config-gated, default OFF): drains the Queued column while
// fewer than maxRunning linked tasks have a live session. 15s cadence.
let timer: NodeJS.Timeout | null = null;

function isAlive(sessionId: string | null): boolean {
  if (!sessionId) return false;
  const s = sessionManager.list().find((x) => x.id === sessionId);
  return !!s && s.status !== "exited" && s.status !== "stale";
}

export function startAutopilot() {
  if (timer) return;
  timer = setInterval(() => {
    const st = getState();
    if (!st.autopilot.enabled) return;
    const running = st.tasks.filter(
      (t) => t.status === "linked" && isAlive(t.sessionId),
    ).length;
    if (running >= st.autopilot.maxRunning) return;
    const queued = st.tasks
      .filter((t) => t.status === "queued")
      .sort((a, b) => a.order - b.order);
    const top = queued[0];
    if (top) startTask(top.id);
  }, 15_000);
  timer.unref?.();
}

export function stopAutopilot() {
  if (timer) clearInterval(timer);
  timer = null;
}
