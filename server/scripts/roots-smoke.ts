// Smoke test for UI-managed project roots: adding a runtime extra root makes
// scanProjects() discover its child git projects, and removing it drops them.
// Mirrors what the /roots route does (setRuntimeExtraRoots + rescan). Pure fs +
// in-memory; never touches state.json or the running server.
//   Run: bun run --filter @deck/server tsx scripts/roots-smoke.ts
//   (or from server/: npx tsx scripts/roots-smoke.ts)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  config,
  setRuntimeExtraRoots,
  getRuntimeExtraRoots,
  fileRoots,
} from "../src/config.js";
import { scanProjects } from "../src/projects/scanner.js";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ✓", msg);
  } else {
    fail++;
    console.error("  ✗", msg);
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deck-root-"));
const projDir = path.join(tmpRoot, "smoke-proj");
fs.mkdirSync(path.join(projDir, ".git"), { recursive: true });
fs.writeFileSync(path.join(projDir, ".git", "HEAD"), "ref: refs/heads/main\n");

const normProj = path.win32.resolve(projDir).toLowerCase();
const normTmp = path.win32.resolve(tmpRoot).toLowerCase();

console.log("tmp root:", tmpRoot);
console.log("primary root:", config.root);
console.log("file roots:", fileRoots);

try {
  const before = scanProjects();
  ok(
    !before.some((p) => p.path.toLowerCase() === normProj),
    "project absent before add",
  );

  setRuntimeExtraRoots([tmpRoot]);
  ok(
    config.roots.some((r) => r.toLowerCase() === normTmp),
    "config.roots includes the added root",
  );
  const after = scanProjects();
  const found = after.find((p) => p.path.toLowerCase() === normProj);
  ok(!!found, "project discovered after add");
  ok(found?.name === "smoke-proj", "discovered project keeps folder name");

  setRuntimeExtraRoots([tmpRoot, tmpRoot.toUpperCase()]);
  const dupCount = config.roots.filter((r) => r.toLowerCase() === normTmp).length;
  ok(dupCount === 1, "duplicate root deduped case-insensitively");

  setRuntimeExtraRoots([]);
  ok(getRuntimeExtraRoots().length === 0, "extra roots cleared");
  const gone = scanProjects();
  ok(
    !gone.some((p) => p.path.toLowerCase() === normProj),
    "project absent after remove",
  );
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
