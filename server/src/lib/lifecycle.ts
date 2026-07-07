import { flushState } from "../state.js";
import { saveAllScrollback } from "../pty/scrollback.js";
import { stopServices } from "../services.js";
import { ptyManager } from "../pty/manager.js";
import { logCrash } from "./crashGuard.js";

let restarting = false;

// User-triggered "restart backend" (Settings / palette). We exit with a NON-zero
// code on purpose: the supervisor (server/scripts/supervise.mjs) restarts on any
// non-zero exit but treats exit 0 as an intentional stop. So this bounces the
// server WITHOUT the window closing — the client's WS just reconnects to the
// fresh process. Durable state (state.json + terminal scrollback) is flushed
// first so restored tabs survive, exactly like a crash-guard restart.
//
// No-op (returns false) when NOT running under the supervisor — a bare
// `tsx src/index.ts` / dev run would just die and stay dead, which is worse than
// doing nothing. The supervisor sets DECK_SUPERVISED=1.
export function isSupervised(): boolean {
  return process.env.DECK_SUPERVISED === "1";
}

export function restartServer(): boolean {
  if (!isSupervised()) return false;
  if (restarting) return true;
  restarting = true;
  logCrash("restart", new Error("restart requested from UI"));
  // Give the HTTP reply a tick to flush to the client before we tear down.
  setTimeout(() => {
    try {
      saveAllScrollback(); // BEFORE disposeAll kills the pty rings
      flushState();
      stopServices();
      ptyManager.disposeAll();
    } catch {
      /* best-effort — we're exiting regardless */
    }
    process.exit(1); // non-zero -> supervisor respawns
  }, 150);
  return true;
}
