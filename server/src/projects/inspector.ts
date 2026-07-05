import fs from "node:fs";
import path from "node:path";
import type { ProjectInspection, ProjectScript } from "@deck/shared";
import { getState } from "../state.js";

// Scrapes a project's identity from files on disk (README, package.json,
// cliffnotes.md, config files) for the Library cards. Everything is cached by
// source-file mtimes so the batch endpoint can serve all ~150 projects cheaply.

const READ_CAP = 32 * 1024; // never slurp a giant README
const BLURB_MAX = 220;

// Priority-ordered dep -> badge map. First hits win; capped at 6 badges.
const FRAMEWORK_DEPS: [string, string][] = [
  ["next", "Next"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@sveltejs/kit", "SvelteKit"],
  ["astro", "Astro"],
  ["expo", "Expo"],
  ["react-native", "React Native"],
  ["electron", "Electron"],
  ["@tauri-apps/api", "Tauri"],
  ["remotion", "Remotion"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["solid-js", "Solid"],
  ["vite", "Vite"],
  ["@nestjs/core", "Nest"],
  ["fastify", "Fastify"],
  ["express", "Express"],
  ["hono", "Hono"],
  ["koa", "Koa"],
  ["colyseus", "Colyseus"],
  ["socket.io", "Socket.IO"],
  ["discord.js", "Discord.js"],
  ["three", "Three.js"],
  ["pixi.js", "Pixi"],
  ["phaser", "Phaser"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["tailwindcss", "Tailwind"],
];

// Non-node language markers (existsSync is case-insensitive on win32).
const LANGUAGE_MARKERS: [string, string][] = [
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
];

const PORT_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "astro.config.mjs",
  "nuxt.config.ts",
  ".env",
  ".env.local",
  "deck.config.json",
];

interface CacheEntry {
  key: string; // joined mtimes of every source file
  value: ProjectInspection;
}
const cache = new Map<string, CacheEntry>();

function readCapped(p: string): string | null {
  try {
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.alloc(READ_CAP);
      const n = fs.readSync(fd, buf, 0, READ_CAP, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function mtimeOf(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// Strip markdown noise from a candidate blurb line: images, badges, links,
// emphasis, inline code. Returns plain-ish text.
function demarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images/badges
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/[*_`]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampBlurb(s: string): string {
  if (s.length <= BLURB_MAX) return s;
  return s.slice(0, BLURB_MAX - 1).trimEnd() + "…";
}

// First heading + first real paragraph of a markdown doc.
function parseMarkdownIntro(md: string): {
  title: string | null;
  para: string | null;
} {
  let title: string | null = null;
  let para: string | null = null;
  const lines = md.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (!title) title = demarkdown(line.replace(/^#+\s*/, ""));
      continue;
    }
    // Skip pure-badge/HTML/table/hr/code-fence lines.
    if (/^(\[!\[|!\[|<|\||---|```|===)/.test(line)) continue;
    const text = demarkdown(line.replace(/^>\s*/, ""));
    if (text.length < 8) continue; // too short to be a description
    para = text;
    break;
  }
  return { title, para };
}

function parsePorts(sources: string[]): number[] {
  const found = new Set<number>();
  const push = (m: string | undefined) => {
    const n = Number(m);
    if (n >= 1000 && n <= 65535) found.add(n);
  };
  const patterns = [
    /--port[= ](\d{3,5})/g,
    /(?<![\w-])-p +(\d{3,5})/g,
    /\bPORT\s*[=:]\s*["']?(\d{3,5})/gi,
    /\bport["']?\s*[:=]\s*["']?(\d{3,5})/gi,
    /localhost:(\d{3,5})/g,
    /127\.0\.0\.1:(\d{3,5})/g,
  ];
  for (const src of sources) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) push(m[1]);
    }
  }
  return [...found].sort((a, b) => a - b).slice(0, 4);
}

export function inspectProject(
  projectId: string,
  projectPath: string,
): ProjectInspection {
  const readmePath = path.win32.join(projectPath, "README.md");
  const pkgPath = path.win32.join(projectPath, "package.json");
  const cliffPath = path.win32.join(projectPath, "cliffnotes.md");

  const aiBlurb = getState().projectBlurbs[projectId] ?? null;
  const key = [
    mtimeOf(readmePath),
    mtimeOf(pkgPath),
    mtimeOf(cliffPath),
    aiBlurb?.at ?? 0,
  ].join("|");

  const hit = cache.get(projectId);
  if (hit && hit.key === key) return hit.value;

  // ---- README / cliffnotes ----
  const readmeRaw = readCapped(readmePath);
  const readme = readmeRaw ? parseMarkdownIntro(readmeRaw) : null;
  const cliffRaw = readCapped(cliffPath);
  const cliff = cliffRaw ? parseMarkdownIntro(cliffRaw) : null;

  // ---- package.json ----
  let packageName: string | null = null;
  let packageDesc: string | null = null;
  let scripts: ProjectScript[] = [];
  let workspaceGlobs = 0;
  const deps = new Set<string>();
  const pkgRaw = readCapped(pkgPath);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        description?: string;
        scripts?: Record<string, string>;
        workspaces?: string[] | { packages?: string[] };
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      packageName = typeof pkg.name === "string" ? pkg.name : null;
      packageDesc =
        typeof pkg.description === "string" && pkg.description.trim()
          ? pkg.description.trim()
          : null;
      if (pkg.scripts) {
        scripts = Object.entries(pkg.scripts)
          .filter(([, v]) => typeof v === "string")
          .slice(0, 16)
          .map(([name, command]) => ({ name, command }));
      }
      const ws = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;
      workspaceGlobs = Array.isArray(ws) ? ws.length : 0;
      for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
      for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);
    } catch {
      /* malformed package.json — treat as absent */
    }
  }

  // ---- frameworks / languages ----
  const frameworks: string[] = [];
  for (const [dep, label] of FRAMEWORK_DEPS) {
    if (frameworks.length >= 6) break;
    if (deps.has(dep)) frameworks.push(label);
  }
  for (const [marker, label] of LANGUAGE_MARKERS) {
    if (frameworks.length >= 6) break;
    if (
      !frameworks.includes(label) &&
      fs.existsSync(path.win32.join(projectPath, marker))
    ) {
      frameworks.push(label);
    }
  }

  // ---- package manager (lockfile) ----
  const has = (f: string) => fs.existsSync(path.win32.join(projectPath, f));
  const runner =
    has("bun.lockb") || has("bun.lock")
      ? ("bun" as const)
      : has("pnpm-lock.yaml")
        ? ("pnpm" as const)
        : has("yarn.lock")
          ? ("yarn" as const)
          : ("npm" as const);

  // ---- static ports ----
  const portSources: string[] = scripts.map((s) => s.command);
  for (const f of PORT_CONFIG_FILES) {
    const src = readCapped(path.win32.join(projectPath, f));
    if (src) portSources.push(src);
  }
  const staticPorts = parsePorts(portSources);

  // ---- blurb (readme > package > cliffnotes > ai) ----
  let blurb: string | null = null;
  let blurbSource: ProjectInspection["blurbSource"] = null;
  if (readme?.para) {
    blurb = readme.para;
    blurbSource = "readme";
  } else if (packageDesc) {
    blurb = packageDesc;
    blurbSource = "package";
  } else if (cliff?.para) {
    blurb = cliff.para;
    blurbSource = "cliffnotes";
  } else if (aiBlurb?.text) {
    blurb = aiBlurb.text;
    blurbSource = "ai";
  }

  const value: ProjectInspection = {
    projectId,
    blurb: blurb ? clampBlurb(blurb) : null,
    blurbSource,
    readmeTitle: readme?.title ?? null,
    hasReadme: readmeRaw != null,
    packageName,
    frameworks,
    scripts,
    workspaceGlobs,
    staticPorts,
    runner,
  };
  cache.set(projectId, { key, value });
  return value;
}
