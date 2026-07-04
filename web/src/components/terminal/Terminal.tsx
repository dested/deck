import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { X, ArrowUp, ArrowDown } from "lucide-react";
import { TERM_THEME } from "../../lib/termTheme";
import { TermSocket } from "../../lib/termSocket";
import { useUIStore } from "../../stores/uiStore";

// The world-class terminal (§5.4). WebGL renderer w/ canvas fallback, reattach
// via server snapshot, debounced fit, in-terminal search, WT-style clipboard.
export function Terminal({
  sessionId,
  onExit,
  className,
  claudeNewline,
}: {
  sessionId: string;
  onExit?: (code: number | null) => void;
  className?: string;
  // Remap Shift/Ctrl/Alt+Enter to a newline instead of submit. Only for claude
  // sessions — in a plain shell the ESC prefix would clear the PSReadLine buffer.
  claudeNewline?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const socketRef = useRef<TermSocket | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [exited, setExited] = useState<{ code: number | null } | null>(null);
  const fontSize = useUIStore((s) => s.terminalFontSize);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const claudeNewlineRef = useRef(claudeNewline);
  claudeNewlineRef.current = claudeNewline;

  const doSearch = useCallback((term: string, dir: 1 | -1) => {
    if (!searchRef.current || !term) return;
    if (dir === 1) searchRef.current.findNext(term);
    else searchRef.current.findPrevious(term);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
      fontSize,
      lineHeight: 1.35,
      fontWeightBold: 600,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 50_000,
      smoothScrollDuration: 0, // instant, professional (§5.4)
      allowProposedApi: true,
      theme: TERM_THEME,
      macOptionIsMeta: false,
    });
    termRef.current = term;

    const fit = new FitAddon();
    const search = new SearchAddon();
    const unicode = new Unicode11Addon();
    fitRef.current = fit;
    searchRef.current = search;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(unicode);
    term.loadAddon(new WebLinksAddon());
    term.unicode.activeVersion = "11";

    term.open(host);

    // WebGL renderer with graceful canvas fallback on context loss (§5.4).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* falls back to DOM renderer */
    }

    // Visual bell: 150ms border glow (§5.4).
    term.onBell(() => {
      host.classList.add("deck-bell");
      setTimeout(() => host.classList.remove("deck-bell"), 160);
    });

    // ----- Clipboard (Windows-Terminal semantics, §5.4) -----
    const copySelection = () => {
      const sel = term.getSelection();
      if (sel) void navigator.clipboard?.writeText(sel);
    };
    const paste = async () => {
      try {
        const text = await navigator.clipboard?.readText();
        if (text) term.paste(text); // respects bracketed-paste mode
      } catch {
        /* clipboard blocked */
      }
    };

    // Global shortcuts escape to the window handler; terminal-local combos are
    // handled here. Everything else goes to the PTY.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const k = e.key.toLowerCase();
      if (ctrl && !shift && (k === "k" || k === "w" || k === "b")) return false;
      if (ctrl && e.key === "Tab") return false;
      if (ctrl && /^[1-9]$/.test(e.key)) return false;
      if (ctrl && shift && k === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return false;
      }
      if (ctrl && shift && k === "c") {
        e.preventDefault();
        copySelection();
        return false;
      }
      if (ctrl && shift && k === "v") {
        e.preventDefault();
        void paste();
        return false;
      }
      if (e.key === "Escape" && searchOpenRef.current) {
        setSearchOpen(false);
        return false;
      }
      // Shift/Ctrl/Alt+Enter → newline in claude's prompt instead of submit.
      // claude's TUI treats ESC+CR (what macOS Option+Enter and `/terminal-setup`
      // emit) as an inserted newline; plain Enter still submits the turn.
      if (
        claudeNewlineRef.current &&
        e.key === "Enter" &&
        (shift || ctrl || e.altKey)
      ) {
        e.preventDefault();
        socketRef.current?.input("\x1b\r");
        return false;
      }
      return true;
    });

    host.addEventListener("contextmenu", onContextMenu);
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      const sel = term.getSelection();
      if (sel) {
        void navigator.clipboard?.writeText(sel);
        term.clearSelection();
      } else {
        void paste();
      }
    }

    // ----- Socket wiring -----
    term.onData((data) => socketRef.current?.input(data));

    let disposed = false;
    const socket = new TermSocket(sessionId, {
      onData: (bytes) => {
        // Write immediately; xterm batches internally (§5.4 latency rule).
        if (!disposed) term.write(bytes);
      },
      onReady: () => {
        // After snapshot restore, fit and report our real size to the PTY.
        requestAnimationFrame(() => safeFit());
      },
      onExit: (code) => {
        setExited({ code });
        onExit?.(code);
      },
    });
    socketRef.current = socket;

    // ----- Resize handling (debounced 50ms, §5.4) -----
    let resizeTimer: number | undefined;
    const safeFit = () => {
      if (disposed) return;
      if (host.clientWidth < 20 || host.clientHeight < 20) return;
      try {
        fit.fit();
        socket.resize(term.cols, term.rows);
      } catch {
        /* container mid-layout */
      }
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(safeFit, 50);
    });
    ro.observe(host);
    requestAnimationFrame(() => safeFit());
    // Focus for immediate typing.
    setTimeout(() => term.focus(), 30);

    return () => {
      disposed = true;
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      host.removeEventListener("contextmenu", onContextMenu);
      socket.close();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Live font-size changes without a full remount.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        if (term.cols && term.rows) socketRef.current?.resize(term.cols, term.rows);
      } catch {
        /* ignore */
      }
    });
  }, [fontSize]);

  return (
    <div className={`relative h-full w-full bg-panel ${className ?? ""}`}>
      <div ref={hostRef} className="h-full w-full" style={{ padding: 12 }} />
      {searchOpen && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[6px] border border-hair bg-overlay p-1 deck-fade-in"
             style={{ boxShadow: "var(--shadow-overlay)" }}>
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              doSearch(e.target.value, 1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(searchTerm, e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Search"
            className="h-6 w-40 bg-transparent px-1.5 text-[12px] text-t1 placeholder:text-t3 focus:outline-none"
          />
          <button onClick={() => doSearch(searchTerm, -1)} className="rounded p-1 text-t3 hover:bg-raised hover:text-t1"><ArrowUp size={13} /></button>
          <button onClick={() => doSearch(searchTerm, 1)} className="rounded p-1 text-t3 hover:bg-raised hover:text-t1"><ArrowDown size={13} /></button>
          <button onClick={() => setSearchOpen(false)} className="rounded p-1 text-t3 hover:bg-raised hover:text-t1"><X size={13} /></button>
        </div>
      )}
      {exited && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-hair bg-panel/90 px-3 py-1.5 text-[11.5px] text-t3">
          process exited{exited.code != null ? ` · code ${exited.code}` : ""}
        </div>
      )}
    </div>
  );
}
