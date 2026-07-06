import { useEffect, useState } from "react";
import {
  DollarSign,
  Flame,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Coins,
  TrendingUp,
  Layers,
  Sparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CostReport, ProjectCost, DailyCost } from "@deck/shared";
import { useCostReport } from "../../lib/useCost";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUIStore } from "../../stores/uiStore";
import { fmtUsd, fmtTokens, relTime } from "../../lib/format";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";

// Stable per-model bar colors (tokens §8 palette, mixed toward the accent).
const MODEL_COLORS = [
  "var(--accent)",
  "var(--ok)",
  "var(--warn)",
  "#8b7fd0",
  "#5aa2c4",
];
function modelColor(model: string, models: string[]): string {
  const i = models.indexOf(model);
  return MODEL_COLORS[i % MODEL_COLORS.length]!;
}

// The full cost dashboard — all-time spend, the live 5-hour billing window with
// burn rate, a daily bar chart, and a per-project ranking with per-model
// breakdown. Data is Claude-only, sourced from ccusage (see cost/service.ts).
export function CostsDashboard() {
  const { data, isLoading, isFetching } = useCostReport();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Force a synchronous ccusage re-run, then repopulate the shared query.
      const { api } = await import("../../lib/api");
      const fresh = await api.cost(true);
      qc.setQueryData(["cost"], fresh);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-[980px] flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-raised text-accenttext">
            <DollarSign size={17} />
          </div>
          <h1 className="text-[16px] font-semibold text-t1">Costs</h1>
          {data?.generatedAt != null && (
            <span className="mono text-[11px] text-t3">
              updated {relTime(data.generatedAt)}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={refreshing || isFetching}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-[6px] border border-hair bg-panel px-2.5 text-[12px] text-t2 hover:bg-raised hover:text-t1 disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={cn((refreshing || isFetching) && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        {isLoading && (
          <div className="py-16 text-center text-[13px] text-t3">
            Loading usage from ccusage…
          </div>
        )}

        {data && !data.available && (
          <div className="rounded-[8px] border border-hair bg-panel p-5 text-[13px] text-t2">
            <div className="mb-1 font-medium text-t1">Cost data unavailable</div>
            <div className="text-t3">
              {data.error ??
                "ccusage couldn't be run. Make sure Bun is installed and `bunx ccusage` works from a terminal."}
            </div>
          </div>
        )}

        {data && data.available && <Report report={data} />}
      </div>
    </div>
  );
}

function Report({ report }: { report: CostReport }) {
  return (
    <>
      {/* Top stat row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<DollarSign size={14} />}
          label="All-time spend"
          value={fmtUsd(report.totalCost)}
          tint="accent"
        />
        <StatTile
          icon={<Coins size={14} />}
          label="Total tokens"
          value={fmtTokens(report.totalTokens)}
        />
        <StatTile
          icon={<Layers size={14} />}
          label="Projects tracked"
          value={`${report.projects.length}`}
        />
      </div>

      {report.budgets && <BudgetBar report={report} />}

      {report.activeBlock && (
        <ActiveBlockCard
          block={report.activeBlock}
          blockUSD={report.budgets?.blockUSD ?? null}
        />
      )}

      {report.daily.length > 0 && <DailyChart daily={report.daily} />}

      <ProjectRanking projects={report.projects} aiProject={report.aiProject ?? null} />
    </>
  );
}

// Month-to-date spend vs the monthly budget, with inline budget editing.
function BudgetBar({ report }: { report: CostReport }) {
  const qc = useQueryClient();
  const monthly = report.budgets?.monthlyUSD ?? null;
  const [edit, setEdit] = useState<string>(monthly != null ? String(monthly) : "");

  const month = new Date().toISOString().slice(0, 7);
  const mtd = report.daily
    .filter((d) => d.date.startsWith(month))
    .reduce((s, d) => s + d.cost + (d.aiCost ?? 0), 0);
  const pct = monthly && monthly > 0 ? (mtd / monthly) * 100 : 0;
  const tint =
    pct > 100 ? "var(--err)" : pct > 80 ? "var(--warn)" : "var(--accent)";

  const commit = async () => {
    const v = edit.trim() === "" ? null : Number(edit);
    if (v !== null && Number.isNaN(v)) return;
    const next = await api.patchBudgets({ monthlyUSD: v });
    qc.setQueryData<CostReport>(["cost"], (old) =>
      old ? { ...old, budgets: next } : old,
    );
  };

  return (
    <div className="rounded-[8px] border border-hair bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <DollarSign size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Monthly budget</span>
        <span className="mono ml-auto text-[11px] text-t3">
          {fmtUsd(mtd)} MTD{monthly ? ` / ${fmtUsd(monthly)}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-t3">$</span>
          <input
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="none"
            className="h-6 w-[64px] rounded-[5px] border border-hair bg-raised px-1.5 text-right text-[11.5px] tabular-nums text-t1 focus:border-hairfocus focus:outline-none"
          />
        </div>
      </div>
      {monthly ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, pct)}%`, background: tint }}
          />
        </div>
      ) : (
        <p className="text-[11px] text-t3">Set a monthly cap to track spend.</p>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint?: "accent";
}) {
  return (
    <div className="rounded-[8px] border border-hair bg-panel p-4">
      <div className="mb-2 flex items-center gap-1.5 text-t3">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.05em]">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mono text-[26px] font-semibold tabular-nums",
          tint === "accent" ? "text-accenttext" : "text-t1",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// The live Claude 5-hour billing window: how far we are into it, spend so far,
// burn rate, and the projected total at window close. Ticks the countdown
// locally; tints red when the projected total exceeds the block budget.
function ActiveBlockCard({
  block,
  blockUSD,
}: {
  block: NonNullable<CostReport["activeBlock"]>;
  blockUSD: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(1, block.endTime - block.startTime);
  const elapsed = Math.min(1, Math.max(0, (now - block.startTime) / total));
  const remainMin = Math.max(0, Math.round((block.endTime - now) / 60000));
  const projected = block.projection?.totalCost ?? 0;
  const overBudget = blockUSD != null && projected > blockUSD;

  return (
    <div
      className={cn(
        "rounded-[8px] border bg-panel p-4",
        overBudget ? "border-[color:var(--err)]" : "border-hair",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <Flame size={15} className={overBudget ? "text-[color:var(--err)]" : "text-warn"} />
        <span className="text-[13px] font-medium text-t1">
          Active 5-hour window
        </span>
        {overBudget && (
          <span className="rounded-[4px] bg-[rgba(215,84,85,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--err)]">
            over budget
          </span>
        )}
        <span className="mono ml-auto text-[11px] text-t3">
          {remainMin > 0 ? `${remainMin}m left` : "closing"}
        </span>
      </div>

      {/* Elapsed bar */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full"
          style={{
            width: `${elapsed * 100}%`,
            background: "var(--warn)",
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Spent this window" value={fmtUsd(block.costUSD)} strong />
        <MiniStat
          label="Burn rate"
          value={block.burnRate ? `${fmtUsd(block.burnRate.costPerHour)}/hr` : "—"}
        />
        <MiniStat
          label="Projected total"
          value={block.projection ? fmtUsd(block.projection.totalCost) : "—"}
        />
        <MiniStat
          label="Tokens/min"
          value={
            block.burnRate
              ? fmtTokens(Math.round(block.burnRate.tokensPerMinute))
              : "—"
          }
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10.5px] uppercase tracking-[0.04em] text-t3">
        {label}
      </div>
      <div
        className={cn(
          "mono text-[15px] tabular-nums",
          strong ? "font-semibold text-t1" : "text-t2",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// Daily spend, stacked by model (ccusage breakdowns) with Deck-internal AI as a
// top segment. Pure divs; hover for the exact value.
function DailyChart({ daily }: { daily: DailyCost[] }) {
  const days = daily.slice(-30);
  const dayTotal = (d: DailyCost) => d.cost + (d.aiCost ?? 0);
  const max = Math.max(...days.map(dayTotal), 0.0001);
  const windowCost = days.reduce((s, d) => s + dayTotal(d), 0);

  // Legend: distinct models across the window.
  const models = [
    ...new Set(days.flatMap((d) => (d.byModel ?? []).map((m) => m.model))),
  ];

  return (
    <div className="rounded-[8px] border border-hair bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Daily spend</span>
        <span className="mono ml-auto text-[11px] text-t3">
          {fmtUsd(windowCost)} · last {days.length}d
        </span>
      </div>
      <div className="flex h-[96px] items-end gap-[3px]">
        {days.map((d) => {
          const segs = (d.byModel ?? []).filter((m) => m.cost > 0);
          const ai = d.aiCost ?? 0;
          const heightPct = (dayTotal(d) / max) * 100;
          return (
            <div
              key={d.date}
              title={`${d.date} · ${fmtUsd(dayTotal(d))}${ai > 0 ? ` (AI ${fmtUsd(ai)})` : ""} · ${fmtTokens(d.totalTokens)} tok`}
              className="flex flex-1 flex-col-reverse overflow-hidden rounded-[2px]"
              style={{ height: `${Math.max(2, heightPct)}%`, minWidth: 3 }}
            >
              {segs.length > 0 ? (
                segs.map((m) => (
                  <div
                    key={m.model}
                    style={{
                      height: `${(m.cost / dayTotal(d)) * 100}%`,
                      background: modelColor(m.model, models),
                    }}
                  />
                ))
              ) : (
                <div
                  style={{
                    height: `${((d.cost / dayTotal(d)) * 100) || 100}%`,
                    background: "color-mix(in srgb, var(--accent) 55%, transparent)",
                  }}
                />
              )}
              {ai > 0 && (
                <div
                  style={{
                    height: `${(ai / dayTotal(d)) * 100}%`,
                    background: "var(--accenttext)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {models.map((m) => (
          <span key={m} className="flex items-center gap-1 text-[10px] text-t3">
            <span
              className="h-2 w-2 rounded-[2px]"
              style={{ background: modelColor(m, models) }}
            />
            {m.replace("claude-", "")}
          </span>
        ))}
        {days.some((d) => (d.aiCost ?? 0) > 0) && (
          <span className="flex items-center gap-1 text-[10px] text-t3">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--accenttext)" }} />
            Deck AI
          </span>
        )}
      </div>
    </div>
  );
}

function ProjectRanking({
  projects,
  aiProject,
}: {
  projects: ProjectCost[];
  aiProject: ProjectCost | null;
}) {
  const setTopView = useUIStore((s) => s.setTopView);
  const max = Math.max(
    ...projects.map((p) => p.cost),
    aiProject?.cost ?? 0,
    0.0001,
  );
  return (
    <div className="rounded-[8px] border border-hair bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Layers size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Cost by project</span>
        <span className="mono ml-auto text-[11px] text-t3">
          {projects.length} projects
        </span>
      </div>
      {projects.length === 0 && !aiProject ? (
        <div className="py-6 text-center text-[12px] text-t3">
          No attributed project spend yet.
        </div>
      ) : (
        <div className="flex flex-col">
          {aiProject && (
            <button
              onClick={() => setTopView("ai")}
              className="flex items-center gap-2 border-b border-hair/60 py-2 text-left hover:bg-raised/40"
            >
              <Sparkles size={14} className="ml-6 shrink-0 text-accenttext" />
              <span className="flex-1 text-[13px] text-t1">Deck internal AI</span>
              <span className="mono shrink-0 text-[11px] text-t3">
                {fmtTokens(aiProject.totalTokens)} tok · {aiProject.sessionCount} calls
              </span>
              <span className="mono w-[64px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-accenttext">
                {fmtUsd(aiProject.cost)}
              </span>
            </button>
          )}
          {projects.map((p) => (
            <ProjectRow key={p.projectId} project={p} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, max }: { project: ProjectCost; max: number }) {
  const [open, setOpen] = useState(false);
  const name = useProjectsStore((s) => s.byId[project.projectId]?.name);
  const openProject = useUIStore((s) => s.openProject);
  const knownProject = useProjectsStore((s) => !!s.byId[project.projectId]);
  const pct = (project.cost / max) * 100;
  const multiModel = project.byModel.length > 1;

  return (
    <div className="border-b border-hair/60 last:border-0">
      <div className="flex items-center gap-2 py-2">
        <button
          onClick={() => multiModel && setOpen((v) => !v)}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center text-t3",
            multiModel ? "hover:text-t1" : "opacity-0",
          )}
          aria-label="Toggle model breakdown"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <button
          onClick={() => knownProject && openProject(project.projectId)}
          className={cn(
            "min-w-0 flex-1 text-left",
            knownProject && "hover:underline",
          )}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="truncate text-[13px] text-t1">
              {name ?? project.projectId}
            </span>
            <span className="mono ml-auto shrink-0 text-[11px] text-t3">
              {fmtTokens(project.totalTokens)} tok · {project.sessionCount} sess
            </span>
            <span className="mono w-[64px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-accenttext">
              {fmtUsd(project.cost)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--accent)" }}
            />
          </div>
        </button>
      </div>

      {open && multiModel && (
        <div className="mb-2 ml-6 flex flex-col gap-1">
          {project.byModel.map((m) => (
            <div
              key={m.model}
              className="flex items-center gap-2 text-[11.5px]"
            >
              <span className="mono truncate text-t2">{m.model}</span>
              <span className="mono ml-auto text-t3">
                {fmtTokens(
                  m.inputTokens +
                    m.outputTokens +
                    m.cacheCreationTokens +
                    m.cacheReadTokens,
                )}{" "}
                tok
              </span>
              <span className="mono w-[64px] text-right tabular-nums text-t1">
                {fmtUsd(m.cost)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
