import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, Play } from "lucide-react";
import type { SearchHit, Session } from "@deck/shared";
import { useUIStore } from "../stores/uiStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { cn } from "../lib/cn";

const SNIP_OPEN = "";
const SNIP_CLOSE = "";

// M9: dedicated transcript search dialog (Ctrl+Shift+F / palette). Results are
// grouped by session; a row jumps the feed to that exact event; Resume spawns a
// live claude that remembers the conversation.
export function SearchDialog() {
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const projectId = useUIStore((s) => s.searchProjectId);
  const projectName = useProjectsStore((s) =>
    projectId ? s.byId[projectId]?.name : undefined,
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // Debounced 200ms search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search(q, projectId ?? undefined, 40)
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [query, projectId]);

  // Group by session, preserving rank order.
  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const arr = map.get(h.sessionId) ?? [];
      arr.push(h);
      map.set(h.sessionId, arr);
    }
    return [...map.entries()];
  }, [hits]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-[12%] z-50 flex max-h-[72vh] w-[640px] max-w-[92vw] -translate-x-1/2 flex-col overflow-hidden rounded-[10px] border border-hair bg-overlay deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <Dialog.Title className="sr-only">Search transcripts</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-hair px-3">
            <Search size={15} className="text-t3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                projectName
                  ? `Search ${projectName} transcripts…`
                  : "Search all transcripts…"
              }
              className="h-12 w-full bg-transparent text-[14px] text-t1 placeholder:text-t3 focus:outline-none"
            />
            {projectName && (
              <span className="mono shrink-0 rounded-[4px] bg-raised px-1.5 py-0.5 text-[11px] text-t2">
                {projectName}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" style={{ scrollbarGutter: "stable" }}>
            {query.trim() && !loading && groups.length === 0 && (
              <div className="px-3 py-6 text-center text-[13px] text-t3">
                No matches
              </div>
            )}
            {groups.map(([sessionId, sessionHits]) => (
              <ResultGroup
                key={sessionId}
                sessionId={sessionId}
                hits={sessionHits}
                onClose={() => setOpen(false)}
              />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ResultGroup({
  sessionId,
  hits,
  onClose,
}: {
  sessionId: string;
  hits: SearchHit[];
  onClose: () => void;
}) {
  const head = hits[0]!;
  const projectName = useProjectsStore(
    (s) => s.byId[head.projectId]?.name ?? head.projectId,
  );
  const openSession = useUIStore((s) => s.openSession);
  const setFeedJump = useUIStore((s) => s.setFeedJump);

  const jump = (h: SearchHit) => {
    openSession(h.sessionId, h.projectId);
    setFeedJump({ sessionId: h.sessionId, eventIdx: h.eventIdx });
    onClose();
  };

  const resume = async () => {
    try {
      const live = useSessionsStore.getState().byId[sessionId];
      let s: Session;
      if (live) s = live;
      else
        s = await api.resumeTranscript({
          transcriptId: sessionId,
          projectId: head.projectId,
          name: head.title ?? undefined,
        });
      useSessionsStore.getState().upsert(s);
      openSession(s.id, s.projectId);
      onClose();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="truncate text-[11.5px] font-medium text-t2">
          {projectName}
          {head.title ? ` · ${head.title}` : ""}
        </span>
        <span className="mono shrink-0 text-[10.5px] text-t3">
          {relTime(head.ts)}
        </span>
        <button
          onClick={() => void resume()}
          className="ml-auto flex h-5 shrink-0 items-center gap-1 rounded-[4px] border border-hair px-1.5 text-[10.5px] text-t2 hover:bg-raised hover:text-t1"
          title="Resume this session as a live agent"
        >
          <Play size={10} /> Resume
        </button>
      </div>
      {hits.map((h, i) => (
        <button
          key={i}
          onClick={() => jump(h)}
          className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-raised"
        >
          <span className="mono mt-px shrink-0 text-[9px] uppercase text-t3">
            {h.kind}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-t2">
            {renderSnippet(h.snippet)}
          </span>
        </button>
      ))}
    </div>
  );
}

// Build React nodes from the sentinel-wrapped snippet (never dangerouslySetInnerHTML).
function renderSnippet(snip: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = snip;
  let key = 0;
  while (rest.length) {
    const oi = rest.indexOf(SNIP_OPEN);
    if (oi < 0) {
      nodes.push(rest);
      break;
    }
    if (oi > 0) nodes.push(rest.slice(0, oi));
    rest = rest.slice(oi + 1);
    const ci = rest.indexOf(SNIP_CLOSE);
    const text = ci < 0 ? rest : rest.slice(0, ci);
    nodes.push(
      <mark
        key={key++}
        className={cn(
          "rounded-[2px] bg-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] px-0.5 text-t1",
        )}
      >
        {text}
      </mark>,
    );
    rest = ci < 0 ? "" : rest.slice(ci + 1);
  }
  return nodes;
}
