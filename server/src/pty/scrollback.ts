import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { ptyManager } from "./manager.js";

// Persist a closed pty's last output to disk so a reopened tab can still show
// what was there — the in-memory ring/serialize snapshot dies with the process
// (server restart) or is swept 24h after exit. Kept small (last ~256KB raw).
const SCROLLBACK_DIR = path.join(config.deckStateDir, "scrollback");
const MAX_BYTES = 256 * 1024;

function fileFor(id: string): string {
  // pty ids are uuids; keep the filename filesystem-safe regardless.
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "-");
  return path.join(SCROLLBACK_DIR, `${safe}.log`);
}

// Snapshot the current screen+scrollback of a (running or just-exited) pty to
// disk. Best-effort — never throws into the caller.
export function saveScrollback(id: string): void {
  const snap = ptyManager.reattachSnapshot(id);
  if (!snap) return;
  // Prefer the raw ring (faithful byte stream); it renders to clean text after
  // ANSI stripping on read. Fall back to the serialized screen.
  let data = snap.raw || snap.serialized;
  if (!data) return;
  if (data.length > MAX_BYTES) data = data.slice(data.length - MAX_BYTES);
  try {
    fs.mkdirSync(SCROLLBACK_DIR, { recursive: true });
    fs.writeFileSync(fileFor(id), data, "utf8");
  } catch {
    /* disk full / perms — losing scrollback is non-fatal */
  }
}

// Read a persisted scrollback, strip ANSI, and return the last `maxLines` lines
// as plain text. null when nothing was captured for this id.
export function readScrollback(id: string, maxLines = 120): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(fileFor(id), "utf8");
  } catch {
    return null;
  }
  const text = stripAnsi(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n");
  // Trim trailing blank lines the shell left behind, then tail.
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines.slice(-maxLines).join("\n");
}

export function deleteScrollback(id: string): void {
  try {
    fs.rmSync(fileFor(id));
  } catch {
    /* ignore */
  }
}

// CSI / OSC / other escape sequences → nothing. Good enough for a text dump.
function stripAnsi(s: string): string {
  return s
    // OSC (e.g. window title): ESC ] ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // CSI: ESC [ ... final byte
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // other 2-char escapes
    .replace(/\x1b[@-Z\\-_]/g, "")
    // stray control chars except tab/newline
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
