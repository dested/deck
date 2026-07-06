import { useEffect, useState, useCallback } from "react";
import { BookOpen, Pencil, RefreshCw, Sparkles } from "lucide-react";
import type { FileContent } from "@deck/shared";
import { api } from "../../lib/api";
import { spawnSession } from "../../lib/sessions";
import { eventsClient } from "../../lib/ws";
import { useUIStore } from "../../stores/uiStore";
import { useSessionsStore } from "../../stores/sessionsStore";
import { renderMarkdown } from "../../lib/markdown";
import { relTime } from "../../lib/format";
import { cn } from "../../lib/cn";

// M16: render the repo's cliffnotes.md as a first-class project view; bootstrap
// it with a visible agent session when missing.
const NOTES_CANDIDATES = ["cliffnotes.md", "CLIFFNOTES.md"];
const UI_CANDIDATES = ["ui.md", "UI.md"];

const GENERATE_PROMPT =
  "Read the cliffnotes skill at `~/.claude/skills/cliffnotes/SKILL.md` and its " +
  "templates, then generate `cliffnotes.md` (and `ui.md` if this project has a " +
  "real UI) for this repository, following the skill's create-from-scratch " +
  "workflow (§5).";

async function loadFirst(
  projectId: string,
  candidates: string[],
): Promise<{ path: string; content: FileContent } | null> {
  for (const path of candidates) {
    try {
      const content = await api.file(projectId, path);
      return { path, content };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function NotesTab({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<{ path: string; content: FileContent } | null>(null);
  const [ui, setUi] = useState<{ path: string; content: FileContent } | null>(null);
  const [showUi, setShowUi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [genSessionId, setGenSessionId] = useState<string | null>(null);
  const requestFile = useUIStore((s) => s.requestFile);
  const openProject = useUIStore((s) => s.openProject);
  const genSession = useSessionsStore((s) =>
    genSessionId ? s.byId[genSessionId] : undefined,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [n, u] = await Promise.all([
      loadFirst(projectId, NOTES_CANDIDATES),
      loadFirst(projectId, UI_CANDIDATES),
    ]);
    setNotes(n);
    setUi(u);
    if (!u) setShowUi(false);
    setLoading(false);
    setFetchedAt(Date.now());
  }, [projectId]);

  // Load on mount + on git.updated for this project (cheap invalidation).
  useEffect(() => {
    void load();
    const off = eventsClient.addListener((msg) => {
      if (msg.t === "git.updated" && msg.projectId === projectId) void load();
    });
    return off;
  }, [projectId, load]);

  // While generating, poll for the file to appear, then flip to it.
  useEffect(() => {
    if (!genSessionId || notes) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [genSessionId, notes, load]);

  const generate = async () => {
    const s = await spawnSession(projectId, "claude", {
      initialPrompt: GENERATE_PROMPT,
      name: "Generate cliffnotes",
    }).catch(() => null);
    if (s) setGenSessionId(s.id);
  };

  const active = showUi && ui ? ui : notes;

  if (loading && !notes) {
    return <div className="p-6 text-[13px] text-t3">Loading notes…</div>;
  }

  if (!notes) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-t3">
          <BookOpen size={22} />
        </div>
        <div className="text-[14px] font-medium text-t1">No cliffnotes.md</div>
        <div className="max-w-[380px] text-[13px] text-t2">
          The living map of this repo. Generate it as a normal agent session
          (runs on your own subscription/tools).
        </div>
        {genSessionId ? (
          <span className="mt-1 flex items-center gap-1.5 text-[12px] text-t2">
            <Sparkles size={13} className="animate-pulse text-accenttext" />
            Generating — watching {genSession?.name ?? "agent"}…
          </span>
        ) : (
          <button
            onClick={() => void generate()}
            className="mt-1 flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white"
          >
            <Sparkles size={14} /> Generate cliffnotes
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hair px-4">
        <BookOpen size={14} className="text-t3" />
        <span className="mono text-[12px] text-t1">{active?.path}</span>
        {ui && (
          <div className="flex overflow-hidden rounded-[5px] border border-hair">
            <button
              onClick={() => setShowUi(false)}
              className={cn(
                "px-2 py-0.5 text-[11px]",
                !showUi ? "bg-raised text-t1" : "text-t3 hover:text-t1",
              )}
            >
              notes
            </button>
            <button
              onClick={() => setShowUi(true)}
              className={cn(
                "px-2 py-0.5 text-[11px]",
                showUi ? "bg-raised text-t1" : "text-t3 hover:text-t1",
              )}
            >
              ui
            </button>
          </div>
        )}
        <span className="mono text-[10.5px] text-t3">{relTime(fetchedAt)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void load()}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-t3 hover:bg-raised hover:text-t1"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => {
              if (active) {
                requestFile(projectId, active.path);
                openProject(projectId, "files");
              }
            }}
            className="flex h-6 items-center gap-1 rounded-[5px] border border-hair px-2 text-[11.5px] text-t2 hover:bg-raised hover:text-t1"
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div
          className="deck-md mx-auto max-w-[820px] px-8 py-6"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(active?.content.content ?? ""),
          }}
        />
      </div>
    </div>
  );
}
