import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// Process-level safety net. Without this, ANY uncaught exception (a chokidar
// EPERM, a pg socket error, a throw inside a timer tick) or unhandled promise
// rejection kills the whole server and takes every live pty with it. Deck must
// never die from a background hiccup: log it, keep running.
//
// Escalation: a genuinely wedged process (uncaught exceptions arriving in a
// tight loop) is worse than a restart — the supervisor (scripts/supervise.mjs)
// brings us back in ~1s with sessions restorable. So if we see too many
// uncaught exceptions in a short window, do one clean flush and exit(1).

const CRASH_LOG = path.join(config.deckStateDir, "crash.log");
const CRASH_LOG_MAX = 1024 * 1024; // rotate at 1MB
const ESCALATE_COUNT = 25; // uncaught exceptions...
const ESCALATE_WINDOW_MS = 60_000; // ...within this window => clean restart

export function logCrash(source: string, err: unknown): void {
  const stack =
    err instanceof Error ? err.stack ?? err.message : String(err);
  const line = `[${new Date().toISOString()}] ${source}: ${stack}\n\n`;
  try {
    fs.mkdirSync(config.deckStateDir, { recursive: true });
    try {
      if (fs.statSync(CRASH_LOG).size > CRASH_LOG_MAX) {
        fs.renameSync(CRASH_LOG, `${CRASH_LOG}.1`);
      }
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(CRASH_LOG, line, "utf8");
  } catch {
    /* disk trouble — console below is the fallback */
  }
  console.error(`[deck] ${source}:`, err);
}

let installed = false;

export function installCrashGuard(onFatal: () => void): void {
  if (installed) return;
  installed = true;

  const recentUncaught: number[] = [];

  process.on("uncaughtException", (err, origin) => {
    logCrash(`uncaughtException (${origin})`, err);
    const now = Date.now();
    recentUncaught.push(now);
    while (recentUncaught.length && recentUncaught[0]! < now - ESCALATE_WINDOW_MS) {
      recentUncaught.shift();
    }
    if (recentUncaught.length >= ESCALATE_COUNT) {
      logCrash(
        "crashGuard",
        new Error(
          `${recentUncaught.length} uncaught exceptions in ${ESCALATE_WINDOW_MS / 1000}s — restarting cleanly`,
        ),
      );
      try {
        onFatal();
      } finally {
        process.exit(1); // supervisor restarts us
      }
    }
  });

  process.on("unhandledRejection", (reason) => {
    logCrash("unhandledRejection", reason);
    // Never fatal: a forgotten .catch() must not take down live sessions.
  });
}
