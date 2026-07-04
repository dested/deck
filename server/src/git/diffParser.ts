import { diffWordsWithSpace } from "diff";
import type { DiffLine, Hunk, DiffResult } from "@deck/shared";

// Parse `git diff` unified output for a single file into a hunk model. Keeps the
// exact raw hunk text (`patch`) so hunk staging is byte-faithful (§6), and
// computes word-level intra-line highlights for changed line pairs.
export function parseUnifiedDiff(path: string, raw: string): DiffResult {
  const lines = raw.split("\n");

  if (raw.includes("Binary files") || raw.includes("GIT binary patch")) {
    return { path, fileHeader: "", hunks: [], raw, binary: true };
  }

  // File header = everything before the first "@@".
  let firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  if (firstHunk < 0) {
    return { path, fileHeader: raw, hunks: [], raw };
  }
  const fileHeader = lines.slice(0, firstHunk).join("\n");

  const hunks: Hunk[] = [];
  let i = firstHunk;
  while (i < lines.length) {
    const header = lines[i]!;
    if (!header.startsWith("@@")) {
      i++;
      continue;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    const oldStart = m ? Number(m[1]) : 0;
    const oldLines = m && m[2] != null ? Number(m[2]) : 1;
    const newStart = m ? Number(m[3]) : 0;
    const newLines = m && m[4] != null ? Number(m[4]) : 1;

    const bodyStart = i + 1;
    let j = bodyStart;
    const body: string[] = [];
    while (j < lines.length && !lines[j]!.startsWith("@@") && !lines[j]!.startsWith("diff --git")) {
      body.push(lines[j]!);
      j++;
    }

    const diffLines = buildLines(body, oldStart, newStart);
    const patch = header + "\n" + body.join("\n");

    hunks.push({
      header,
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: diffLines,
      patch,
    });
    i = j;
  }

  return { path, fileHeader, hunks, raw };
}

function buildLines(body: string[], oldStart: number, newStart: number): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  for (const line of body) {
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const kind = line[0];
    const text = line.slice(1);
    if (kind === "+") {
      out.push({ type: "add", oldNo: null, newNo: newNo++, text });
    } else if (kind === "-") {
      out.push({ type: "del", oldNo: oldNo++, newNo: null, text });
    } else {
      out.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  addIntraHighlights(out);
  return out;
}

// Pair each run of deletions with the following run of additions and mark the
// changed word ranges on both sides (GitHub-style intra-line highlight).
function addIntraHighlights(lines: DiffLine[]) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.type !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d]!.type === "del") d++;
    let a = d;
    while (a < lines.length && lines[a]!.type === "add") a++;
    const dels = lines.slice(i, d);
    const adds = lines.slice(d, a);
    const n = Math.min(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const [delRanges, addRanges] = wordRanges(dels[k]!.text, adds[k]!.text);
      if (delRanges.length) dels[k]!.intra = delRanges;
      if (addRanges.length) adds[k]!.intra = addRanges;
    }
    i = a > i ? a : i + 1;
  }
}

function wordRanges(
  oldText: string,
  newText: string,
): [[number, number][], [number, number][]] {
  const parts = diffWordsWithSpace(oldText, newText);
  const delRanges: [number, number][] = [];
  const addRanges: [number, number][] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const p of parts) {
    const len = p.value.length;
    if (p.added) {
      addRanges.push([newPos, newPos + len]);
      newPos += len;
    } else if (p.removed) {
      delRanges.push([oldPos, oldPos + len]);
      oldPos += len;
    } else {
      oldPos += len;
      newPos += len;
    }
  }
  return [delRanges, addRanges];
}
