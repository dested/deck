import { api } from "./api";
import { toast } from "../components/ui/Toast";

// Reload just the frontend (picks up a freshly built web/dist bundle and
// re-bootstraps every store). The window stays open.
export function reloadUI() {
  location.reload();
}

async function waitForHealth(timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  // The old process is still answering for a moment after we ask it to exit,
  // so wait out an initial gap before we start trusting a 200.
  await sleep(800);
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await api.health();
      if (h?.ok) return true;
    } catch {
      /* still down */
    }
    await sleep(500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let restarting = false;

// Bounce the backend (supervisor respawns it) WITHOUT closing the window, then
// reload the UI once the fresh process is healthy so everything is in sync.
export async function restartServer() {
  if (restarting) return;
  restarting = true;
  try {
    await api.restartServer();
  } catch (e) {
    // A dropped connection mid-restart is expected (the server exits under us);
    // only a real 409 (not supervised) should surface as an error.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("409") || /not.*supervis/i.test(msg)) {
      restarting = false;
      toast(
        "Server isn't running under the supervisor — restart it manually.",
        "error",
      );
      return;
    }
  }
  toast("Restarting server…", "info");
  const ok = await waitForHealth();
  if (ok) reloadUI();
  else {
    restarting = false;
    toast("Server didn't come back — check the terminal.", "error");
  }
}
