import { useEffect } from "react";
import { useSessionsStore } from "../stores/sessionsStore";

// document.title + favicon reflect the count of sessions needing attention (§11).
export function useAttentionBadge() {
  const byId = useSessionsStore((s) => s.byId);
  useEffect(() => {
    const count = Object.values(byId).filter(
      (s) => s.status === "attention",
    ).length;
    document.title = count > 0 ? `(${count}!) Deck` : "Deck";
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) {
      const href = count > 0 ? "/favicon-alert.svg" : "/favicon.svg";
      if (!link.href.endsWith(href)) link.href = href;
    }
  }, [byId]);
}
