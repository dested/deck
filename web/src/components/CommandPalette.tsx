import { useMemo, useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, FolderGit2, Bot, SquareTerminal, X, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useUIStore } from "../stores/uiStore";
import { useProjectsStore, selectSortedProjects } from "../stores/projectsStore";
import { useSessionsStore, selectSessions, isLive } from "../stores/sessionsStore";
import { spawnSession } from "../lib/sessions";
import { api } from "../lib/api";
import { cn } from "../lib/cn";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setOpen = useUIStore((s) => s.setPaletteOpen);
  const projects = useProjectsStore((s) => s.byId);
  const sessions = useSessionsStore((s) => s.byId);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const ui = useUIStore.getState();
    const cmds: Command[] = [];
    cmds.push({
      id: "settings",
      label: "Open settings",
      icon: <Settings size={15} />,
      run: () => ui.setSettingsOpen(true),
    });
    for (const s of selectSessions(sessions).filter(isLive)) {
      cmds.push({
        id: "sess:" + s.id,
        label: `Open session ${s.name}`,
        hint: s.projectId,
        icon: <Bot size={15} />,
        run: () => ui.openSession(s.id),
      });
      if (s.source === "owned")
        cmds.push({
          id: "kill:" + s.id,
          label: `Kill ${s.name}`,
          icon: <X size={15} />,
          run: () => void api.killSession(s.id).catch(() => {}),
        });
    }
    for (const p of selectSortedProjects(projects)) {
      cmds.push({
        id: "proj:" + p.id,
        label: `Open ${p.name}`,
        hint: "project",
        icon: <FolderGit2 size={15} />,
        run: () => ui.openProject(p.id),
      });
      cmds.push({
        id: "cc:" + p.id,
        label: `New Claude session in ${p.name}`,
        icon: <Bot size={15} />,
        run: () => void spawnSession(p.id, "claude").catch(() => {}),
      });
      cmds.push({
        id: "sh:" + p.id,
        label: `New terminal in ${p.name}`,
        icon: <SquareTerminal size={15} />,
        run: () => void spawnSession(p.id, "shell").catch(() => {}),
      });
    }
    return cmds;
  }, [projects, sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 50);
    const scored: { c: Command; score: number }[] = [];
    for (const c of commands) {
      const score = fuzzyScore(c.label.toLowerCase(), q);
      if (score > 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((s) => s.c);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const run = (c: Command) => {
    setOpen(false);
    c.run();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-[18%] z-50 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-[10px] border border-hair bg-overlay deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-hair px-3">
            <Search size={15} className="text-t3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const c = filtered[active];
                  if (c) run(c);
                }
              }}
              placeholder="Search actions, projects, sessions…"
              className="h-12 w-full bg-transparent text-[14px] text-t1 placeholder:text-t3 focus:outline-none"
            />
          </div>
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[13px] text-t3">No matches</div>
            )}
            {filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-[13px]",
                  i === active ? "bg-raised text-t1" : "text-t2",
                )}
              >
                <span className="shrink-0 text-t3">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-[11px] text-t3">{c.hint}</span>}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Subsequence fuzzy score: all query chars must appear in order; contiguous +
// word-boundary matches score higher.
function fuzzyScore(text: string, q: string): number {
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (let k = ti; k < text.length; k++) {
      if (text[k] === ch) {
        found = k;
        break;
      }
    }
    if (found < 0) return 0;
    if (found === ti) streak++;
    else streak = 0;
    score += 1 + streak;
    if (found === 0 || text[found - 1] === " " || text[found - 1] === "/") score += 3;
    ti = found + 1;
  }
  return score;
}
