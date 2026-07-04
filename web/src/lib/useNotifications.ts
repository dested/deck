import { useEffect, useRef } from "react";
import { useSessionsStore } from "../stores/sessionsStore";
import { useUIStore } from "../stores/uiStore";

// §11 — fire a browser notification when a session goes working->attention and
// the Deck tab is unfocused OR that session isn't the active tab.
export function useNotifications() {
  const byId = useSessionsStore((s) => s.byId);
  const prev = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!useUIStore.getState().notificationsEnabled) return;
    const activeSession = useUIStore.getState().activeSessionId();
    for (const s of Object.values(byId)) {
      const before = prev.current[s.id];
      if (
        before &&
        before !== "attention" &&
        s.status === "attention"
      ) {
        const isActive = activeSession === s.id;
        if (document.hidden || !isActive) fire(s.id, s.name, s.lastActivityLine);
      }
      prev.current[s.id] = s.status;
    }
  }, [byId]);
}

function fire(id: string, name: string, line: string | null) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(`${name} needs input`, {
      body: (line ?? "").slice(0, 120),
      tag: `deck-${id}`,
      icon: "/favicon-alert.svg",
    });
    n.onclick = () => {
      window.focus();
      useUIStore.getState().openSession(id);
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}
