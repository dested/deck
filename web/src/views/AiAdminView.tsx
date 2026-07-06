import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, TrendingUp, Zap, DollarSign, Activity } from "lucide-react";
import type {
  AiConfigView,
  AiFeatureConfigView,
  AiUsageReport,
} from "@deck/shared";
import { useAiConfig, useAiUsage } from "../lib/useAi";
import { api } from "../lib/api";
import { fmtUsd, fmtUsdMicro, fmtTokens, relTime } from "../lib/format";
import { cn } from "../lib/cn";
import { Switch } from "../components/ui/Switch";
import { toast } from "../components/ui/Toast";

const MODELS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"];

// AI Admin — the control room for every AI call Deck makes on its own behalf:
// per-feature model + budget, live spend, and the raw call ledger.
export function AiAdminView() {
  const { data: config } = useAiConfig();
  const { data: usage } = useAiUsage(30);
  const qc = useQueryClient();

  const patch = async (body: Parameters<typeof api.patchAiConfig>[0]) => {
    const next = await api.patchAiConfig(body);
    qc.setQueryData(["ai", "config"], next);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5" style={{ scrollbarGutter: "stable" }}>
      <div className="mx-auto flex max-w-[980px] flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-raised text-accenttext">
            <Sparkles size={17} />
          </div>
          <h1 className="text-[16px] font-semibold text-t1">AI Admin</h1>
          <span className="mono text-[11px] text-t3">
            Deck-internal AI spend & controls
          </span>
          <TestButton />
        </div>

        {config && <StatRow config={config} usage={usage} />}
        {config && <FeatureTable config={config} onPatch={patch} />}
        {usage && usage.byDay.length > 0 && <DailyChart usage={usage} />}
        {config && <BackendCard config={config} onPatch={patch} />}
        {usage && <RecentCalls usage={usage} />}
      </div>
    </div>
  );
}

function TestButton() {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const run = async () => {
    setBusy(true);
    try {
      const res = await api.aiTest();
      toast(
        `AI ok · ${res.model} · ${fmtUsdMicro(res.costUSD)} · ${res.durationMs}ms`,
        "ok",
      );
      qc.invalidateQueries({ queryKey: ["ai"] });
    } catch {
      toast("AI test failed (feature off, over budget, or no claude)", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={run}
      disabled={busy}
      className="ml-auto flex h-7 items-center gap-1.5 rounded-[6px] border border-hair bg-panel px-2.5 text-[12px] text-t2 hover:bg-raised hover:text-t1 disabled:opacity-50"
    >
      <Zap size={13} className={cn(busy && "animate-pulse")} /> Test
    </button>
  );
}

function StatRow({
  config,
  usage,
}: {
  config: AiConfigView;
  usage: AiUsageReport | undefined;
}) {
  const callsToday = config.features.reduce((s, f) => s + f.callsToday, 0);
  const last7 = usage
    ? usage.byDay.slice(-7).reduce((s, d) => s + d.cost, 0)
    : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile icon={<DollarSign size={14} />} label="Spent today" value={fmtUsdMicro(config.spentTodayUSD)} tint />
      <Tile icon={<TrendingUp size={14} />} label="Last 7 days" value={fmtUsd(last7)} />
      <Tile icon={<TrendingUp size={14} />} label="Last 30 days" value={fmtUsd(usage?.totalCost ?? 0)} />
      <Tile icon={<Activity size={14} />} label="Calls today" value={`${callsToday}`} />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint?: boolean;
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
          "mono text-[22px] font-semibold tabular-nums",
          tint ? "text-accenttext" : "text-t1",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FeatureTable({
  config,
  onPatch,
}: {
  config: AiConfigView;
  onPatch: (body: Parameters<typeof api.patchAiConfig>[0]) => void;
}) {
  return (
    <div className="rounded-[8px] border border-hair bg-panel">
      <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
        <Sparkles size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Features</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-t3">Global daily budget</span>
          <BudgetInput
            value={config.globalDailyBudgetUSD}
            onCommit={(v) => onPatch({ globalDailyBudgetUSD: v })}
          />
        </div>
      </div>
      <div className="flex flex-col">
        {config.features.map((f) => (
          <FeatureRow key={f.feature} f={f} onPatch={onPatch} />
        ))}
      </div>
    </div>
  );
}

function FeatureRow({
  f,
  onPatch,
}: {
  f: AiFeatureConfigView;
  onPatch: (body: Parameters<typeof api.patchAiConfig>[0]) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-hair/60 px-4 py-2.5 last:border-0">
      <Switch checked={f.enabled} onChange={(v) => onPatch({ feature: f.feature, enabled: v })} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-t1">{f.label}</span>
          {f.capped && (
            <span className="rounded-[4px] bg-[rgba(217,160,63,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-warn">
              capped
            </span>
          )}
        </div>
        <span className="mono text-[10.5px] text-t3">{f.feature}</span>
      </div>
      <select
        value={f.model}
        onChange={(e) => onPatch({ feature: f.feature, model: e.target.value })}
        className="h-7 rounded-[6px] border border-hair bg-raised px-1.5 text-[11.5px] text-t2 focus:border-hairfocus focus:outline-none"
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {m.replace("claude-", "")}
          </option>
        ))}
      </select>
      <BudgetInput
        value={f.dailyBudgetUSD}
        onCommit={(v) => onPatch({ feature: f.feature, dailyBudgetUSD: v })}
      />
      <div className="w-[120px] shrink-0 text-right">
        <span className="mono text-[12px] tabular-nums text-t1">
          {fmtUsdMicro(f.spentTodayUSD)}
        </span>
        <span className="mono ml-1.5 text-[11px] text-t3">{f.callsToday} calls</span>
      </div>
    </div>
  );
}

function BudgetInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(String(value));
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-t3">$</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (!Number.isNaN(n) && n !== value) onCommit(n);
          else setV(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 w-[52px] rounded-[6px] border border-hair bg-raised px-1.5 text-right text-[11.5px] tabular-nums text-t1 focus:border-hairfocus focus:outline-none"
      />
    </div>
  );
}

function DailyChart({ usage }: { usage: AiUsageReport }) {
  const days = usage.byDay.slice(-30);
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  return (
    <div className="rounded-[8px] border border-hair bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Daily AI spend</span>
        <span className="mono ml-auto text-[11px] text-t3">
          {fmtUsd(usage.totalCost)} · last {days.length}d
        </span>
      </div>
      <div className="flex h-[80px] items-end gap-[3px]">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date} · ${fmtUsdMicro(d.cost)} · ${d.calls} calls`}
            className="flex-1 rounded-[2px]"
            style={{
              height: `${Math.max(2, (d.cost / max) * 100)}%`,
              minWidth: 3,
              background: "color-mix(in srgb, var(--accent) 55%, transparent)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function BackendCard({
  config,
  onPatch,
}: {
  config: AiConfigView;
  onPatch: (body: Parameters<typeof api.patchAiConfig>[0]) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-hair bg-panel p-4">
      <span className="text-[13px] text-t1">Backend</span>
      <div className="flex overflow-hidden rounded-[6px] border border-hair">
        {(["claude-cli", "api"] as const).map((b) => (
          <button
            key={b}
            onClick={() => onPatch({ backend: b })}
            className={cn(
              "px-3 py-1 text-[12px]",
              config.backend === b
                ? "bg-accent text-white"
                : "bg-raised text-t2 hover:text-t1",
            )}
          >
            {b === "claude-cli" ? "Claude CLI" : "API"}
          </button>
        ))}
      </div>
      <span className="mono ml-auto text-[11px] text-t3">
        API key detected: {config.apiKeyPresent ? "yes" : "no"}
      </span>
    </div>
  );
}

function RecentCalls({ usage }: { usage: AiUsageReport }) {
  return (
    <div className="rounded-[8px] border border-hair bg-panel">
      <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
        <Activity size={15} className="text-t3" />
        <span className="text-[13px] font-medium text-t1">Recent calls</span>
        <span className="mono ml-auto text-[11px] text-t3">
          {usage.recent.length}
        </span>
      </div>
      {usage.recent.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-t3">No calls yet.</div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-panel text-t3">
              <tr className="text-left">
                <th className="px-4 py-1.5 font-medium">Time</th>
                <th className="px-2 py-1.5 font-medium">Feature</th>
                <th className="px-2 py-1.5 font-medium">Model</th>
                <th className="px-2 py-1.5 text-right font-medium">In/Out</th>
                <th className="px-2 py-1.5 text-right font-medium">Cost</th>
                <th className="px-2 py-1.5 text-right font-medium">ms</th>
                <th className="px-4 py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {usage.recent.map((e, i) => (
                <tr key={i} className="border-t border-hair/50">
                  <td className="mono px-4 py-1.5 text-t3">{relTime(e.ts)}</td>
                  <td className="px-2 py-1.5 text-t2">{e.feature}</td>
                  <td className="mono px-2 py-1.5 text-t3">
                    {e.model.replace("claude-", "")}
                  </td>
                  <td className="mono px-2 py-1.5 text-right tabular-nums text-t3">
                    {fmtTokens(e.inputTokens)}/{fmtTokens(e.outputTokens)}
                  </td>
                  <td className="mono px-2 py-1.5 text-right tabular-nums text-t1">
                    {fmtUsdMicro(e.costUSD)}
                  </td>
                  <td className="mono px-2 py-1.5 text-right tabular-nums text-t3">
                    {e.durationMs}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {e.ok ? (
                      <span className="text-ok">ok</span>
                    ) : (
                      <span className="text-[color:var(--err)]">
                        {e.error ?? "err"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
