import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { ProjectSummary } from "@deck/shared";
import {
  buildEncodedIndex,
  listTranscriptDirs,
  matchDirToProject,
} from "../transcripts/locator.js";
import { ptyManager } from "../pty/manager.js";

export interface ScannedProject {
  id: string;
  path: string;
  name: string;
  hasGit: boolean;
  activityAt: number;
}

function safeMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// Newest *.jsonl mtime per project path, computed in one pass over the
// transcript dirs so we don't re-stat directories per project.
function transcriptActivityByProject(
  projectPaths: string[],
): Map<string, number> {
  const index = buildEncodedIndex(projectPaths);
  const result = new Map<string, number>();
  for (const info of listTranscriptDirs()) {
    const owner = matchDirToProject(info.name, index);
    if (!owner) continue;
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(info.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    let newest = result.get(owner) ?? 0;
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const m = safeMtime(path.join(info.dir, f.name));
      if (m > newest) newest = m;
    }
    if (newest > 0) result.set(owner, newest);
  }
  return result;
}

// §4.1 — enumerate direct children of ROOT; a child with .git is a project.
export function scanProjects(): ScannedProject[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(config.root, { withFileTypes: true });
  } catch (err) {
    console.warn("[scanner] cannot read root", config.root, err);
    return [];
  }

  const dirs = entries.filter(
    (e) => e.isDirectory() || e.isSymbolicLink(),
  );
  const candidates: { id: string; path: string; hasGit: boolean }[] = [];
  for (const d of dirs) {
    const full = path.win32.join(config.root, d.name);
    // .git can be a directory (normal) or a file (worktree/submodule).
    const hasGit = fs.existsSync(path.win32.join(full, ".git"));
    if (hasGit) candidates.push({ id: d.name, path: full, hasGit });
  }

  const projectPaths = candidates.map((c) => c.path);
  const transcriptActivity = transcriptActivityByProject(projectPaths);

  return candidates.map((c) => {
    const gitDir = path.win32.join(c.path, ".git");
    const activityAt = Math.max(
      safeMtime(path.win32.join(gitDir, "index")),
      safeMtime(path.win32.join(gitDir, "HEAD")),
      safeMtime(path.win32.join(gitDir, "FETCH_HEAD")),
      transcriptActivity.get(c.path) ?? 0,
      ptyManager.lastActivityForProject(c.path),
    );
    return {
      id: c.id,
      path: c.path,
      name: c.id,
      hasGit: c.hasGit,
      activityAt,
    };
  });
}
