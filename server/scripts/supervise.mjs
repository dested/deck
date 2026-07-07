// Deck server supervisor: keeps the server process alive, always.
//
// `bun start` runs THIS instead of tsx directly. It spawns the real server
// (tsx src/index.ts) and, if the server ever dies with a non-zero exit —
// crash-guard escalation, OOM, a native module fault, anything — restarts it
// with a short backoff. Sessions survive: state.json + scrollback dumps are
// flushed continuously by the server itself, and claude sessions resume from
// their transcripts via the restore flow.
//
// Exit code 0 (clean shutdown via SIGINT/SIGTERM) does NOT restart.
// Restarts are logged to ~/.deck/crash.log next to the server's own entries.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const crashLog = path.join(os.homedir(), ".deck", "crash.log");

// Backoff for rapid-fire crashes; resets once the server stays up 60s.
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const STABLE_MS = 60_000;

let child = null;
let shuttingDown = false;
let crashStreak = 0;

function log(msg) {
  const line = `[${new Date().toISOString()}] supervisor: ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(crashLog), { recursive: true });
    fs.appendFileSync(crashLog, line, "utf8");
  } catch {
    /* log file is best-effort */
  }
}

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: serverDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown || code === 0) {
      process.exit(code ?? 0);
    }
    const uptime = Date.now() - startedAt;
    crashStreak = uptime >= STABLE_MS ? 0 : crashStreak + 1;
    const delay = BACKOFF_MS[Math.min(crashStreak, BACKOFF_MS.length - 1)];
    log(
      `server exited (code=${code}, signal=${signal ?? "none"}, uptime=${Math.round(uptime / 1000)}s) — restarting in ${delay / 1000}s`,
    );
    setTimeout(start, delay);
  });

  child.on("error", (err) => {
    log(`failed to spawn server: ${err.message} — retrying in 5s`);
    child = null;
    if (!shuttingDown) setTimeout(start, 5000);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal} — stopping server`);
  if (child) {
    child.kill(); // server's SIGTERM handler flushes state + scrollback
    // If it doesn't die on its own, force-exit after a grace period.
    setTimeout(() => process.exit(0), 8000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log("starting Deck server under supervision");
start();
