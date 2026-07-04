import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { encodePath } from "./locator.js";

// §5.2 — when Deck spawns a claude session, find the transcript file it writes.
// Strategy: snapshot the *.jsonl set in the project's encoded transcript dir at
// spawn; the first NEW jsonl whose first entries' cwd matches is this session's.
export function linkOwnedClaude(
  projectPath: string,
  onLinked: (transcriptSessionId: string) => void,
): () => void {
  const expectedDir = path.join(
    config.claudeProjectsDir,
    encodePath(projectPath),
  );
  const before = new Set(safeList(expectedDir));
  const wantCwd = projectPath.replace(/\\/g, "/").toLowerCase();

  // Claude creates the transcript jsonl only when the FIRST message is sent, so
  // we keep watching well past spawn (the user may sit at the welcome screen).
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const current = safeList(expectedDir);
    const fresh = current
      .filter((f) => f.endsWith(".jsonl") && !before.has(f))
      .map((f) => {
        const full = path.join(expectedDir, f);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        return { f, full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const cand of fresh) {
      if (firstCwd(cand.full)?.replace(/\\/g, "/").toLowerCase() === wantCwd) {
        clearInterval(timer);
        onLinked(cand.f.replace(/\.jsonl$/, ""));
        return;
      }
    }
    if (tries > 900) clearInterval(timer); // give up after ~15min
  }, 1000);

  return () => clearInterval(timer);
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function firstCwd(file: string): string | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const obj = JSON.parse(t) as { cwd?: string };
      if (typeof obj.cwd === "string") return obj.cwd;
    }
  } catch {
    /* file mid-write or unreadable */
  }
  return null;
}
