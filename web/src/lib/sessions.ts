import type { Session } from "@deck/shared";
import { api } from "./api";
import { useUIStore } from "../stores/uiStore";
import { useSessionsStore } from "../stores/sessionsStore";

// Central spawn helper: request notification permission on first spawn (§11),
// create the session, and open it as a tab.
export async function spawnSession(
  projectId: string,
  kind: "claude" | "shell",
) {
  // Request notification permission in the background — never block the spawn
  // on the browser's permission prompt.
  if ("Notification" in window && Notification.permission === "default") {
    try {
      void Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
  const s = await api.createSession({ projectId, kind });
  useUIStore.getState().openSession(s.id);
  return s;
}

// Close a session from the UI. Owned sessions are killed (they linger as a
// readable "exited" tab). External ones can't be killed, so they're dismissed:
// removed from the live view + any open tab, hidden until new activity.
export function closeSession(session: Session) {
  if (session.source === "external") {
    useSessionsStore.getState().remove(session.id);
    useUIStore.getState().removeSessionTabs(session.id);
    void api.dismissSession(session.id).catch(() => {});
  } else {
    void api.killSession(session.id).catch(() => {});
  }
}
