import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  RefreshCw,
  Skull,
  X,
  Globe,
  Cpu,
} from "lucide-react";
import type { SystemProcess } from "@deck/shared";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { useProjectsStore } from "../stores/projectsStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../components/ui/Toast";
import { Tooltip } from "../components/ui/Tooltip";
import { cn } from "../lib/cn";

// M19 — the System view: every listening port + every node/bun/python process,
// matched to projects, killable. Polls while open.

function runtimeLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("node")) return "node";
  if (n.startsWith("bun")) return "bun";
  if (n.startsWith("python")) return "python";
  if (n.startsWith("deno")) return "deno";
  return name.replace(/\.exe$/i, "");
}

const RUNTIME_TINT: Record<string, string> = {
  node: "text-[#7fbf7f]",
  bun: "text-[#e8c8a9]",
  python: "text-[#8fb7e8]",
  deno: "text-t2",
};

export function SystemView() {
  const qc = useQueryClient();
  const projects = useProjectsStore((s) => s.byId);
  const openProject = useUIStore((s) => s.openProject);
  const [killing, setKilling] = useState<Set<number>>(new Set());

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["system-overview"],
    queryFn: () => api.systemOverview(),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const kill = async (pid: number, label: string) => {
    setKilling((s) => new Set(s).add(pid));
    try {
      await api.killPid(pid);
      toast(`Killed ${label} (pid ${pid})`);
    } catch (err) {
      toast(`Kill failed: ${(err as Error).message}`);
    } finally {
      setKilling((s) => {
        const next = new Set(s);
        next.delete(pid);
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["system-overview"] });
    }
  };

  const procs = data?.processes ?? [];
  const ports = data?.ports ?? [];
  const orphans = procs.filter((p) => p.orphaned && p.projectId == null);

  // Group processes: known projects (name-sorted), then unmatched.
  const byProject = new Map<string | null, SystemProcess[]>();
  for (const p of procs) {
    const arr = byProject.get(p.projectId) ?? [];
    arr.push(p);
    byProject.set(p.projectId, arr);
  }
  const groups = [...byProject.entries()].sort((a, b) => {
    if (a[0] === null) return 1;
    if (b[0] === null) return -1;
    return (projects[a[0]]?.name ?? a[0]).localeCompare(
      projects[b[0]]?.name ?? b[0],
    );
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
        <Activity size={16} className="text-t3" />
        <span className="text-[14px] font-semibold text-t1">System</span>
        <span className="text-[12px] text-t3">
          {procs.length} dev processes · {ports.length} listening ports
        </span>
        {dataUpdatedAt > 0 && (
          <span className="mono text-[11px] text-t3">{relTime(dataUpdatedAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {orphans.length > 0 && (
            <button
              onClick={() => {
                for (const p of orphans) void kill(p.pid, runtimeLabel(p.name));
              }}
              className="flex h-7 items-center gap-1.5 rounded-[6px] border border-hair px-2.5 text-[12px] text-[color:var(--warn)] hover:bg-raised"
              title="Kill orphaned dev processes not matched to any project"
            >
              <Skull size={13} /> Kill {orphans.length} orphaned
            </button>
          )}
          <button
            onClick={() => void refetch()}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1"
            title="Refresh"
          >
            <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="mx-auto flex max-w-[1080px] flex-col gap-8">
          {/* ----- Processes ----- */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-t3">
              <Cpu size={13} /> Dev processes
            </h2>
            {procs.length === 0 && (
              <div className="rounded-[8px] border border-hair px-4 py-6 text-center text-[13px] text-t3">
                {data ? "No node / bun / python processes running." : "Scanning…"}
              </div>
            )}
            <div className="flex flex-col gap-4">
              {groups.map(([projectId, list]) => (
                <div key={projectId ?? "__none__"}>
                  <div className="mb-1 flex items-center gap-2">
                    {projectId ? (
                      <button
                        onClick={() => openProject(projectId)}
                        className="text-[12.5px] font-medium text-accenttext hover:underline"
                      >
                        {projects[projectId]?.name ?? projectId}
                      </button>
                    ) : (
                      <span className="text-[12.5px] font-medium text-t3">
                        Not matched to a project
                      </span>
                    )}
                    <span className="text-[11px] text-t3">{list.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-[8px] border border-hair">
                    {list.map((p, i) => (
                      <div
                        key={p.pid}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2",
                          i > 0 && "border-t border-hair",
                        )}
                      >
                        <span
                          className={cn(
                            "mono w-14 shrink-0 text-[12px] font-semibold",
                            RUNTIME_TINT[runtimeLabel(p.name)] ?? "text-t2",
                          )}
                        >
                          {runtimeLabel(p.name)}
                        </span>
                        <span className="mono w-16 shrink-0 text-[11.5px] text-t3">
                          {p.pid}
                        </span>
                        <span className="mono w-20 shrink-0 text-right text-[11.5px] text-t2">
                          {p.memoryMB.toFixed(0)} MB
                        </span>
                        <span className="w-20 shrink-0 text-[11.5px] text-t3">
                          {p.startedAt ? relTime(p.startedAt) : "—"}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {p.ports.map((port) => (
                            <a
                              key={port}
                              href={`http://localhost:${port}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mono rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-accenttext hover:underline"
                              title={`Open http://localhost:${port}`}
                            >
                              :{port}
                            </a>
                          ))}
                          {p.orphaned && (
                            <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-[color:var(--warn)]">
                              orphan
                            </span>
                          )}
                        </span>
                        <Tooltip label={p.commandLine ?? ""} side="top">
                          <span className="mono min-w-0 flex-1 truncate text-[11px] text-t3">
                            {p.commandLine ?? ""}
                          </span>
                        </Tooltip>
                        <button
                          onClick={() => void kill(p.pid, runtimeLabel(p.name))}
                          disabled={killing.has(p.pid)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-[color:var(--err)] disabled:opacity-40"
                          title="Kill process tree"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ----- Ports ----- */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-t3">
              <Globe size={13} /> Listening ports
            </h2>
            {ports.length === 0 ? (
              <div className="rounded-[8px] border border-hair px-4 py-6 text-center text-[13px] text-t3">
                {data ? "Nothing listening in the user port range." : "Scanning…"}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[8px] border border-hair">
                <div className="grid grid-cols-[90px_140px_80px_1fr_32px] items-center gap-2 border-b border-hair bg-panel px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
                  <span>Port</span>
                  <span>Process</span>
                  <span>PID</span>
                  <span>Project</span>
                  <span />
                </div>
                {ports.map((e) => (
                  <div
                    key={`${e.port}:${e.pid}`}
                    className="grid grid-cols-[90px_140px_80px_1fr_32px] items-center gap-2 border-t border-hair px-3 py-1.5 first:border-t-0"
                  >
                    <a
                      href={`http://localhost:${e.port}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-[12px] font-semibold text-accenttext hover:underline"
                    >
                      :{e.port}
                    </a>
                    <span className="mono truncate text-[11.5px] text-t2">
                      {e.processName ?? "?"}
                    </span>
                    <span className="mono text-[11.5px] text-t3">{e.pid}</span>
                    {e.projectId ? (
                      <button
                        onClick={() => openProject(e.projectId!)}
                        className="truncate text-left text-[12px] text-accenttext hover:underline"
                      >
                        {projects[e.projectId]?.name ?? e.projectId}
                      </button>
                    ) : (
                      <span className="text-[12px] text-t3">—</span>
                    )}
                    <button
                      onClick={() => void kill(e.pid, e.processName ?? "process")}
                      disabled={killing.has(e.pid)}
                      className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-[color:var(--err)] disabled:opacity-40"
                      title="Kill owning process tree"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
