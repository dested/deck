import { api } from "./api";
import { useUIStore } from "../stores/uiStore";

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
