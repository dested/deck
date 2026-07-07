import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// deck.config.json (optional, at repo root) can override any of these.
interface RawConfig {
  root?: string;
  // Additional project roots scanned besides `root` (each scanned depth-1 for
  // .git children, same as root). `root` stays the primary: it backs the
  // `__root__` pseudo-project and its children keep bare folder names as ids.
  roots?: string[];
  port?: number;
  claudeDir?: string;
  defaultShell?: string;
  claudeBin?: string;
  webstormBin?: string;
  anthropicApiKey?: string;
  // M14: optional scheduled digest time, "HH:MM" 24h local. null/absent = off.
  digestAt?: string;
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function loadRaw(): RawConfig {
  const p = path.join(repoRoot, "deck.config.json");
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as RawConfig;
    }
  } catch (err) {
    console.warn("[config] failed to parse deck.config.json:", err);
  }
  return {};
}

const raw = loadRaw();
const home = os.homedir();

// Default projects root: ~/code. Point Deck at your actual code folder via
// deck.config.json { "root": "D:\\wherever" }.
const primaryRoot = raw.root ?? path.join(home, "code");

function normRoot(r: string): string {
  return path.win32.resolve(r.trim());
}

// Extra roots configured at runtime from the UI (persisted in ~/.deck/state.json
// `extraRoots`, seeded on boot by loadState). Kept separate from deck.config.json
// `roots` so the UI can show which entries are file-locked vs removable.
let runtimeExtraRoots: string[] = [];

// Roots declared in deck.config.json (read-only in the UI).
export const fileRoots: string[] = (raw.roots ?? [])
  .filter((r): r is string => typeof r === "string" && r.trim() !== "")
  .map(normRoot);

/** Replace the runtime extra-root list (from state.json / the UI). */
export function setRuntimeExtraRoots(list: string[]): void {
  runtimeExtraRoots = (list ?? [])
    .filter((r): r is string => typeof r === "string" && r.trim() !== "")
    .map(normRoot);
}

/** The runtime extra-root list (the UI-editable ones), normalized. */
export function getRuntimeExtraRoots(): string[] {
  return runtimeExtraRoots;
}

// [primary, ...deck.config.json roots, ...runtime UI roots] — normalized,
// deduped case-insensitively (Windows).
function resolveRoots(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [primaryRoot, ...fileRoots, ...runtimeExtraRoots]) {
    if (typeof r !== "string" || r.trim() === "") continue;
    const norm = normRoot(r);
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

export const config = {
  repoRoot,
  root: primaryRoot,
  // Dynamic: recomputed each read so runtime UI root changes take effect without
  // a restart (scanner + locator both read config.roots fresh on every pass).
  get roots(): string[] {
    return resolveRoots();
  },
  port: raw.port ?? 12345,
  devPort: 12346,
  claudeDir: raw.claudeDir ?? path.join(home, ".claude"),
  claudeProjectsDir:
    raw.claudeDir != null
      ? path.join(raw.claudeDir, "projects")
      : path.join(home, ".claude", "projects"),
  deckStateDir: path.join(home, ".deck"),
  deckStateFile: path.join(home, ".deck", "state.json"),
  // M7: scratch cwd for Deck's own `claude -p` calls, kept OUTSIDE `root` so
  // their transcripts don't surface as external agent cards.
  aiScratchDir: path.join(home, ".deck", "ai"),
  aiUsageFile: path.join(home, ".deck", "ai-usage.jsonl"),
  // M14: written digests live here.
  digestsDir: path.join(home, ".deck", "digests"),
  // M9: FTS index of every transcript on the machine.
  searchDbFile: path.join(home, ".deck", "search.db"),
  anthropicApiKey: raw.anthropicApiKey ?? null,
  digestAt: raw.digestAt ?? null,
  defaultShell: raw.defaultShell ?? "pwsh.exe",
  claudeBinOverride: raw.claudeBin ?? null,
  // JetBrains Toolbox puts a `webstorm` shell script on PATH; overridable.
  webstormBin: raw.webstormBin ?? null,
  isDev: process.env.DECK_DEV === "1",
  isProd: process.env.NODE_ENV === "production",
};

export type Config = typeof config;
