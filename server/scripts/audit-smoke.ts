// PR-audit smoke test: exercises the real pipeline (context gather → prompt →
// claude -p → parse → sanitize) WITHOUT touching state.json or the usage
// ledger (a running Deck server owns those — this is safe to run alongside it).
// Makes ONE real (paid) sonnet call. Run from server/: npx tsx scripts/audit-smoke.ts
import { execFile } from "node:child_process";
import os from "node:os";
import {
  buildAuditRequest,
  sanitizeReport,
  type RawReport,
} from "../src/git/audit.js";
import { parseAiJson } from "../src/ai/client.js";
import { cleanEnv } from "../src/lib/cleanEnv.js";
import { ptyManager } from "../src/pty/manager.js";

const REPO = "G:/code/agentcommunity";

async function main() {
  // 1 — context gathering on the real dirty repo
  const { system, prompt, ctx } = await buildAuditRequest(REPO);
  console.log("[1] scope=%s branch=%s files=%d +%d -%d sig=%s promptKB=%d",
    ctx.scope, ctx.branch, ctx.stats.files, ctx.stats.additions,
    ctx.stats.deletions, ctx.sig.slice(0, 8), Math.round(prompt.length / 1024));
  if (ctx.scope !== "working") throw new Error("expected working scope on dirty tree");
  if (!prompt.includes("Project cliffnotes:")) throw new Error("cliffnotes missing from prompt");

  // 2 — sanitizer: bad enums coerced, findings sorted bugs-first, caps applied
  const nasty: RawReport = {
    headline: "x".repeat(500),
    verdict: 42 as unknown as string,
    risk: { level: "catastrophic", why: "y".repeat(500) },
    impacts: [
      { area: "database", summary: "s", files: ["a", "b", "c", "d", "e", "f", "g"] },
      { bogus: true } as any,
    ],
    findings: [
      { severity: "nit", title: "a nit", detail: "", file: null, line: -3 },
      { severity: "bug", title: "a bug", detail: "d", file: "f.ts", line: 12.7 },
      { title: "" } as any,
    ],
    features: ["one", 2 as any, "three"],
    checklist: null as any,
  };
  const clean = sanitizeReport(nasty);
  if (clean.headline.length > 120) throw new Error("headline not capped");
  if (clean.risk.level !== "medium") throw new Error("bad risk level not coerced");
  if (clean.impacts.length !== 1 || clean.impacts[0].area !== "other" || clean.impacts[0].files.length !== 5)
    throw new Error("impact sanitize failed");
  if (clean.findings.length !== 2 || clean.findings[0].severity !== "bug" || clean.findings[0].line !== 12)
    throw new Error("finding sanitize/sort failed");
  if (clean.features.join(",") !== "one,three" || clean.checklist.length !== 0)
    throw new Error("list sanitize failed");
  console.log("[2] sanitizer OK");

  // 3 — real model call (mirrors ai/client runCli, minus ledger/state writes)
  // getClaudeBin() resolves lazily inside a booted server; fall back to the
  // PATH shim for standalone runs.
  const bin = ptyManager.getClaudeBin() ?? "claude.cmd";
  const full = `${system}\n\n${prompt}\n\nOutput ONLY valid JSON — no prose, no code fences.`;
  const out = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      "cmd",
      ["/c", bin, "-p", "--model", "claude-sonnet-5", "--output-format", "json", "--max-turns", "1"],
      // scratch cwd, like runCli's default — a repo cwd tempts claude into tool use
      { cwd: os.tmpdir(), env: cleanEnv(), windowsHide: true, timeout: 240_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (stdout ? resolve(stdout) : reject(err)),
    );
    child.stdin?.end(full);
  });
  const cli = parseAiJson<{ result?: string; total_cost_usd?: number; duration_ms?: number }>(out);
  if (!cli?.result) throw new Error("no result from CLI: " + out.slice(0, 400));
  const raw = parseAiJson<RawReport>(cli.result);
  if (!raw) throw new Error("model output not JSON: " + cli.result.slice(0, 400));
  const report = sanitizeReport(raw);
  console.log("[3] model OK — cost=$%s duration=%ss",
    cli.total_cost_usd?.toFixed(3), Math.round((cli.duration_ms ?? 0) / 1000));
  console.log(JSON.stringify(report, null, 2));
}

main().then(
  () => { console.log("\nALL OK"); process.exit(0); },
  (err) => { console.error("FAIL:", err); process.exit(1); },
);
