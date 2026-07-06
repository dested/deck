// Strip Claude Code's own env markers so a `claude` process Deck spawns (PTY or
// `-p`) runs as a fresh TOP-LEVEL session that writes its own transcript. If
// Deck itself is launched from inside a Claude Code session,
// CLAUDE_CODE_CHILD_SESSION=1 / CLAUDE_CODE_SESSION_ID would otherwise make the
// nested claude a child that never persists a transcript — breaking §5.2
// linkage. One shared copy (gotcha #4); pty/manager re-exports it.
export function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^CLAUDE(CODE)?(_|$)/i.test(k)) continue; // CLAUDECODE, CLAUDE_CODE_*, CLAUDE_*
    out[k] = v;
  }
  return out;
}
