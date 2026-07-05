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
  // Seed the store immediately so its tab renders live right away (ws keeps it
  // fresh) instead of briefly falling through to the restore view.
  useSessionsStore.getState().upsert(s);
  useUIStore.getState().openSession(s.id);
  return s;
}

// Close a session from the UI. Optimistically drop it from the live store + any
// open tab, then tell the server: owned sessions are killed + fully removed
// (clears zombies too); external ones are dismissed (hidden until new activity).
// Claude sessions remain re-openable from the project's Agents history.
export function closeSession(session: Session) {
  useSessionsStore.getState().remove(session.id);
  useUIStore.getState().removeSessionTabs(session.id);
  void api.dismissSession(session.id).catch(() => {});
}
