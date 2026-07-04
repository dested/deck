import { useEffect } from "react";
import { useUIStore } from "../stores/uiStore";

// Global keyboard map (§10). Terminal panes swallow keys except the few listed
// here; that filtering lives in the xterm custom key handler (§5.4 / M2).
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUIStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable === true;

      // Ctrl+S — suppress the browser save dialog (Monaco handles real saves
      // via its own editor command when focused).
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        return;
      }
      // Ctrl+K — command palette
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      // Ctrl+B — toggle sidebar
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
      // Ctrl+W — close active tab (of the active project; views are permanent)
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        ui.closeActiveTab();
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (mod && e.key === "Tab") {
        e.preventDefault();
        ui.nextTab(e.shiftKey ? -1 : 1);
        return;
      }
      // Ctrl+1..9 — jump to tab N
      if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        ui.activateIndex(Number(e.key) - 1);
        return;
      }
      // "/" — focus sidebar search (when not typing)
      if (e.key === "/" && !inEditable && !mod) {
        const el = document.getElementById("deck-search");
        if (el) {
          e.preventDefault();
          (el as HTMLInputElement).focus();
        }
        return;
      }
      // Escape — close palette
      if (e.key === "Escape" && ui.paletteOpen) {
        ui.setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
