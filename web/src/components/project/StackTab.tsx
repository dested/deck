import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Database,
  Eye,
  EyeOff,
  Pencil,
  RefreshCw,
  Sparkles,
  Play,
  Square,
  ExternalLink,
  Check,
  X,
  Table2,
  Package,
} from "lucide-react";
import type {
  DbQueryResult,
  EnvFile,
  EnvVar,
  EnvVarCategory,
  StackBadge,
} from "@deck/shared";
import { api } from "../../lib/api";
import { toast } from "../ui/Toast";
import { cn } from "../../lib/cn";

// M20 — the Stack tab: what this project talks to. Env files (scanned a few
// dirs deep, grouped by monorepo workspace) with masked values (reveal / edit
// in place, backed up server-side), stack badges, and a database panel:
// connection test, tables + row counts, an AI query box, and Prisma Studio
// embedded via iframe.

const BADGE_LABEL: Record<StackBadge, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  postgres: "Postgres",
  mysql: "MySQL",
  sqlite: "SQLite",
  prisma: "Prisma",
  drizzle: "Drizzle",
  redis: "Redis",
  supabase: "Supabase",
  stripe: "Stripe",
  s3: "S3/AWS",
};

const CATEGORY_LABEL: Partial<Record<EnvVarCategory, string>> = {
  ai: "AI",
  database: "DB",
  auth: "auth",
  payments: "pay",
  storage: "storage",
  email: "email",
  urls: "url",
  config: "config",
};

export function StackTab({ projectId }: { projectId: string }) {
  const { data: stack, refetch } = useQuery({
    queryKey: ["stack", projectId],
    queryFn: () => api.stack(projectId),
  });

  const hasDb = stack?.databaseUrl != null;

  // Monorepo grouping: files bucketed by workspace ("" = repo root first).
  const workspaces = useMemo(() => {
    const m = new Map<string, EnvFile[]>();
    for (const f of stack?.files ?? []) {
      const key = f.workspace ?? "";
      const list = m.get(key);
      if (list) list.push(f);
      else m.set(key, [f]);
    }
    return [...m.entries()].sort(([a], [b]) =>
      a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
    );
  }, [stack]);

  return (
    <div
      className="h-full overflow-y-auto px-6 py-5"
      style={{ scrollbarGutter: "stable" }}
    >
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6">
        {/* Badges */}
        <section className="flex items-center gap-2">
          <Layers size={14} className="text-t3" />
          {stack ? (
            stack.badges.length > 0 ? (
              stack.badges.map((b) => (
                <span
                  key={b}
                  className="rounded-[5px] border border-hair bg-panel px-2 py-0.5 text-[11.5px] text-t1"
                >
                  {BADGE_LABEL[b]}
                </span>
              ))
            ) : (
              <span className="text-[12.5px] text-t3">
                No stack markers detected (env files, prisma schema).
              </span>
            )
          ) : (
            <span className="text-[12.5px] text-t3">Scanning…</span>
          )}
          <button
            onClick={() => void refetch()}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
            title="Rescan"
          >
            <RefreshCw size={13} />
          </button>
        </section>

        {/* Database */}
        {hasDb && stack && (
          <DbPanel
            projectId={projectId}
            provider={stack.databaseUrl!.provider}
            urlMasked={stack.databaseUrl!.masked}
            urlFile={stack.databaseUrl!.file}
            urlKey={stack.databaseUrl!.key}
            hasPrisma={stack.prismaSchemaPath != null}
          />
        )}

        {/* Env files */}
        <section>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-t3">
            Environment
          </h2>
          {stack && stack.files.length === 0 && (
            <div className="rounded-[8px] border border-hair px-4 py-6 text-center text-[13px] text-t3">
              No .env files in this project.
            </div>
          )}
          <div className="flex flex-col gap-4">
            {workspaces.map(([ws, wsFiles]) => (
              <div key={ws || "__root"} className="flex flex-col gap-3">
                {workspaces.length > 1 && (
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-t2">
                    <Package size={12} className="text-t3" />
                    {ws || "repo root"}
                    <span className="font-normal text-t3">
                      · {wsFiles.length} file{wsFiles.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {wsFiles.map((f) => (
                  <div
                    key={f.path}
                    className="overflow-hidden rounded-[8px] border border-hair"
                  >
                    <div className="border-b border-hair bg-panel px-3 py-1.5">
                      <span className="mono text-[11.5px] font-semibold text-t1">
                        {f.path}
                      </span>
                      <span className="ml-2 text-[11px] text-t3">
                        {f.vars.length} vars
                      </span>
                    </div>
                    {f.vars.map((v) => (
                      <EnvRow
                        key={v.key}
                        projectId={projectId}
                        file={f.path}
                        v={v}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EnvRow({
  projectId,
  file,
  v,
}: {
  projectId: string;
  file: string;
  v: EnvVar;
}) {
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const reveal = async () => {
    if (revealed != null) return setRevealed(null);
    try {
      const { value } = await api.revealEnv(projectId, file, v.key);
      setRevealed(value);
    } catch {
      toast("Reveal failed");
    }
  };

  const startEdit = async () => {
    try {
      const { value } = await api.revealEnv(projectId, file, v.key);
      setDraft(value);
      setEditing(true);
    } catch {
      toast("Could not read current value");
    }
  };

  const save = async () => {
    try {
      await api.setEnv(projectId, file, v.key, draft);
      toast(`${v.key} updated (backup saved)`);
      setEditing(false);
      setRevealed(null);
      void qc.invalidateQueries({ queryKey: ["stack", projectId] });
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="group flex items-center gap-2 border-t border-hair px-3 py-1.5 first:border-t-0">
      <span className="mono w-64 shrink-0 truncate text-[11.5px] text-t2">
        {v.key}
      </span>
      <span className="w-14 shrink-0">
        {v.category && CATEGORY_LABEL[v.category] && (
          <span className="rounded-[4px] border border-hair bg-panel px-1 py-px text-[9.5px] uppercase tracking-wide text-t3">
            {CATEGORY_LABEL[v.category]}
          </span>
        )}
      </span>
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="mono h-6 min-w-0 flex-1 rounded-[4px] border border-hairfocus bg-raised px-2 text-[11.5px] text-t1 focus:outline-none"
          />
          <button onClick={() => void save()} className="text-t3 hover:text-[color:var(--ok)]" title="Save">
            <Check size={13} />
          </button>
          <button onClick={() => setEditing(false)} className="text-t3 hover:text-t1" title="Cancel">
            <X size={13} />
          </button>
        </>
      ) : (
        <>
          <span
            className={cn(
              "mono min-w-0 flex-1 truncate text-[11.5px]",
              revealed != null ? "text-t1" : "text-t3",
            )}
          >
            {revealed ?? (v.hasValue ? v.masked : "(empty)")}
          </span>
          <button
            onClick={() => void reveal()}
            className="text-t3 opacity-0 hover:text-t1 group-hover:opacity-100"
            title={revealed != null ? "Hide" : "Reveal"}
          >
            {revealed != null ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={() => void startEdit()}
            className="text-t3 opacity-0 hover:text-t1 group-hover:opacity-100"
            title="Edit (original file is backed up)"
          >
            <Pencil size={13} />
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DbPanel({
  projectId,
  provider,
  urlMasked,
  urlFile,
  urlKey,
  hasPrisma,
}: {
  projectId: string;
  provider: string;
  urlMasked: string;
  urlFile: string;
  urlKey: string;
  hasPrisma: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [querying, setQuerying] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const qc = useQueryClient();

  const isPostgres = provider === "postgres";

  const { data: overview, isFetching, refetch } = useQuery({
    queryKey: ["db-overview", projectId],
    queryFn: () => api.dbOverview(projectId),
    enabled: isPostgres,
    retry: false,
    staleTime: 30_000,
  });

  const { data: studio } = useQuery({
    queryKey: ["studio", projectId],
    queryFn: () => api.studioStatus(projectId),
    enabled: hasPrisma,
    refetchInterval: (q) => (q.state.data?.running ? 20_000 : false),
  });

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setQuerying(true);
    try {
      // Raw SELECT? Run it directly; otherwise let the AI translate.
      const res = /^(select|with|explain|show)\b/i.test(q)
        ? await api.dbQuery(projectId, q)
        : await api.dbAiQuery(projectId, q);
      setResult(res);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setQuerying(false);
    }
  };

  const toggleStudio = async () => {
    setStudioBusy(true);
    try {
      if (studio?.running) await api.studioStop(projectId);
      else {
        toast("Starting Prisma Studio… (first run can take a while)");
        const st = await api.studioStart(projectId);
        if (!st.running) toast(st.error ?? "Studio failed to start");
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setStudioBusy(false);
      void qc.invalidateQueries({ queryKey: ["studio", projectId] });
    }
  };

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-t3">
        <Database size={13} /> Database
      </h2>
      <div className="overflow-hidden rounded-[8px] border border-hair">
        {/* connection line */}
        <div className="flex items-center gap-2 border-b border-hair bg-panel px-3 py-2">
          <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-t2">
            {provider}
          </span>
          <span className="mono truncate text-[11.5px] text-t3" title={`${urlKey} in ${urlFile}`}>
            {urlKey}={urlMasked}
          </span>
          <span className="mono text-[10.5px] text-t3">({urlFile})</span>
          {isPostgres && overview && (
            <span
              className={cn(
                "ml-1 flex items-center gap-1 text-[11px]",
                overview.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", overview.ok ? "bg-[color:var(--ok)]" : "bg-[color:var(--err)]")} />
              {overview.ok
                ? `${overview.database} · ${overview.serverVersion}`
                : overview.error}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {isPostgres && (
              <button
                onClick={() => void refetch()}
                className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
                title="Reconnect"
              >
                <RefreshCw size={13} className={cn(isFetching && "animate-spin")} />
              </button>
            )}
            {hasPrisma && (
              <button
                onClick={() => void toggleStudio()}
                disabled={studioBusy}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-[5px] border border-hair px-2 text-[11.5px] hover:bg-raised",
                  studio?.running ? "text-t1" : "text-t2 hover:text-t1",
                )}
              >
                {studio?.running ? <Square size={11} /> : <Play size={11} />}
                {studioBusy ? "…" : studio?.running ? "Stop Studio" : "Prisma Studio"}
              </button>
            )}
            {studio?.running && studio.url && (
              <a
                href={studio.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
                title="Open Studio in browser"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>

        {/* Studio embed */}
        {studio?.running && studio.url && (
          <iframe
            src={studio.url}
            title="Prisma Studio"
            className="h-[560px] w-full border-0 border-b border-hair bg-white"
          />
        )}

        {/* tables + query — postgres only */}
        {isPostgres && overview?.ok && (
          <div className="flex flex-col gap-0">
            <div className="flex flex-wrap gap-1.5 px-3 py-2">
              {overview.tables.map((t) => (
                <button
                  key={`${t.schema}.${t.name}`}
                  onClick={() =>
                    setQuestion(
                      `select * from ${t.schema === "public" ? "" : `"${t.schema}".`}"${t.name}" limit 50`,
                    )
                  }
                  className="flex items-center gap-1 rounded-[5px] border border-hair px-2 py-0.5 text-[11.5px] text-t2 hover:bg-raised hover:text-t1"
                  title="Click to query"
                >
                  <Table2 size={11} className="text-t3" />
                  {t.schema === "public" ? t.name : `${t.schema}.${t.name}`}
                  {t.rows != null && (
                    <span className="mono text-[10px] text-t3">
                      {t.rows.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
              {overview.tables.length === 0 && (
                <span className="text-[12px] text-t3">No tables.</span>
              )}
            </div>

            {/* query box */}
            <div className="flex items-center gap-2 border-t border-hair px-3 py-2">
              <Sparkles size={13} className="shrink-0 text-t3" />
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void ask()}
                placeholder='Ask in English ("users created today") or paste a SELECT — read-only'
                className="mono h-7 min-w-0 flex-1 rounded-[5px] border border-hair bg-raised px-2 text-[12px] text-t1 focus:border-hairfocus focus:outline-none"
              />
              <button
                onClick={() => void ask()}
                disabled={querying || !question.trim()}
                className="h-7 rounded-[6px] bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {querying ? "Running…" : "Run"}
              </button>
            </div>

            {result && (
              <div className="border-t border-hair">
                <div className="flex items-center gap-2 bg-panel px-3 py-1.5">
                  <span className="mono truncate text-[11px] text-t3" title={result.sql}>
                    {result.sql}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-t3">
                    {result.rowCount} rows{result.truncated ? " (truncated)" : ""}
                  </span>
                </div>
                <div className="max-h-[380px] overflow-auto">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr>
                        {result.columns.map((c, i) => (
                          <th
                            key={i}
                            className="sticky top-0 border-b border-hair bg-panel px-2 py-1 text-left font-semibold text-t2"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr key={ri} className="odd:bg-panel/40">
                          {row.map((cell, ci) => (
                            <td key={ci} className="mono max-w-[280px] truncate border-b border-hair px-2 py-1 text-t1">
                              {cell == null
                                ? "∅"
                                : typeof cell === "object"
                                  ? JSON.stringify(cell)
                                  : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        {isPostgres && overview && !overview.ok && (
          <div className="px-3 py-3 text-[12.5px] text-t3">
            Could not connect. Check the connection string above (edit it in the
            Environment section below — Deck backs the file up first).
          </div>
        )}
        {!isPostgres && (
          <div className="px-3 py-3 text-[12.5px] text-t3">
            Native browsing currently supports Postgres; use Prisma Studio above
            for {provider} databases.
          </div>
        )}
      </div>
    </section>
  );
}
