import { execFile } from "node:child_process";
import type {
  SystemOverview,
  SystemPortEntry,
  SystemProcess,
} from "@deck/shared";
import { listListeningPorts } from "../projects/ports.js";
import { projectRegistry } from "../projects/registry.js";

// M19 — the system suite: every listening TCP port (user range) + every dev
// runtime process (node/bun/deno/python), matched back to Deck projects by
// command line, killable. On-demand only (the System view polls while open);
// a short cache absorbs overlapping refreshes.

const CACHE_MS = 3_000;
const DEV_NAMES = ["node.exe", "bun.exe", "deno.exe"];

let cached: SystemOverview | null = null;
let inFlight: Promise<SystemOverview> | null = null;

interface RawProc {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  CommandLine: string | null;
  WorkingSetSize: number | null;
  Created: number | null;
}

// One PowerShell round-trip: all live pids (for orphan detection) + full rows
// for dev runtimes and any process that owns a listening port.
function queryProcesses(
  portPids: number[],
): Promise<{ alive: Set<number>; procs: RawProc[] }> {
  const devList = DEV_NAMES.map((n) => `'${n}'`).join(",");
  const pidList = portPids.length > 0 ? portPids.join(",") : "0";
  const script = [
    `$ErrorActionPreference='SilentlyContinue'`,
    `$portPids=@(${pidList})`,
    `$dev=@(${devList})`,
    `$alive=(Get-Process).Id`,
    `$rows=Get-CimInstance Win32_Process | Where-Object { $dev -contains $_.Name -or $_.Name -like 'python*' -or $portPids -contains $_.ProcessId } | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,@{n='Created';e={ if ($_.CreationDate) { [long]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null } }}`,
    `@{ alive=$alive; procs=@($rows) } | ConvertTo-Json -Compress -Depth 4`,
  ].join("; ");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 25_000 },
      (err, stdout) => {
        const empty = { alive: new Set<number>(), procs: [] as RawProc[] };
        if (err || !stdout.trim()) return resolve(empty);
        try {
          const parsed = JSON.parse(stdout) as {
            alive: number | number[];
            procs: RawProc | RawProc[] | null;
          };
          const alive = new Set(
            Array.isArray(parsed.alive) ? parsed.alive : [parsed.alive],
          );
          const procs = parsed.procs
            ? Array.isArray(parsed.procs)
              ? parsed.procs
              : [parsed.procs]
            : [];
          resolve({ alive, procs });
        } catch {
          resolve(empty);
        }
      },
    );
  });
}

function matchProject(commandLine: string | null): string | null {
  if (!commandLine) return null;
  const cmd = commandLine.toLowerCase();
  for (const p of projectRegistry.getAll()) {
    if (p.kind === "root") continue;
    const path = p.path.toLowerCase();
    if (cmd.includes(path) || cmd.includes(path.replace(/\\/g, "/"))) {
      return p.id;
    }
  }
  return null;
}

async function scan(): Promise<SystemOverview> {
  const portsByPid = await listListeningPorts();
  const { alive, procs } = await queryProcesses([...portsByPid.keys()]);

  const byPid = new Map(procs.map((r) => [r.ProcessId, r]));

  const processes: SystemProcess[] = procs
    .filter(
      (r) =>
        DEV_NAMES.includes(r.Name?.toLowerCase() ?? "") ||
        /^python/i.test(r.Name ?? ""),
    )
    .map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: r.Name,
      commandLine: r.CommandLine ?? null,
      memoryMB: Math.round(((r.WorkingSetSize ?? 0) / 1024 / 1024) * 10) / 10,
      startedAt: r.Created ?? null,
      projectId: matchProject(r.CommandLine ?? null),
      ports: portsByPid.get(r.ProcessId) ?? [],
      orphaned: alive.size > 0 && !alive.has(r.ParentProcessId),
    }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  const ports: SystemPortEntry[] = [];
  for (const [pid, list] of portsByPid) {
    const row = byPid.get(pid);
    for (const port of list) {
      ports.push({
        port,
        pid,
        processName: row?.Name ?? null,
        projectId: matchProject(row?.CommandLine ?? null),
      });
    }
  }
  ports.sort((a, b) => a.port - b.port);

  return { generatedAt: Date.now(), processes, ports };
}

export async function systemOverview(force = false): Promise<SystemOverview> {
  if (!force && cached && Date.now() - cached.generatedAt < CACHE_MS) {
    return cached;
  }
  if (!inFlight) {
    inFlight = scan()
      .then((r) => {
        cached = r;
        return r;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

// Tree-kill (taskkill /T) so a dev server's child watchers die with it.
// Refuses Deck's own process tree and system pids.
export function killProcess(pid: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(pid) || pid <= 4) {
    return Promise.resolve({ ok: false, error: "invalid pid" });
  }
  if (pid === process.pid || pid === process.ppid) {
    return Promise.resolve({ ok: false, error: "refusing to kill Deck itself" });
  }
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: 10_000 },
      (err, _stdout, stderr) => {
        cached = null; // next overview reflects the kill immediately
        if (err) {
          resolve({ ok: false, error: stderr.trim() || err.message });
        } else {
          resolve({ ok: true });
        }
      },
    );
  });
}
