import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUp,
  Boxes,
  Bug,
  CircleDot,
  Database,
  FileText,
  FlaskConical,
  Info,
  LayoutPanelLeft,
  Package,
  Plug,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type {
  AuditImpactArea,
  AuditRiskLevel,
  AuditSeverity,
  GitAuditReport,
} from "@deck/shared";
import { api } from "../../lib/api";
import { relTime } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

// PR audit panel (Git tab right pane): one AI pre-merge report — risk, blast
// radius, findings, before-merge checklist — plus an ask box. Everything is
// built to be scanned in seconds: one headline, colored badges, one-liners.

const RISK: Record<
  AuditRiskLevel,
  { label: string; cls: string; bar: string }
> = {
  low: {
    label: "LOW RISK",
    cls: "bg-[rgba(70,180,134,0.14)] text-[color:var(--ok)]",
    bar: "var(--ok)",
  },
  medium: {
    label: "MEDIUM RISK",
    cls: "bg-[rgba(217,160,63,0.14)] text-[color:var(--warn)]",
    bar: "var(--warn)",
  },
  high: {
    label: "HIGH RISK",
    cls: "bg-[rgba(215,84,85,0.16)] text-[color:var(--err)]",
    bar: "var(--err)",
  },
};

const SEV: Record<
  AuditSeverity,
  { icon: typeof Bug; cls: string; label: string }
> = {
  bug: { icon: Bug, cls: "text-[color:var(--err)]", label: "bug" },
  risk: { icon: AlertTriangle, cls: "text-[color:var(--warn)]", label: "risk" },
  nit: { icon: Info, cls: "text-t3", label: "nit" },
};

const AREA_ICON: Record<AuditImpactArea, typeof Database> = {
  db: Database,
  api: Plug,
  ui: LayoutPanelLeft,
  state: Boxes,
  config: Settings2,
  deps: Package,
  infra: Server,
  tests: FlaskConical,
  docs: FileText,
  other: CircleDot,
};

const AREA_LABEL: Record<AuditImpactArea, string> = {
  db: "Database",
  api: "API",
  ui: "UI",
  state: "State",
  config: "Config",
  deps: "Deps",
  infra: "Infra",
  tests: "Tests",
  docs: "Docs",
  other: "Other",
};

// Q/A threads survive the panel unmounting (switching to a file diff and back).
const askThreads: Record<string, { q: string; a: string }[]> = {};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-t3 uppercase">
      {children}
    </div>
  );
}

function FileChip({
  path,
  line,
  onOpen,
}: {
  path: string;
  line?: number | null;
  onOpen: (path: string) => void;
}) {
  const short = path.length > 46 ? `…${path.slice(-45)}` : path;
  return (
    <button
      onClick={() => onOpen(path)}
      title={path}
      className="mono max-w-full truncate rounded-[4px] bg-raised px-1.5 py-px text-[11px] text-accenttext hover:bg-overlay"
    >
      {short}
      {line ? `:${line}` : ""}
    </button>
  );
}

export function AuditPanel({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState(askThreads[projectId] ?? []);
  const [error, setError] = useState<string | null>(null);
  const askEndRef = useRef<HTMLDivElement>(null);

  const { data: state } = useQuery({
    queryKey: ["git", projectId, "audit"],
    queryFn: () => api.gitAuditState(projectId),
  });

  const run = useMutation({
    mutationFn: () => api.gitAuditRun(projectId),
    onMutate: () => setError(null),
    onSuccess: (report: GitAuditReport) => {
      setChecked({});
      qc.setQueryData(["git", projectId, "audit"], {
        report,
        stale: false,
      });
    },
    onError: (e) => setError(String(e).replace(/^Error:\s*/, "").slice(0, 140)),
  });

  const ask = useMutation({
    mutationFn: (q: string) => api.gitAuditAsk(projectId, q),
    onMutate: () => setError(null),
    onSuccess: (res, q) => {
      const next = [...(askThreads[projectId] ?? []), { q, a: res.answer }];
      askThreads[projectId] = next;
      setThread(next);
    },
    onError: (e) => setError(String(e).replace(/^Error:\s*/, "").slice(0, 140)),
  });

  useEffect(() => {
    askEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length]);

  const report = state?.report ?? null;
  const running = run.isPending;

  const submitQuestion = () => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    setQuestion("");
    ask.mutate(q);
  };

  // ----- empty / first-run state -----
  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <ShieldCheck size={26} className={cn("text-t3", running && "animate-pulse text-accenttext")} />
        <div className="text-[15px] font-semibold text-t1">PR Audit</div>
        <div className="max-w-[360px] text-[12.5px] leading-relaxed text-t2">
          One AI pass over the whole change + the cliffnotes: risk of merging,
          blast radius, likely bugs, and a before-merge checklist.
        </div>
        <Button variant="primary" size="sm" disabled={running} onClick={() => run.mutate()}>
          {running ? (
            <>
              <RefreshCw size={13} className="animate-spin" /> Auditing… (1–3 min)
            </>
          ) : (
            "Run audit"
          )}
        </Button>
        {error && (
          <div className="text-[12px] text-[color:var(--err)]">{error}</div>
        )}
      </div>
    );
  }

  const risk = RISK[report.risk.level];
  const bugCount = report.findings.filter((f) => f.severity === "bug").length;

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
      <div className="mx-auto max-w-[760px] px-6 py-5">
        {/* Header: risk + headline + rerun */}
        <div
          className="rounded-[8px] border border-hair bg-panel p-4"
          style={{ borderLeft: `3px solid ${risk.bar}` }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10.5px] font-bold tracking-wide",
                risk.cls,
              )}
            >
              {risk.label}
            </span>
            {bugCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-[rgba(215,84,85,0.16)] px-2 py-0.5 text-[10.5px] font-bold text-[color:var(--err)]">
                <Bug size={11} /> {bugCount} likely bug{bugCount === 1 ? "" : "s"}
              </span>
            )}
            {state?.stale && !running && (
              <span className="rounded-full bg-[rgba(217,160,63,0.14)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--warn)]">
                diff changed — re-run
              </span>
            )}
            <button
              onClick={() => run.mutate()}
              disabled={running}
              title="Re-run audit"
              className="ml-auto flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11.5px] text-t2 hover:bg-raised hover:text-t1 disabled:opacity-50"
            >
              <RefreshCw size={12} className={cn(running && "animate-spin")} />
              {running ? "auditing…" : "re-run"}
            </button>
          </div>
          <div className="mt-2 text-[15px] font-semibold leading-snug text-t1">
            {report.headline}
          </div>
          {report.verdict && (
            <div className="mt-1 text-[12.5px] leading-relaxed text-t2">
              {report.verdict}
            </div>
          )}
          {report.risk.why && (
            <div className="mt-1.5 text-[12px] leading-relaxed text-t2">
              <span className="font-semibold" style={{ color: risk.bar }}>
                Why:{" "}
              </span>
              {report.risk.why}
            </div>
          )}
          <div className="mono mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-t3">
            <span>{report.scope === "working" ? "working tree" : "unpushed commits"}</span>
            <span>{report.branch}</span>
            <span>
              {report.stats.files} files{" "}
              <span className="text-[color:var(--ok)]">+{report.stats.additions}</span>{" "}
              <span className="text-[color:var(--err)]">−{report.stats.deletions}</span>
            </span>
            <span>{relTime(report.generatedAt)}</span>
            <span>
              {report.model.replace("claude-", "")} · ${report.costUSD.toFixed(2)}
            </span>
          </div>
          {error && (
            <div className="mt-2 text-[12px] text-[color:var(--err)]">{error}</div>
          )}
        </div>

        {/* Findings — the reason this exists, so it comes first */}
        {report.findings.length > 0 && (
          <div className="mt-5">
            <SectionLabel>Findings</SectionLabel>
            <div className="flex flex-col gap-1">
              {report.findings.map((f, i) => {
                const sev = SEV[f.severity];
                const Icon = sev.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-[6px] border border-hair bg-panel px-2.5 py-2"
                  >
                    <Icon size={14} className={cn("mt-0.5 shrink-0", sev.cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[12.5px] font-semibold text-t1">
                          {f.title}
                        </span>
                        {f.file && (
                          <FileChip path={f.file} line={f.line} onOpen={onOpenFile} />
                        )}
                      </div>
                      {f.detail && (
                        <div className="mt-0.5 text-[12px] leading-relaxed text-t2">
                          {f.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {report.findings.length === 0 && (
          <div className="mt-5 flex items-center gap-2 rounded-[6px] border border-hair bg-panel px-3 py-2.5 text-[12.5px] text-t2">
            <ShieldCheck size={14} className="text-[color:var(--ok)]" />
            No bugs or risks spotted.
          </div>
        )}

        {/* Impact — blast radius by area */}
        {report.impacts.length > 0 && (
          <div className="mt-5">
            <SectionLabel>Impact</SectionLabel>
            <div className="flex flex-col gap-1">
              {report.impacts.map((imp, i) => {
                const Icon = AREA_ICON[imp.area] ?? CircleDot;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-[6px] px-2.5 py-1.5 hover:bg-panel"
                  >
                    <span className="mt-0.5 flex w-[74px] shrink-0 items-center gap-1.5 text-[11px] font-semibold text-t3">
                      <Icon size={13} />
                      {AREA_LABEL[imp.area] ?? imp.area}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-[12.5px] leading-relaxed text-t1">
                        {imp.summary}
                      </span>
                      {imp.files.length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {imp.files.map((p) => (
                            <FileChip key={p} path={p} onOpen={onOpenFile} />
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Features touched (per cliffnotes) */}
        {report.features.length > 0 && (
          <div className="mt-5">
            <SectionLabel>Features touched</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {report.features.map((f, i) => (
                <span
                  key={i}
                  className="rounded-full border border-hair bg-panel px-2.5 py-1 text-[11.5px] text-t2"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Before-merge checklist (checkboxes are local scratch state) */}
        {report.checklist.length > 0 && (
          <div className="mt-5">
            <SectionLabel>Before merge</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {report.checklist.map((item, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 rounded-[5px] px-2 py-1 text-[12.5px] leading-relaxed hover:bg-panel"
                >
                  <input
                    type="checkbox"
                    checked={!!checked[i]}
                    onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                    className="mt-[3px] accent-[var(--accent)]"
                  />
                  <span className={cn(checked[i] ? "text-t3 line-through" : "text-t1")}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Ask about this change */}
        <div className="mt-6 border-t border-hair pt-4">
          <SectionLabel>Ask about this change</SectionLabel>
          {thread.length > 0 && (
            <div className="mb-2 flex flex-col gap-2">
              {thread.map((qa, i) => (
                <div key={i} className="rounded-[6px] border border-hair bg-panel px-3 py-2">
                  <div className="text-[12px] font-semibold text-accenttext">{qa.q}</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-wrap text-t1">
                    {qa.a}
                  </div>
                </div>
              ))}
              <div ref={askEndRef} />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitQuestion();
              }}
              placeholder={
                ask.isPending ? "Thinking…" : "e.g. does anything break if the server isn't restarted?"
              }
              disabled={ask.isPending}
              className="h-8 min-w-0 flex-1 rounded-[6px] border border-hair bg-raised px-2.5 text-[12.5px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={submitQuestion}
              disabled={!question.trim() || ask.isPending}
              aria-label="Ask"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-hair bg-raised text-t2 hover:bg-overlay hover:text-t1 disabled:opacity-40"
            >
              {ask.isPending ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <ArrowUp size={14} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
