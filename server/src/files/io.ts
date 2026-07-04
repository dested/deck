import fs from "node:fs";
import path from "node:path";
import type { FileContent } from "@deck/shared";

const MAX_FILE = 2 * 1024 * 1024; // 2MB (§3.1)

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  sh: "shell",
  ps1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
};

export function languageFor(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  return EXT_LANG[ext] ?? "plaintext";
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Resolve a repo-relative path safely under the repo root (no traversal escape).
export function resolveInRepo(repo: string, rel: string): string | null {
  const norm = rel.replace(/\//g, "\\").replace(/^[\\/]+/, "");
  const abs = path.win32.normalize(path.win32.join(repo, norm));
  const repoNorm = path.win32.normalize(repo).toLowerCase();
  if (!abs.toLowerCase().startsWith(repoNorm)) return null;
  return abs;
}

// Retry once on transient EBUSY/EPERM (agents writing concurrently, §12).
function readWithRetry(abs: string): Buffer {
  try {
    return fs.readFileSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      const until = Date.now() + 120;
      while (Date.now() < until) {
        /* brief spin */
      }
      return fs.readFileSync(abs);
    }
    throw err;
  }
}

export function readFileContent(repo: string, rel: string): FileContent {
  const abs = resolveInRepo(repo, rel);
  if (!abs) throw new Error("invalid path");
  const stat = fs.statSync(abs);
  if (stat.size > MAX_FILE) {
    return {
      content: "",
      language: languageFor(rel),
      size: stat.size,
      truncated: true,
    };
  }
  const buf = readWithRetry(abs);
  if (isBinary(buf)) {
    return {
      content: "",
      language: "plaintext",
      size: stat.size,
      truncated: false,
      binary: true,
    };
  }
  return {
    content: buf.toString("utf8"),
    language: languageFor(rel),
    size: stat.size,
    truncated: false,
  };
}

export function writeFileContent(repo: string, rel: string, content: string) {
  const abs = resolveInRepo(repo, rel);
  if (!abs) throw new Error("invalid path");
  fs.writeFileSync(abs, content, "utf8");
}
