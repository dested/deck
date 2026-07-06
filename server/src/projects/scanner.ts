import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { ProjectSummary } from "@deck/shared";
import {
  buildEncodedIndex,
  encodePath,
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

// §4.1 — enumerate direct children of every configured root; a child with .git
// is a project. Roots beyond the first come from deck.config.json `roots`.
export function scanProjects(): ScannedProject[] {
  const candidates: { id: string; path: string; hasGit: boolean }[] = [];
  const seenIds = new Set<string>();
  config.roots.forEach((root, rootIdx) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      console.warn("[scanner] cannot read root", root, err);
      return;
    }
    for (const d of entries) {
      if (!d.isDirectory() && !d.isSymbolicLink()) continue;
      const full = path.win32.join(root, d.name);
      // .git can be a directory (normal) or a file (worktree/submodule).
      if (!fs.existsSync(path.win32.join(full, ".git"))) continue;
      // Primary-root projects keep the bare folder name as id (state.json
      // pins/groups and client tabs are keyed by it); extra roots use the
      // encoded full path so the same folder name can exist under two roots.
      const id = rootIdx === 0 ? d.name : encodePath(full);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      candidates.push({ id, path: full, hasGit: true });
    }
  });

  const projectPaths = candidates.map((c) => c.path);
  const transcriptActivity = transcriptActivityByProject(projectPaths);

  return candidates.map((c) => {
    const gitDir = path.win32.join(c.path, ".git");
    // NOTE: intentionally does NOT include .git/FETCH_HEAD — a background
    // `git fetch` (IDE/automation) is not user activity and would wrongly
    // float a long-untouched project to the top of the list.
    const activityAt = Math.max(
      safeMtime(path.win32.join(gitDir, "index")),
      safeMtime(path.win32.join(gitDir, "HEAD")),
      transcriptActivity.get(c.path) ?? 0,
      ptyManager.lastActivityForProject(c.path),
    );
    return {
      id: c.id,
      path: c.path,
      // Extra-root ids are encoded paths; the display name stays the folder.
      name: path.win32.basename(c.path),
      hasGit: c.hasGit,
      activityAt,
    };
  });
}
