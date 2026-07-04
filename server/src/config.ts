import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// deck.config.json (optional, at repo root) can override any of these.
interface RawConfig {
  root?: string;
  port?: number;
  claudeDir?: string;
  defaultShell?: string;
  claudeBin?: string;
  webstormBin?: string;
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

export const config = {
  repoRoot,
  root: raw.root ?? "G:\\code",
  port: raw.port ?? 12345,
  devPort: 12346,
  claudeDir: raw.claudeDir ?? path.join(home, ".claude"),
  claudeProjectsDir:
    raw.claudeDir != null
      ? path.join(raw.claudeDir, "projects")
      : path.join(home, ".claude", "projects"),
  deckStateDir: path.join(home, ".deck"),
  deckStateFile: path.join(home, ".deck", "state.json"),
  defaultShell: raw.defaultShell ?? "pwsh.exe",
  claudeBinOverride: raw.claudeBin ?? null,
  // JetBrains Toolbox puts a `webstorm` shell script on PATH; overridable.
  webstormBin: raw.webstormBin ?? null,
  isDev: process.env.DECK_DEV === "1",
  isProd: process.env.NODE_ENV === "production",
};

export type Config = typeof config;
