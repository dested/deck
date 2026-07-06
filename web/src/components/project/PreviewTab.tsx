import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MonitorPlay,
  Play,
  RefreshCw,
  ExternalLink,
  Smartphone,
  Monitor,
  Sparkles,
  Pencil,
  FlaskConical,
} from "lucide-react";
import type { Runbook } from "@deck/shared";
import { api } from "../../lib/api";
import { useSessionsStore } from "../../stores/sessionsStore";
import { useUIStore } from "../../stores/uiStore";
import { toast } from "../ui/Toast";
import { cn } from "../../lib/cn";

// M18 — the Preview tab: the project's runbook (deck.run.json) + the running
// app embedded in an iframe. Dev servers don't send X-Frame-Options, so a
// plain iframe of localhost:<port> just works. When nothing is listening, the
// tab is a launcher: start the dev command as a REAL visible shell session.

export function PreviewTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const openSession = useUIStore((s) => s.openSession);
  const activateTab = useUIStore((s) => s.activateTab);
  const [mobile, setMobile] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { data: info } = useQuery({
    queryKey: ["runbook", projectId],
    queryFn: () => api.runbook(projectId),
  });
  const { data: status } = useQuery({
    queryKey: ["runbook-status", projectId],
    queryFn: () => api.runbookStatus(projectId),
    // Poll fast while we're waiting for a dev server to come up, slow once up.
    refetchInterval: (q) => (q.state.data?.listening ? 15000 : 3000),
  });

  const runbook = info?.runbook;
  const devCommand = runbook?.dev?.command ?? null;
  const url = status?.url ?? null;
  const listening = status?.listening ?? false;

  const startDev = async () => {
    if (!devCommand) return;
    const s = await api
      .createSession({
        projectId,
        kind: "shell",
        name: "▶ dev",
        command: devCommand,
        cwd: runbook?.cwd,
      })
      .catch((err) => {
        toast(`Start failed: ${(err as Error).message}`);
        return null;
      });
    if (!s) return;
    useSessionsStore.getState().upsert(s);
    // Open the session tab briefly? No — stay here and watch the probe flip;
    // the session tab exists in the strip if the user wants the logs.
    useUIStore.getState().openSession(s.id, projectId);
    activateTab(`view:preview`);
    toast(`Started: ${devCommand}`);
  };

  const runTest = async () => {
    const cmd = runbook?.test?.command;
    if (!cmd) return;
    const s = await api
      .createSession({
        projectId,
        kind: "shell",
        name: `✓ ${cmd}`,
        command: cmd,
        cwd: runbook?.cwd,
      })
      .catch(() => null);
    if (s) {
      useSessionsStore.getState().upsert(s);
      openSession(s.id, projectId);
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await api.generateRunbook(projectId);
      await qc.invalidateQueries({ queryKey: ["runbook", projectId] });
      await qc.invalidateQueries({ queryKey: ["runbook-status", projectId] });
      toast("Runbook generated → deck.run.json");
    } catch (err) {
      toast(`Generate failed: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hair px-4">
        <MonitorPlay size={14} className="text-t3" />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mono text-[12px] text-accenttext hover:underline"
          >
            {url}
          </a>
        ) : (
          <span className="text-[12px] text-t3">no port detected</span>
        )}
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            listening ? "bg-[color:var(--ok)]" : "bg-[color:var(--err)]",
          )}
          title={listening ? "listening" : "not listening"}
        />
        {info && !info.hasFile && (
          <span
            className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-t3"
            title="No deck.run.json — this runbook is Deck's best guess"
          >
            detected
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {runbook?.test?.command && (
            <button
              onClick={() => void runTest()}
              className="flex h-6 items-center gap-1 rounded-[5px] border border-hair px-2 text-[11.5px] text-t2 hover:bg-raised hover:text-t1"
              title={runbook.test.command}
            >
              <FlaskConical size={12} /> Test
            </button>
          )}
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="flex h-6 items-center gap-1 rounded-[5px] border border-hair px-2 text-[11.5px] text-t2 hover:bg-raised hover:text-t1 disabled:opacity-50"
            title="AI-generate deck.run.json from the repo"
          >
            <Sparkles size={12} className={cn(generating && "animate-pulse")} />
            {generating ? "Generating…" : "Generate"}
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-[5px] border border-hair px-2 text-[11.5px] hover:bg-raised",
              editing ? "bg-raised text-t1" : "text-t2 hover:text-t1",
            )}
          >
            <Pencil size={12} /> Runbook
          </button>
          <div className="mx-1 h-4 w-px bg-hair" />
          <button
            onClick={() => setMobile((m) => !m)}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
            title={mobile ? "Desktop viewport" : "Mobile viewport (390px)"}
          >
            {mobile ? <Monitor size={13} /> : <Smartphone size={13} />}
          </button>
          <button
            onClick={() => setFrameKey((k) => k + 1)}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
            title="Reload preview"
          >
            <RefreshCw size={13} />
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
              title="Open in browser"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {editing && info && (
        <RunbookEditor
          projectId={projectId}
          runbook={info.runbook}
          onSaved={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: ["runbook", projectId] });
            void qc.invalidateQueries({ queryKey: ["runbook-status", projectId] });
          }}
        />
      )}

      {/* Preview surface */}
      <div className="min-h-0 flex-1 bg-root">
        {listening && url && status?.frameBlocked ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MonitorPlay size={22} className="text-t3" />
            <div className="text-[14px] font-medium text-t1">
              This site refuses to be embedded
            </div>
            <div className="max-w-[440px] text-[13px] text-t2">
              <span className="mono">{url}</span> sends X-Frame-Options / CSP
              frame-ancestors headers, so the browser won&apos;t render it in an
              iframe. That&apos;s the site&apos;s policy — most public sites
              (google.com included) do this. Local dev servers don&apos;t.
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white"
            >
              <ExternalLink size={14} /> Open in browser
            </a>
          </div>
        ) : listening && url ? (
          <div className="flex h-full items-stretch justify-center">
            <iframe
              key={frameKey}
              src={url}
              title="preview"
              className={cn(
                "h-full border-0 bg-white",
                mobile
                  ? "my-3 w-[390px] rounded-[12px] border border-hair shadow-lg"
                  : "w-full",
              )}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MonitorPlay size={22} className="text-t3" />
            <div className="text-[14px] font-medium text-t1">
              {devCommand ? "Dev server not running" : "No runbook yet"}
            </div>
            <div className="max-w-[420px] text-[13px] text-t2">
              {devCommand ? (
                <>
                  Start it and the app appears right here
                  {status?.port ? ` (port ${status.port})` : ""}.
                </>
              ) : (
                "Generate a runbook so Deck (and your agents) know how to run and test this project."
              )}
            </div>
            {devCommand ? (
              <button
                onClick={() => void startDev()}
                title={runbook?.cwd ? `runs in ${runbook.cwd}` : undefined}
                className="mt-1 flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white"
              >
                <Play size={14} /> {devCommand}
                {runbook?.cwd && (
                  <span className="font-normal opacity-75">· {runbook.cwd}</span>
                )}
              </button>
            ) : (
              <button
                onClick={() => void generate()}
                disabled={generating}
                className="mt-1 flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Sparkles size={14} />
                {generating ? "Generating…" : "Generate runbook"}
              </button>
            )}
            {status && status.livePorts.length > 0 && !listening && (
              <div className="text-[12px] text-t3">
                Live ports for this project: {status.livePorts.map((p) => `:${p}`).join(" ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RunbookEditor({
  projectId,
  runbook,
  onSaved,
}: {
  projectId: string;
  runbook: Runbook;
  onSaved: () => void;
}) {
  const [dev, setDev] = useState(runbook.dev?.command ?? "");
  const [cwd, setCwd] = useState(runbook.cwd ?? "");
  const [port, setPort] = useState(runbook.dev?.port?.toString() ?? "");
  const [urlOverride, setUrlOverride] = useState(runbook.dev?.url ?? "");
  const [test, setTest] = useState(runbook.test?.command ?? "");
  const [notes, setNotes] = useState(runbook.notes ?? "");

  // Re-seed when the runbook identity changes (e.g. after Generate).
  useEffect(() => {
    setDev(runbook.dev?.command ?? "");
    setCwd(runbook.cwd ?? "");
    setPort(runbook.dev?.port?.toString() ?? "");
    setUrlOverride(runbook.dev?.url ?? "");
    setTest(runbook.test?.command ?? "");
    setNotes(runbook.notes ?? "");
  }, [runbook]);

  const save = async () => {
    const next: Runbook = {};
    if (cwd.trim()) next.cwd = cwd.trim().replace(/\\/g, "/");
    if (dev.trim()) {
      next.dev = { command: dev.trim() };
      const p = Number(port);
      if (Number.isInteger(p) && p > 0) next.dev.port = p;
      if (urlOverride.trim()) next.dev.url = urlOverride.trim();
    }
    if (test.trim()) next.test = { command: test.trim() };
    if (runbook.install) next.install = runbook.install;
    if (notes.trim()) next.notes = notes.trim();
    try {
      await api.saveRunbook(projectId, next);
      toast("Saved deck.run.json");
      onSaved();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`);
    }
  };

  const field =
    "h-7 rounded-[5px] border border-hair bg-raised px-2 text-[12px] text-t1 focus:border-hairfocus focus:outline-none";

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-hair bg-panel px-4 py-3">
      <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        Dev command
        <input value={dev} onChange={(e) => setDev(e.target.value)} placeholder="bun run dev" className={cn(field, "w-56 mono")} />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3" title="Subdirectory of the repo the commands run in (monorepos). Empty = repo root.">
        Directory
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="apps/web" className={cn(field, "w-36 mono")} />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        Port
        <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="5173" className={cn(field, "w-20 mono")} />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        URL (optional)
        <input value={urlOverride} onChange={(e) => setUrlOverride(e.target.value)} placeholder="http://localhost:5173" className={cn(field, "w-56 mono")} />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        Test command
        <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="bun run typecheck" className={cn(field, "w-48 mono")} />
      </label>
      <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="gotchas needed to run it" className={cn(field, "w-full")} />
      </label>
      <button
        onClick={() => void save()}
        className="h-7 rounded-[6px] bg-accent px-3 text-[12px] font-medium text-white"
      >
        Save
      </button>
    </div>
  );
}
