import { execFile } from "node:child_process";
import type { LivePortMap } from "@deck/shared";
import { projectRegistry } from "./registry.js";
import { eventHub, topics } from "../ws/events.js";

// Live dev-server detection. Every POLL_MS: `netstat -ano` for LISTENING TCP
// ports, then resolve unknown owning PIDs to command lines via CIM and match
// them to project paths (node/bun/vite command lines nearly always contain the
// project dir). Result: projectId -> [ports], pushed to clients on change.

const POLL_MS = 20_000;
const MAX_PID_BATCH = 64;

type LiveListener = (projectId: string, port: number) => void;

class PortWatcher {
  private live: LivePortMap = {};
  private cmdlineByPid = new Map<number, string | null>();
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private listeners = new Set<LiveListener>();

  start() {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => void this.scan(), POLL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getLive(): LivePortMap {
    return this.live;
  }

  // Fires whenever a (project, port) pair is seen live — including pairs that
  // were already live on a previous tick (screenshots throttle on their own).
  onLive(l: LiveListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const portsByPid = await listListeningPorts();
      const pids = [...portsByPid.keys()];

      // Evict cmdline cache entries for dead pids (pid reuse safety).
      for (const pid of [...this.cmdlineByPid.keys()]) {
        if (!portsByPid.has(pid)) this.cmdlineByPid.delete(pid);
      }
      const unknown = pids
        .filter((p) => !this.cmdlineByPid.has(p))
        .slice(0, MAX_PID_BATCH);
      if (unknown.length > 0) {
        const resolved = await resolveCommandLines(unknown);
        for (const pid of unknown) {
          this.cmdlineByPid.set(pid, resolved.get(pid) ?? null);
        }
      }

      // Match command lines to project paths.
      const projects = projectRegistry.getAll();
      const next: LivePortMap = {};
      for (const [pid, ports] of portsByPid) {
        const cmd = this.cmdlineByPid.get(pid);
        if (!cmd) continue;
        const cmdLower = cmd.toLowerCase();
        for (const proj of projects) {
          const p = proj.path.toLowerCase();
          if (!cmdLower.includes(p) && !cmdLower.includes(p.replace(/\\/g, "/")))
            continue;
          const arr = next[proj.id] ?? (next[proj.id] = []);
          for (const port of ports) if (!arr.includes(port)) arr.push(port);
          break; // projects are siblings — first match is the match
        }
      }
      for (const arr of Object.values(next)) arr.sort((a, b) => a - b);

      if (JSON.stringify(next) !== JSON.stringify(this.live)) {
        this.live = next;
        eventHub.publish([topics.projects], {
          t: "ports.updated",
          payload: next,
        });
      }
      for (const [projectId, ports] of Object.entries(next)) {
        if (ports[0] != null) {
          for (const l of this.listeners) l(projectId, ports[0]);
        }
      }
    } catch {
      /* netstat/CIM hiccups are non-fatal; retry next tick */
    } finally {
      this.scanning = false;
    }
  }
}

export function listListeningPorts(): Promise<Map<number, number[]>> {
  return new Promise((resolve) => {
    execFile(
      "netstat",
      ["-ano", "-p", "TCP"],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 },
      (err, stdout) => {
        const byPid = new Map<number, number[]>();
        if (err || !stdout) return resolve(byPid);
        for (const line of stdout.split(/\r?\n/)) {
          //   TCP    127.0.0.1:12345    0.0.0.0:0    LISTENING    31812
          const m = line.match(
            /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/,
          );
          if (!m) continue;
          const port = Number(m[1]);
          const pid = Number(m[2]);
          // Dev servers live in the user range; skip system listeners + pid 0/4.
          if (port < 1000 || pid <= 4) continue;
          const arr = byPid.get(pid) ?? [];
          if (!arr.includes(port)) arr.push(port);
          byPid.set(pid, arr);
        }
        resolve(byPid);
      },
    );
  });
}

function resolveCommandLines(
  pids: number[],
): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    const filter = pids.map((p) => `ProcessId=${p}`).join(" OR ");
    const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 },
      (err, stdout) => {
        const out = new Map<number, string>();
        if (err || !stdout.trim()) return resolve(out);
        try {
          const parsed = JSON.parse(stdout) as
            | { ProcessId: number; CommandLine: string | null }
            | { ProcessId: number; CommandLine: string | null }[];
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          for (const r of rows) {
            if (r && typeof r.ProcessId === "number" && r.CommandLine) {
              out.set(r.ProcessId, r.CommandLine);
            }
          }
        } catch {
          /* ignore parse errors */
        }
        resolve(out);
      },
    );
  });
}

export const portWatcher = new PortWatcher();
