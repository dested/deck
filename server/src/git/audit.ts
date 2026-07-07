import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AuditFinding,
  AuditImpact,
  AuditImpactArea,
  AuditRiskLevel,
  AuditSeverity,
  GitAuditReport,
  GitAuditState,
} from "@deck/shared";
import { config } from "../config.js";
import { aiComplete, parseAiJson } from "../ai/client.js";
import { runGit, getStatus } from "./service.js";

// PR audit: one AI pass over the ENTIRE change (dirty tree, or unpushed
// commits when clean) + the project's cliffnotes → a strict-JSON pre-merge
// report (risk / impact / bugs / checklist). Reports are cached per project
// (memory + ~/.deck/audits/) and keyed by a sha1 of the audited diff so the
// client can tell when a report has gone stale.

const AUDIT_MAX_LINES_PER_FILE = 400;
const AUDIT_MAX_TOTAL = 150 * 1024;
const UNTRACKED_MAX_LINES = 300;
const UNTRACKED_MAX_FILES = 30;
const CLIFFNOTES_CAP = 16_000;

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf",
  ".otf", ".eot", ".zip", ".gz", ".tar", ".exe", ".dll", ".node", ".pdf",
  ".mp3", ".mp4", ".wasm", ".db", ".sqlite",
]);

export interface AuditContext {
  scope: "working" | "branch";
  branch: string;
  diff: string;
  subjects: string; // branch scope: the unpushed commit subjects
  stats: { files: number; additions: number; deletions: number };
  sig: string;
  empty: boolean;
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function truncateForAudit(diff: string): string {
  const files = diff.split(/(?=^diff --git )/m);
  const capped = files.map((f) => {
    const lines = f.split("\n");
    if (lines.length <= AUDIT_MAX_LINES_PER_FILE) return f;
    return (
      lines.slice(0, AUDIT_MAX_LINES_PER_FILE).join("\n") +
      `\n…[truncated ${lines.length - AUDIT_MAX_LINES_PER_FILE} lines]`
    );
  });
  let out = capped.join("");
  if (out.length > AUDIT_MAX_TOTAL) {
    out = out.slice(0, AUDIT_MAX_TOTAL) + "\n…[truncated]";
  }
  return out;
}

// Untracked files never show in `git diff`, but new files are exactly where
// bugs hide — inline their contents as pseudo-diffs (text only, capped).
function untrackedBlob(cwd: string, paths: string[]): { text: string; lines: number } {
  let text = "";
  let lines = 0;
  const take = paths.slice(0, UNTRACKED_MAX_FILES);
  for (const rel of take) {
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    try {
      const full = path.join(cwd, rel);
      if (!fs.statSync(full).isFile()) continue;
      const buf = fs.readFileSync(full);
      if (buf.length > 512 * 1024 || buf.includes(0)) continue; // binary/huge
      const all = buf.toString("utf8").split("\n");
      lines += all.length;
      const body = all.slice(0, UNTRACKED_MAX_LINES).join("\n");
      const trunc =
        all.length > UNTRACKED_MAX_LINES
          ? `\n…[truncated ${all.length - UNTRACKED_MAX_LINES} lines]`
          : "";
      text += `\n\n=== NEW FILE (untracked): ${rel} ===\n${body}${trunc}`;
    } catch {
      /* unreadable → skip */
    }
  }
  if (paths.length > take.length) {
    text += `\n\n…and ${paths.length - take.length} more untracked files (omitted).`;
  }
  return { text, lines };
}

function parseNumstat(raw: string): { files: number; additions: number; deletions: number } {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    files += 1;
    if (m[1] !== "-") additions += Number(m[1]);
    if (m[2] !== "-") deletions += Number(m[2]);
  }
  return { files, additions, deletions };
}

// Branch scope: what would this branch's unpushed work merge as? Prefer the
// upstream; else diff against the best-guess base branch (origin/main etc.).
async function branchBase(cwd: string, branch: string): Promise<string | null> {
  const up = (
    await runGit(cwd, ["rev-parse", "--abbrev-ref", "@{u}"], { allowFail: true })
  ).stdout.trim();
  if (up) return up;
  for (const cand of ["origin/main", "origin/master", "main", "master"]) {
    if (cand === branch) continue;
    const ok = await runGit(cwd, ["rev-parse", "--verify", "--quiet", cand], {
      allowFail: true,
    });
    if (ok.exitCode === 0 && ok.stdout.trim()) return cand;
  }
  return null;
}

export async function gatherAuditContext(cwd: string): Promise<AuditContext> {
  const status = await getStatus(cwd);
  const branch = status.branch ?? "HEAD";
  const dirty =
    status.staged.length > 0 ||
    status.unstaged.length > 0 ||
    status.conflicted.length > 0;

  if (dirty) {
    // Everything uncommitted: staged + unstaged vs HEAD, plus untracked contents.
    let diff = (
      await runGit(cwd, ["diff", "HEAD", "--no-color"], { allowFail: true })
    ).stdout;
    let stats = parseNumstat(
      (await runGit(cwd, ["diff", "HEAD", "--numstat"], { allowFail: true })).stdout,
    );
    const untrackedPaths = status.unstaged
      .filter((f) => f.untracked)
      .map((f) => f.path);
    const untracked = untrackedBlob(cwd, untrackedPaths);
    // Combined cap: the untracked blob rides after the tracked diff, so the
    // total bound must apply to the concatenation (finding from the audit's
    // own first run on this repo).
    diff = truncateForAudit(diff) + untracked.text;
    if (diff.length > AUDIT_MAX_TOTAL) {
      diff = diff.slice(0, AUDIT_MAX_TOTAL) + "\n…[truncated]";
    }
    stats = {
      files: stats.files + untrackedPaths.length,
      additions: stats.additions + untracked.lines,
      deletions: stats.deletions,
    };
    return {
      scope: "working",
      branch,
      diff,
      subjects: "",
      stats,
      sig: sha1(diff),
      empty: diff.trim().length === 0,
    };
  }

  // Clean tree → audit the unpushed/unmerged commits instead.
  const base = await branchBase(cwd, branch);
  if (!base) {
    return {
      scope: "branch",
      branch,
      diff: "",
      subjects: "",
      stats: { files: 0, additions: 0, deletions: 0 },
      sig: "",
      empty: true,
    };
  }
  const range = `${base}...HEAD`;
  const diff = truncateForAudit(
    (await runGit(cwd, ["diff", range, "--no-color"], { allowFail: true })).stdout,
  );
  const stats = parseNumstat(
    (await runGit(cwd, ["diff", range, "--numstat"], { allowFail: true })).stdout,
  );
  const subjects = (
    await runGit(cwd, ["log", `${base}..HEAD`, "--pretty=%h %s"], {
      allowFail: true,
    })
  ).stdout.trim();
  return {
    scope: "branch",
    branch,
    diff,
    subjects,
    stats,
    sig: sha1(diff),
    empty: diff.trim().length === 0,
  };
}

function readCliffnotes(projectPath: string): string | null {
  for (const name of ["cliffnotes.md", "CLIFFNOTES.md"]) {
    const p = path.join(projectPath, name);
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").slice(0, CLIFFNOTES_CAP);
    } catch {
      /* unreadable → treat as absent */
    }
  }
  return null;
}

// ----- report cache: memory + ~/.deck/audits/<safe id>.json -----

const memCache = new Map<string, GitAuditReport>();
const auditsDir = path.join(config.deckStateDir, "audits");

function safeName(projectId: string): string {
  return projectId.replace(/[^A-Za-z0-9-_.]/g, "-");
}

function loadReport(projectId: string): GitAuditReport | null {
  const hit = memCache.get(projectId);
  if (hit) return hit;
  try {
    const raw = fs.readFileSync(
      path.join(auditsDir, `${safeName(projectId)}.json`),
      "utf8",
    );
    const report = JSON.parse(raw) as GitAuditReport;
    memCache.set(projectId, report);
    return report;
  } catch {
    return null;
  }
}

function saveReport(projectId: string, report: GitAuditReport) {
  memCache.set(projectId, report);
  try {
    fs.mkdirSync(auditsDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditsDir, `${safeName(projectId)}.json`),
      JSON.stringify(report),
    );
  } catch {
    /* disk persistence is best-effort */
  }
}

// ----- prompt + response sanitization -----

const AUDIT_SYSTEM =
  "You are a merciless senior engineer doing a pre-merge audit of a change. " +
  "You get the project's cliffnotes (its living map) and the full diff. " +
  "Work ONLY from what is provided — never use tools or read files; you must " +
  "answer in a single turn. " +
  "Hunt for REAL problems: logic bugs, broken contracts between files, missed " +
  "call sites, state-shape breaks, race conditions, security holes. Use the " +
  "cliffnotes to name the user-facing features the change touches and to spot " +
  "violated project gotchas. Be extremely terse — every string is read at a " +
  "glance. No hedging, no praise, no restating the diff.\n\n" +
  "Output ONLY a JSON object, no prose, exactly this shape:\n" +
  "{\n" +
  '  "headline": string,            // ≤12 words: what this change IS\n' +
  '  "verdict": string,             // ONE sentence: overall take\n' +
  '  "risk": { "level": "low"|"medium"|"high", "why": string /* ≤140 chars */ },\n' +
  '  "impacts": [ { "area": "db"|"api"|"ui"|"state"|"config"|"deps"|"infra"|"tests"|"docs"|"other",\n' +
  '                  "summary": string /* ≤140 chars */, "files": string[] /* ≤5 */ } ],\n' +
  '  "findings": [ { "severity": "bug"|"risk"|"nit", "title": string /* ≤80 chars */,\n' +
  '                   "detail": string /* ≤200 chars */, "file": string|null, "line": number|null } ],\n' +
  '  "features": string[],          // user-facing features/systems touched, per cliffnotes, ≤8\n' +
  '  "checklist": string[]          // concrete before-merge actions (restarts, installs, migrations, untested flows), ≤8\n' +
  "}\n\n" +
  "Findings: bugs first, then risks, then nits. Only include findings you can " +
  "point at in the diff — no speculation. If the change is genuinely clean, " +
  "findings may be empty and risk low. line = new-file line number from hunk " +
  "headers when citable, else null.";

const RISK_LEVELS: AuditRiskLevel[] = ["low", "medium", "high"];
const SEVERITIES: AuditSeverity[] = ["bug", "risk", "nit"];
const AREAS: AuditImpactArea[] = [
  "db", "api", "ui", "state", "config", "deps", "infra", "tests", "docs", "other",
];
const SEV_ORDER: Record<AuditSeverity, number> = { bug: 0, risk: 1, nit: 2 };

function str(v: unknown, cap: number): string {
  return typeof v === "string" ? v.trim().slice(0, cap) : "";
}

function strList(v: unknown, cap: number, itemCap = 160): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, itemCap))
    .filter(Boolean)
    .slice(0, cap);
}

export interface RawReport {
  headline?: unknown;
  verdict?: unknown;
  risk?: { level?: unknown; why?: unknown };
  impacts?: unknown;
  findings?: unknown;
  features?: unknown;
  checklist?: unknown;
}

export function sanitizeReport(raw: RawReport): {
  headline: string;
  verdict: string;
  risk: { level: AuditRiskLevel; why: string };
  impacts: AuditImpact[];
  findings: AuditFinding[];
  features: string[];
  checklist: string[];
} {
  const level = RISK_LEVELS.includes(raw.risk?.level as AuditRiskLevel)
    ? (raw.risk!.level as AuditRiskLevel)
    : "medium";
  const impacts: AuditImpact[] = (Array.isArray(raw.impacts) ? raw.impacts : [])
    .map((i: any): AuditImpact | null => {
      const summary = str(i?.summary, 160);
      if (!summary) return null;
      return {
        area: AREAS.includes(i?.area) ? i.area : "other",
        summary,
        files: strList(i?.files, 5, 200),
      };
    })
    .filter((i): i is AuditImpact => !!i)
    .slice(0, 12);
  const findings: AuditFinding[] = (Array.isArray(raw.findings) ? raw.findings : [])
    .map((f: any): AuditFinding | null => {
      const title = str(f?.title, 120);
      if (!title) return null;
      return {
        severity: SEVERITIES.includes(f?.severity) ? f.severity : "risk",
        title,
        detail: str(f?.detail, 260),
        file: str(f?.file, 200) || null,
        line: typeof f?.line === "number" && f.line > 0 ? Math.floor(f.line) : null,
      };
    })
    .filter((f): f is AuditFinding => !!f)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
    .slice(0, 24);
  return {
    headline: str(raw.headline, 120) || "Change audit",
    verdict: str(raw.verdict, 300),
    risk: { level, why: str(raw.risk?.why, 200) },
    impacts,
    findings,
    features: strList(raw.features, 8),
    checklist: strList(raw.checklist, 8, 200),
  };
}

// ----- public API -----

export async function getAuditState(
  projectId: string,
  cwd: string,
): Promise<GitAuditState> {
  const report = loadReport(projectId);
  if (!report) return { report: null, stale: false };
  const ctx = await gatherAuditContext(cwd);
  return { report, stale: ctx.sig !== report.diffSig };
}

// Pure prompt assembly (no AI, no state) — shared with the smoke test.
export async function buildAuditRequest(
  cwd: string,
): Promise<{ system: string; prompt: string; ctx: AuditContext }> {
  const ctx = await gatherAuditContext(cwd);
  if (ctx.empty) throw new Error("nothing to audit — tree clean and no unpushed work");
  const cliffnotes = readCliffnotes(cwd);
  const parts = [
    `Branch: ${ctx.branch} (scope: ${ctx.scope === "working" ? "uncommitted working tree" : "unpushed commits"})`,
    ctx.subjects ? `Commits under audit:\n${ctx.subjects}` : null,
    cliffnotes
      ? `Project cliffnotes:\n${cliffnotes}`
      : "This project has no cliffnotes.md.",
    `Diff:\n${ctx.diff}`,
  ].filter(Boolean);
  return { system: AUDIT_SYSTEM, prompt: parts.join("\n\n"), ctx };
}

// Run a fresh audit. Returns null when AI is off / over budget / dropped
// (aiComplete semantics); throws with a user-facing message on bad input.
export async function runAudit(
  projectId: string,
  cwd: string,
): Promise<GitAuditReport | null> {
  const { system, prompt, ctx } = await buildAuditRequest(cwd);
  const res = await aiComplete({
    feature: "prAudit",
    system,
    prompt,
    json: true,
    maxTokens: 4000,
    // No cwd: the context is fully inline, and a repo cwd tempts `claude -p`
    // into tool use, which --max-turns 1 turns into an error_max_turns fail
    // (verified). Scratch cwd also keeps the ghost transcript out of the repo.
    timeoutMs: 240_000,
  });
  if (!res) return null;
  const raw = parseAiJson<RawReport>(res.text);
  if (!raw) throw new Error("audit came back malformed — try again");

  const report: GitAuditReport = {
    generatedAt: Date.now(),
    scope: ctx.scope,
    branch: ctx.branch,
    ...sanitizeReport(raw),
    stats: ctx.stats,
    model: res.model,
    costUSD: res.costUSD,
    durationMs: res.durationMs,
    diffSig: ctx.sig,
  };
  saveReport(projectId, report);
  return report;
}

const ASK_SYSTEM =
  "You are answering a quick question about a pending change. You get the " +
  "project's cliffnotes, the current diff, the latest audit report, and the " +
  "question. Work ONLY from what is provided — never use tools or read files; " +
  "answer in a single turn. Answer in ≤80 words, plain text (no markdown " +
  "headers), naming specific files/lines where relevant. If the diff doesn't " +
  "answer it, say so in one line — don't guess.";

export async function askAudit(
  projectId: string,
  cwd: string,
  question: string,
): Promise<string | null> {
  const q = question.trim().slice(0, 2000);
  if (!q) throw new Error("empty question");
  const ctx = await gatherAuditContext(cwd);
  if (ctx.empty) throw new Error("nothing to ask about — tree clean and no unpushed work");
  const cliffnotes = readCliffnotes(cwd);
  const last = loadReport(projectId);

  const parts = [
    cliffnotes ? `Project cliffnotes:\n${cliffnotes}` : null,
    last
      ? `Latest audit report:\n${JSON.stringify({
          headline: last.headline,
          verdict: last.verdict,
          risk: last.risk,
          findings: last.findings,
        })}`
      : null,
    `Diff:\n${ctx.diff}`,
    `Question: ${q}`,
  ].filter(Boolean);

  const res = await aiComplete({
    feature: "prAudit",
    system: ASK_SYSTEM,
    prompt: parts.join("\n\n"),
    maxTokens: 800,
    timeoutMs: 180_000,
  });
  return res ? res.text.trim() : null;
}
