import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import type {
  GitStatus,
  GitFileEntry,
  GitStatusCode,
  AheadBehind,
  DiffResult,
  FileAtHead,
  Commit,
  CommitShow,
  FileChange,
} from "@deck/shared";
import { parseUnifiedDiff } from "./diffParser.js";

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

// Base args applied to every invocation: no i18n surprises, no path quoting.
const BASE = ["-c", "core.quotepath=false"];

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGit(
  cwd: string,
  args: string[],
  opts: { input?: string; allowFail?: boolean } = {},
): Promise<GitRunResult> {
  try {
    const res = await execa("git", [...BASE, ...args], {
      cwd,
      env: GIT_ENV,
      input: opts.input,
      stripFinalNewline: false,
      reject: false,
      windowsHide: true,
    });
    return {
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      exitCode: res.exitCode ?? 0,
    };
  } catch (err) {
    if (opts.allowFail) return { stdout: "", stderr: String(err), exitCode: 1 };
    throw err;
  }
}

function codeFromChar(c: string): GitStatusCode {
  switch (c) {
    case "M":
      return "M";
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    case "C":
      return "C";
    case "T":
      return "T";
    case "U":
      return "U";
    case "?":
      return "?";
    default:
      return "M";
  }
}

// Parse `git status --porcelain=v2 --branch -z` output.
// -z gives NUL-separated records; rename records (type '2') carry the original
// path as the *next* NUL token, so we walk tokens with a manual cursor.
export function parseStatusV2(raw: string): GitStatus {
  const tokens = raw.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let aheadBehind: AheadBehind | null = null;

  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];
  const conflicted: GitFileEntry[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;

    if (line.startsWith("# ")) {
      const body = line.slice(2);
      if (body.startsWith("branch.head ")) {
        const h = body.slice("branch.head ".length);
        branch = h === "(detached)" ? null : h;
      } else if (body.startsWith("branch.upstream ")) {
        upstream = body.slice("branch.upstream ".length);
      } else if (body.startsWith("branch.ab ")) {
        const m = /\+(\d+) -(\d+)/.exec(body);
        if (m) aheadBehind = { ahead: Number(m[1]), behind: Number(m[2]) };
      }
      continue;
    }

    const kind = line[0];
    if (kind === "1") {
      // "1 XY sub mH mI mW hH hI path"
      const xy = line.slice(2, 4);
      const path = sliceAfterNthSpace(line, 8);
      pushEntry(staged, unstaged, conflicted, xy, path, undefined);
    } else if (kind === "2") {
      // "2 XY sub mH mI mW hH hI Xscore path" + NUL + origPath
      const xy = line.slice(2, 4);
      const path = sliceAfterNthSpace(line, 9);
      const origPath = tokens[i + 1] ?? undefined;
      i++; // consume the origPath token
      pushEntry(staged, unstaged, conflicted, xy, path, origPath);
    } else if (kind === "u") {
      // unmerged: "u XY sub m1 m2 m3 mW h1 h2 h3 path"
      const path = sliceAfterNthSpace(line, 10);
      conflicted.push({
        path,
        code: "U",
        staged: false,
        untracked: false,
        conflicted: true,
      });
    } else if (kind === "?") {
      const path = line.slice(2);
      unstaged.push({
        path,
        code: "?",
        staged: false,
        untracked: true,
        conflicted: false,
      });
    }
    // "!" ignored entries are dropped.
  }

  const clean =
    staged.length === 0 && unstaged.length === 0 && conflicted.length === 0;

  return { branch, upstream, aheadBehind, staged, unstaged, conflicted, clean };
}

function sliceAfterNthSpace(s: string, n: number): string {
  let idx = 0;
  for (let count = 0; count < n; count++) {
    idx = s.indexOf(" ", idx);
    if (idx < 0) return "";
    idx++;
  }
  return s.slice(idx);
}

function pushEntry(
  staged: GitFileEntry[],
  unstaged: GitFileEntry[],
  conflicted: GitFileEntry[],
  xy: string,
  path: string,
  origPath: string | undefined,
) {
  const x = xy[0]!;
  const y = xy[1]!;
  if (x !== "." && x !== "?") {
    staged.push({
      path,
      origPath,
      code: codeFromChar(x),
      staged: true,
      untracked: false,
      conflicted: false,
    });
  }
  if (y !== "." && y !== "?") {
    unstaged.push({
      path,
      origPath,
      code: codeFromChar(y),
      staged: false,
      untracked: false,
      conflicted: false,
    });
  }
}

export async function getStatus(cwd: string): Promise<GitStatus> {
  const { stdout } = await runGit(cwd, [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
  ]);
  return parseStatusV2(stdout);
}

export interface StatusSummary {
  branch: string | null;
  dirtyCount: number;
  aheadBehind: AheadBehind | null;
}

export function summarize(status: GitStatus): StatusSummary {
  const paths = new Set<string>();
  for (const e of status.staged) paths.add(e.path);
  for (const e of status.unstaged) paths.add(e.path);
  for (const e of status.conflicted) paths.add(e.path);
  return {
    branch: status.branch,
    dirtyCount: paths.size,
    aheadBehind: status.aheadBehind,
  };
}

export async function getStatusSummary(cwd: string): Promise<StatusSummary> {
  return summarize(await getStatus(cwd));
}

// ---------------------------------------------------------------------------
// Diff (§6)
// ---------------------------------------------------------------------------
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

export async function getDiff(
  cwd: string,
  relPath: string,
  staged: boolean,
  context = 3,
): Promise<DiffResult> {
  const args = staged
    ? ["diff", "--cached", "--no-color", `-U${context}`, "--", relPath]
    : ["diff", "--no-color", `-U${context}`, "--", relPath];
  const { stdout } = await runGit(cwd, args);
  if (stdout.trim()) return parseUnifiedDiff(relPath, stdout);

  // Untracked file (unstaged view): synthesize an all-add diff.
  if (!staged) {
    const abs = path.win32.join(cwd, relPath.replace(/\//g, "\\"));
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_DIFF_BYTES) {
        return { path: relPath, fileHeader: "", hunks: [], raw: "", binary: true };
      }
      const buf = fs.readFileSync(abs);
      if (isBinary(buf)) {
        return { path: relPath, fileHeader: "", hunks: [], raw: "", binary: true };
      }
      return synthAddDiff(relPath, buf.toString("utf8"));
    } catch {
      /* fallthrough */
    }
  }
  return { path: relPath, fileHeader: "", hunks: [], raw: "" };
}

function synthAddDiff(relPath: string, content: string): DiffResult {
  const rawLines = content.split("\n");
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  const n = rawLines.length;
  const header = `@@ -0,0 +1,${n} @@`;
  const body = rawLines.map((l) => "+" + l).join("\n");
  const fileHeader =
    `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}`;
  const raw = `${fileHeader}\n${header}\n${body}`;
  return parseUnifiedDiff(relPath, raw);
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function getFileAtHead(
  cwd: string,
  relPath: string,
): Promise<FileAtHead> {
  const { stdout, exitCode } = await runGit(
    cwd,
    ["show", `HEAD:${relPath}`],
    { allowFail: true },
  );
  if (exitCode !== 0) return { content: "", exists: false };
  return { content: stdout, exists: true };
}

// ---------------------------------------------------------------------------
// Staging (§6)
// ---------------------------------------------------------------------------
export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length) await runGit(cwd, ["add", "--", ...paths]);
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  // reset works even before the first commit; restore --staged would too.
  await runGit(cwd, ["reset", "-q", "HEAD", "--", ...paths], { allowFail: true });
}

export async function applyHunk(
  cwd: string,
  patch: string,
  reverse: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const args = ["apply", "--cached", "--whitespace=nowarn"];
  if (reverse) args.push("-R");
  args.push("-");
  const body = patch.endsWith("\n") ? patch : patch + "\n";
  const res = await runGit(cwd, args, { input: body, allowFail: true });
  return res.exitCode === 0 ? { ok: true } : { ok: false, error: res.stderr };
}

// Discard a single hunk from the worktree: reverse-apply it (no --cached).
export async function discardHunk(
  cwd: string,
  patch: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = patch.endsWith("\n") ? patch : patch + "\n";
  const res = await runGit(cwd, ["apply", "-R", "--whitespace=nowarn", "-"], {
    input: body,
    allowFail: true,
  });
  return res.exitCode === 0 ? { ok: true } : { ok: false, error: res.stderr };
}

export async function discard(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const status = await getStatus(cwd);
  const untracked = new Set(
    status.unstaged.filter((e) => e.untracked).map((e) => e.path),
  );
  const tracked = paths.filter((p) => !untracked.has(p));
  const toClean = paths.filter((p) => untracked.has(p));
  if (tracked.length) {
    await runGit(cwd, ["checkout", "--", ...tracked], { allowFail: true });
    // Also unstage+discard staged changes to these paths.
    await runGit(cwd, ["reset", "-q", "HEAD", "--", ...tracked], {
      allowFail: true,
    });
    await runGit(cwd, ["checkout", "--", ...tracked], { allowFail: true });
  }
  if (toClean.length) await runGit(cwd, ["clean", "-fd", "--", ...toClean]);
}

// ---------------------------------------------------------------------------
// Commit / log / show (§6)
// ---------------------------------------------------------------------------
export async function commit(
  cwd: string,
  message: string,
  amend: boolean,
): Promise<{ hash: string }> {
  const args = ["commit", "-F", "-"];
  if (amend) args.push("--amend");
  const res = await runGit(cwd, args, { input: message, allowFail: true });
  if (res.exitCode !== 0) throw new Error(res.stderr || "commit failed");
  const { stdout } = await runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return { hash: stdout.trim() };
}

// Push the current branch. If it has no upstream yet, set one on `origin`
// (`git push -u origin <branch>`), matching what a first manual push does.
// git writes progress to stderr on success, so key off the exit code only.
export async function push(
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  const status = await getStatus(cwd);
  const args = ["push"];
  if (!status.upstream && status.branch) {
    args.push("--set-upstream", "origin", status.branch);
  }
  const res = await runGit(cwd, args, { allowFail: true });
  const output = (res.stderr || res.stdout || "").trim();
  if (res.exitCode !== 0) throw new Error(output || "push failed");
  return { ok: true, output };
}

const LOG_FMT = "%H%x1f%h%x1f%s%x1f%an%x1f%at%x1f%D%x1e";

export async function log(cwd: string, limit: number): Promise<Commit[]> {
  const { stdout } = await runGit(cwd, [
    "log",
    `-n${limit}`,
    `--pretty=format:${LOG_FMT}`,
  ]);
  return stdout
    .split("\x1e")
    .map((r) => r.replace(/^\n/, "").trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, shortHash, subject, author, at, refs] = rec.split("\x1f");
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        subject: subject ?? "",
        author: author ?? "",
        date: Number(at ?? 0) * 1000,
        refs: (refs ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      } satisfies Commit;
    });
}

export async function show(cwd: string, hash: string): Promise<CommitShow> {
  const sep = "\x1e";
  const { stdout: meta } = await runGit(cwd, [
    "show",
    "-s",
    `--pretty=format:%H${sep}%s${sep}%an${sep}%at${sep}%b`,
    hash,
  ]);
  const [h, subject, author, at, body] = meta.split(sep);
  // File list for the commit.
  const { stdout: names } = await runGit(cwd, [
    "show",
    "--no-color",
    "--name-status",
    "--pretty=format:",
    hash,
  ]);
  const files: FileChange[] = [];
  for (const line of names.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\t/);
    const code = parts[0]![0] as GitStatusCode;
    files.push({ code: codeFromChar(code), path: parts[parts.length - 1]! });
  }
  return {
    hash: h ?? hash,
    subject: subject ?? "",
    body: body ?? "",
    author: author ?? "",
    date: Number(at ?? 0) * 1000,
    files,
  };
}

export async function showFileDiff(
  cwd: string,
  hash: string,
  relPath: string,
): Promise<DiffResult> {
  const { stdout } = await runGit(cwd, [
    "show",
    "--no-color",
    "-U3",
    "--format=",
    hash,
    "--",
    relPath,
  ]);
  return parseUnifiedDiff(relPath, stdout);
}

// M13: gather the change context for AI commit-message generation. Staged
// changes win; otherwise the worktree diff + untracked file list. Truncated to
// keep the prompt bounded (300 lines/file, 60KB total). Plus recent subjects as
// a style reference and a short status summary line.
const AI_MAX_LINES_PER_FILE = 300;
const AI_MAX_TOTAL = 60 * 1024;

function truncateDiff(diff: string): string {
  // Split on file boundaries, cap each file's line count.
  const files = diff.split(/(?=^diff --git )/m);
  const capped = files.map((f) => {
    const lines = f.split("\n");
    if (lines.length <= AI_MAX_LINES_PER_FILE) return f;
    return (
      lines.slice(0, AI_MAX_LINES_PER_FILE).join("\n") +
      `\n…[truncated ${lines.length - AI_MAX_LINES_PER_FILE} lines]`
    );
  });
  let out = capped.join("");
  if (out.length > AI_MAX_TOTAL) {
    out = out.slice(0, AI_MAX_TOTAL) + "\n…[truncated]";
  }
  return out;
}

export async function diffForAi(cwd: string): Promise<{
  diff: string;
  recentSubjects: string;
  summary: string;
  empty: boolean;
}> {
  const status = await getStatus(cwd);
  const hasStaged = status.staged.length > 0;
  let diff: string;
  if (hasStaged) {
    diff = (await runGit(cwd, ["diff", "--cached", "--no-color"], { allowFail: true }))
      .stdout;
  } else {
    diff = (await runGit(cwd, ["diff", "--no-color"], { allowFail: true })).stdout;
    const untracked = status.unstaged
      .filter((f) => f.untracked)
      .map((f) => f.path);
    if (untracked.length) {
      diff += `\n\nUntracked (new) files:\n${untracked.join("\n")}`;
    }
  }
  diff = truncateDiff(diff);
  const recentSubjects = (
    await runGit(cwd, ["log", "-10", "--pretty=%s"], { allowFail: true })
  ).stdout.trim();
  const summary = (
    await runGit(cwd, ["status", "--porcelain=v2", "--branch"], {
      allowFail: true,
    })
  ).stdout
    .split("\n")
    .filter((l) => l.startsWith("# "))
    .join("\n");
  return {
    diff,
    recentSubjects,
    summary,
    empty: diff.trim().length === 0,
  };
}
