import type { Session } from "@deck/shared";
import { api } from "./api";
import { useUIStore } from "../stores/uiStore";
import { useSessionsStore } from "../stores/sessionsStore";

// The auto-generated default session name, e.g. "myproj cc·a1b2".
const DEFAULT_NAME_RE = / (sh|cc)·[0-9a-f]{4}$/;

// M12 title precedence: a user (or external ai-title) rename wins; otherwise the
// AI tab title; otherwise the default name.
export function displayTitle(s: Session): string {
  if (!DEFAULT_NAME_RE.test(s.name)) return s.name;
  return s.aiMeta?.title || s.name;
}

// Central spawn helper: request notification permission on first spawn (§11),
// create the session, and open it as a tab.
export async function spawnSession(
  projectId: string,
  kind: "claude" | "shell",
  opts?: { initialPrompt?: string; name?: string },
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
  const s = await api.createSession({
    projectId,
    kind,
    initialPrompt: opts?.initialPrompt,
    name: opts?.name,
  });
  // Seed the store immediately so its tab renders live right away (ws keeps it
  // fresh) instead of briefly falling through to the restore view.
  useSessionsStore.getState().upsert(s);
  useUIStore.getState().openSession(s.id);
  return s;
}

// One-click package.json script launcher (Library card run buttons): spawns a
// real shell session running `<runner> run <script>` and opens its tab.
export async function runScript(
  projectId: string,
  script: string,
  runner: "bun" | "pnpm" | "yarn" | "npm",
) {
  const s = await api.createSession({
    projectId,
    kind: "shell",
    name: `▶ ${script}`,
    command: `${runner} run ${script}`,
  });
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
