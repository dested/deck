import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// §4.2 Encoding: take the full absolute cwd and replace every character that is
// not [A-Za-z0-9-] with '-'. Verified against real dirs:
//   G:\code\scenebeans2    -> G--code-scenebeans2
//   G:\code\shitpost.gg    -> G--code-shitpost-gg
export function encodePath(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9-]/g, "-");
}

// A transcript dir name may correspond to a project cwd OR a subdirectory of it
// (e.g. "G--code-scenebeans2-sub" belongs to project scenebeans2). We resolve a
// transcript dir to a project by longest-prefix match against the encoded forms
// of known project paths.
export interface TranscriptDirInfo {
  dir: string; // absolute dir path
  name: string; // encoded dir name
}

export function listTranscriptDirs(): TranscriptDirInfo[] {
  try {
    const entries = fs.readdirSync(config.claudeProjectsDir, {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        dir: path.join(config.claudeProjectsDir, e.name),
        name: e.name,
      }));
  } catch {
    return [];
  }
}

// Build encoded -> projectPath for the given project paths.
export function buildEncodedIndex(
  projectPaths: string[],
): { encoded: string; projectPath: string }[] {
  return projectPaths
    .map((p) => ({ encoded: encodePath(p), projectPath: p }))
    .sort((a, b) => b.encoded.length - a.encoded.length); // longest first
}

// Given a transcript dir name, find the owning project path (longest prefix).
export function matchDirToProject(
  dirName: string,
  index: { encoded: string; projectPath: string }[],
): string | null {
  for (const entry of index) {
    if (
      dirName === entry.encoded ||
      dirName.startsWith(entry.encoded + "-")
    ) {
      return entry.projectPath;
    }
  }
  return null;
}

// All transcript dirs that map to a given project path.
export function transcriptDirsForProject(projectPath: string): string[] {
  const encoded = encodePath(projectPath);
  const result: string[] = [];
  for (const info of listTranscriptDirs()) {
    if (info.name === encoded || info.name.startsWith(encoded + "-")) {
      // guard: startsWith could over-match a sibling project whose encoded name
      // extends this one (e.g. scenebeans2 vs scenebeans2b). The '-' separator
      // requirement above prevents the "2b" case; exact + '-' boundary is safe.
      result.push(info.dir);
    }
  }
  return result;
}

export interface TranscriptFileInfo {
  file: string; // absolute path to .jsonl
  sessionId: string; // uuid (filename without extension)
  mtimeMs: number;
  dir: string;
}

// List all *.jsonl transcript files under the dirs owned by a project.
export function transcriptFilesForProject(
  projectPath: string,
): TranscriptFileInfo[] {
  const out: TranscriptFileInfo[] = [];
  for (const dir of transcriptDirsForProject(projectPath)) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dir, f);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      out.push({
        file: full,
        sessionId: f.slice(0, -".jsonl".length),
        mtimeMs,
        dir,
      });
    }
  }
  return out;
}
