import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { eventHub, topics } from "../ws/events.js";

// Headless-Edge screenshots of live dev servers → the Library card's face.
// Captures are serial (one browser at a time), throttled per project, and
// cached as ~/.deck/shots/<projectId>.png. A dedicated --user-data-dir keeps
// headless runs from fighting the user's real Edge profile.

const SHOT_INTERVAL_MS = 60 * 60 * 1000; // auto-recapture at most 1/hour
const CAPTURE_TIMEOUT_MS = 30_000;

const shotsDir = path.join(config.deckStateDir, "shots");
const profileDir = path.join(config.deckStateDir, "shot-profile");

function resolveBrowser(): string | null {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  const candidates = [
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

class ScreenshotService {
  private browser: string | null | undefined; // undefined = not yet resolved
  private queue: { projectId: string; port: number }[] = [];
  private inFlight = false;
  private lastAttempt = new Map<string, number>();

  shotPath(projectId: string): string {
    return path.join(shotsDir, `${projectId}.png`);
  }

  shotAt(projectId: string): number | null {
    try {
      return fs.statSync(this.shotPath(projectId)).mtimeMs;
    } catch {
      return null;
    }
  }

  // All existing shots, for the client's initial cache-bust map.
  allShotTimes(): Record<string, number> {
    const out: Record<string, number> = {};
    try {
      for (const f of fs.readdirSync(shotsDir)) {
        if (!f.endsWith(".png")) continue;
        const id = f.slice(0, -4);
        const at = this.shotAt(id);
        if (at) out[id] = at;
      }
    } catch {
      /* dir may not exist yet */
    }
    return out;
  }

  // Auto path (port watcher tick): capture if we've never shot this project or
  // the shot is older than SHOT_INTERVAL_MS.
  maybeCapture(projectId: string, port: number) {
    const now = Date.now();
    const last = Math.max(
      this.shotAt(projectId) ?? 0,
      this.lastAttempt.get(projectId) ?? 0,
    );
    if (now - last < SHOT_INTERVAL_MS) return;
    this.enqueue(projectId, port);
  }

  // Manual 📸 button — bypasses the throttle.
  forceCapture(projectId: string, port: number) {
    this.enqueue(projectId, port);
  }

  private enqueue(projectId: string, port: number) {
    if (this.queue.some((q) => q.projectId === projectId)) return;
    this.lastAttempt.set(projectId, Date.now());
    this.queue.push({ projectId, port });
    void this.drain();
  }

  private async drain() {
    if (this.inFlight) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inFlight = true;
    try {
      const ok = await this.capture(job.projectId, job.port);
      if (ok) {
        eventHub.publish([topics.projects], {
          t: "screenshot.updated",
          projectId: job.projectId,
          at: this.shotAt(job.projectId) ?? Date.now(),
        });
      }
    } finally {
      this.inFlight = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private capture(projectId: string, port: number): Promise<boolean> {
    if (this.browser === undefined) this.browser = resolveBrowser();
    const browser = this.browser;
    if (!browser) return Promise.resolve(false);
    fs.mkdirSync(shotsDir, { recursive: true });
    const tmp = path.join(shotsDir, `${projectId}.tmp.png`);
    return new Promise((resolve) => {
      execFile(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--window-size=1280,800",
          "--virtual-time-budget=6000",
          `--user-data-dir=${profileDir}`,
          `--screenshot=${tmp}`,
          `http://127.0.0.1:${port}/`,
        ],
        { windowsHide: true, timeout: CAPTURE_TIMEOUT_MS },
        () => {
          // Headless chrome exits non-zero surprisingly often even on success;
          // trust the artifact, not the exit code.
          try {
            if (fs.existsSync(tmp) && fs.statSync(tmp).size > 4096) {
              fs.renameSync(tmp, this.shotPath(projectId));
              return resolve(true);
            }
          } catch {
            /* fall through */
          }
          try {
            fs.rmSync(tmp, { force: true });
          } catch {
            /* ignore */
          }
          resolve(false);
        },
      );
    });
  }
}

export const screenshotService = new ScreenshotService();
