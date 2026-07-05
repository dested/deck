import { execSync } from "node:child_process";
import * as pty from "node-pty";
// @xterm/headless + addon-serialize are CJS; Node's ESM lexer can't resolve
// their named exports, so default-import and destructure.
import HeadlessPkg from "@xterm/headless";
import SerializePkg from "@xterm/addon-serialize";
import type { Terminal as HeadlessTerminalType } from "@xterm/headless";
import type { SerializeAddon as SerializeAddonType } from "@xterm/addon-serialize";
import { config } from "../config.js";
import { RingBuffer } from "./ringBuffer.js";

const { Terminal: HeadlessTerminal } = HeadlessPkg;
const { SerializeAddon } = SerializePkg;

export type PtyKind = "claude" | "shell";
export type PtyStatus = "running" | "exited";

export interface SpawnOptions {
  id: string;
  kind: PtyKind;
  projectId: string;
  projectPath: string;
  cols?: number;
  rows?: number;
  claudeArgs?: string[];
  // Shell kind only: run this command in the shell (kept open after it exits)
  // — powers the Library card's one-click script launchers.
  command?: string;
}

type DataListener = (data: string) => void;
type ExitListener = (code: number | null) => void;

interface PtyRecord {
  id: string;
  kind: PtyKind;
  projectId: string;
  projectPath: string;
  pty: pty.IPty | null;
  headless: HeadlessTerminalType;
  serialize: SerializeAddonType;
  ring: RingBuffer;
  cols: number;
  rows: number;
  status: PtyStatus;
  exitCode: number | null;
  createdAt: number;
  lastActivityAt: number;
  exitedAt: number | null;
  transcriptSessionId: string | null; // linked in M4
  dataListeners: Set<DataListener>;
  exitListeners: Set<ExitListener>;
}

// Strip Claude Code's own env markers so a claude session Deck spawns runs as a
// fresh TOP-LEVEL session (writes its own transcript). If Deck itself is
// launched from inside a Claude Code session, CLAUDE_CODE_CHILD_SESSION=1 /
// CLAUDE_CODE_SESSION_ID would otherwise make nested claude a child that never
// persists a transcript — breaking §5.2 linkage.
export function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^CLAUDE(CODE)?(_|$)/i.test(k)) continue; // CLAUDECODE, CLAUDE_CODE_*, CLAUDE_*
    out[k] = v;
  }
  return out;
}

const RING_MAX = 2 * 1024 * 1024; // 2MB (§5.3)
const SCROLLBACK = 50_000; // (§5.4)
const EXITED_RETAIN_MS = 24 * 60 * 60 * 1000; // keep exited entries 24h (§5.1)

class PtyManager {
  private records = new Map<string, PtyRecord>();
  private claudeBin: string | null = null;

  init() {
    this.resolveClaudeBin();
    // Sweep long-dead exited PTYs hourly.
    setInterval(() => this.sweepExited(), 60 * 60 * 1000).unref?.();
  }

  private resolveClaudeBin() {
    if (config.claudeBinOverride) {
      this.claudeBin = config.claudeBinOverride;
      return;
    }
    try {
      const out = execSync("where claude", {
        encoding: "utf8",
        windowsHide: true,
      });
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      this.claudeBin =
        lines.find((l) => /\.(cmd|exe)$/i.test(l)) ?? lines[0] ?? null;
    } catch {
      this.claudeBin = null;
    }
  }

  getClaudeBin(): string | null {
    return this.claudeBin;
  }

  spawn(opts: SpawnOptions): PtyRecord {
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 30;

    const headless = new HeadlessTerminal({
      cols,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    const serialize = new SerializeAddon();
    headless.loadAddon(serialize);

    const { file, args } = this.resolveCommand(opts);

    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: opts.projectPath,
      env: cleanEnv(),
      useConpty: true,
    });

    const rec: PtyRecord = {
      id: opts.id,
      kind: opts.kind,
      projectId: opts.projectId,
      projectPath: opts.projectPath,
      pty: proc,
      headless,
      serialize,
      ring: new RingBuffer(RING_MAX),
      cols,
      rows,
      status: "running",
      exitCode: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      exitedAt: null,
      transcriptSessionId: null,
      dataListeners: new Set(),
      exitListeners: new Set(),
    };

    proc.onData((data) => {
      rec.lastActivityAt = Date.now();
      rec.ring.push(data);
      try {
        headless.write(data);
      } catch {
        /* headless write must never crash the pipe */
      }
      for (const l of rec.dataListeners) l(data);
    });

    proc.onExit(({ exitCode }) => {
      rec.status = "exited";
      rec.exitCode = exitCode;
      rec.exitedAt = Date.now();
      rec.pty = null;
      for (const l of rec.exitListeners) l(exitCode);
    });

    this.records.set(opts.id, rec);
    return rec;
  }

  // §5.1: spawn `claude` directly (resolved .cmd shim). Shell = pwsh -NoLogo.
  private resolveCommand(opts: SpawnOptions): { file: string; args: string[] } {
    if (opts.kind === "claude") {
      const bin = this.claudeBin;
      if (bin && /\.exe$/i.test(bin)) {
        return { file: bin, args: opts.claudeArgs ?? [] };
      }
      // .cmd shim (or unknown): run through pwsh so ConPTY handles the shim
      // cleanly and exit codes/colours propagate.
      const call = bin ? `& '${bin}'` : "claude";
      const argStr = (opts.claudeArgs ?? [])
        .map((a) => `'${a.replace(/'/g, "''")}'`)
        .join(" ");
      return {
        file: config.defaultShell,
        args: ["-NoLogo", "-NoExit", "-Command", `${call} ${argStr}`.trim()],
      };
    }
    if (opts.command) {
      return {
        file: config.defaultShell,
        args: ["-NoLogo", "-NoExit", "-Command", opts.command],
      };
    }
    return { file: config.defaultShell, args: ["-NoLogo"] };
  }

  get(id: string): PtyRecord | undefined {
    return this.records.get(id);
  }

  write(id: string, data: string) {
    const rec = this.records.get(id);
    if (rec?.pty) {
      rec.lastActivityAt = Date.now();
      rec.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.cols = cols;
    rec.rows = rows;
    try {
      rec.pty?.resize(cols, rows);
      rec.headless.resize(cols, rows);
    } catch {
      /* resize can race a just-exited pty */
    }
  }

  // Serialized screen state for instant reattach (§5.3). Falls back to raw ring.
  reattachSnapshot(id: string): { serialized: string; raw: string } | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    let serialized = "";
    try {
      serialized = rec.serialize.serialize({ scrollback: SCROLLBACK });
    } catch {
      serialized = "";
    }
    return { serialized, raw: rec.ring.snapshot() };
  }

  onData(id: string, listener: DataListener): () => void {
    const rec = this.records.get(id);
    if (!rec) return () => {};
    rec.dataListeners.add(listener);
    return () => rec.dataListeners.delete(listener);
  }

  onExit(id: string, listener: ExitListener): () => void {
    const rec = this.records.get(id);
    if (!rec) return () => {};
    if (rec.status === "exited") {
      listener(rec.exitCode);
      return () => {};
    }
    rec.exitListeners.add(listener);
    return () => rec.exitListeners.delete(listener);
  }

  kill(id: string) {
    const rec = this.records.get(id);
    if (rec?.pty) {
      try {
        rec.pty.kill();
      } catch {
        /* already gone */
      }
    }
  }

  // Fully remove a record (after the session is dismissed).
  dispose(id: string) {
    const rec = this.records.get(id);
    if (!rec) return;
    try {
      rec.pty?.kill();
    } catch {
      /* ignore */
    }
    rec.headless.dispose();
    this.records.delete(id);
  }

  lastActivityForProject(projectPath: string): number {
    let latest = 0;
    for (const rec of this.records.values()) {
      if (
        rec.projectPath === projectPath &&
        rec.lastActivityAt > latest
      ) {
        latest = rec.lastActivityAt;
      }
    }
    return latest;
  }

  runningCountByProject(): Map<string, number> {
    const m = new Map<string, number>();
    for (const rec of this.records.values()) {
      if (rec.status === "running") {
        m.set(rec.projectId, (m.get(rec.projectId) ?? 0) + 1);
      }
    }
    return m;
  }

  all(): PtyRecord[] {
    return [...this.records.values()];
  }

  private sweepExited() {
    const now = Date.now();
    for (const rec of this.records.values()) {
      if (
        rec.status === "exited" &&
        rec.exitedAt != null &&
        now - rec.exitedAt > EXITED_RETAIN_MS
      ) {
        this.dispose(rec.id);
      }
    }
  }

  disposeAll() {
    for (const id of [...this.records.keys()]) this.dispose(id);
  }
}

export const ptyManager = new PtyManager();
export type { PtyRecord };
