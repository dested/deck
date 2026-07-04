import fs from "node:fs";
import type { TreeNode } from "@deck/shared";
import { resolveInRepo } from "./io.js";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  ".turbo",
  ".cache",
]);

// One level of a directory, dirs first then files, alphabetical. Ignored dirs
// are flagged (not hidden — the client offers a "show ignored" toggle, §9.4).
export async function listTree(repo: string, rel: string): Promise<TreeNode[]> {
  const abs = rel ? resolveInRepo(repo, rel) : repo;
  if (!abs) throw new Error("invalid path");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = entries
    .filter((e) => e.isDirectory() || e.isFile() || e.isSymbolicLink())
    .map((e) => {
      const childRel = rel ? `${rel.replace(/\\/g, "/")}/${e.name}` : e.name;
      const isDir = e.isDirectory();
      return {
        name: e.name,
        path: childRel,
        type: isDir ? "dir" : "file",
        ignored: isDir && IGNORED.has(e.name),
      } satisfies TreeNode;
    });
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
