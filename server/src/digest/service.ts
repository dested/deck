import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { projectRegistry } from "../projects/registry.js";
import { runGit } from "../git/service.js";
import { transcriptFilesForProject } from "../transcripts/locator.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { getCostReport } from "../cost/service.js";
import { aiComplete } from "../ai/client.js";
import { eventHub, topics } from "../ws/events.js";

// M14: "what got done" across all projects for a time window. Gathers commits,
// agent sessions, and cost per project, then a single sonnet call renders a
// standup-style markdown digest, written to ~/.deck/digests/.

const PER_PROJECT_CAP = 2048;
const TOTAL_CAP = 40 * 1024;

const SYSTEM =
  "Write a standup-style digest in Markdown. Sections: `## Highlights` (3–6 " +
  "bullets, most important first), `## By project` (### per project: commits, " +
  "agent work, unfinished threads), `## Spend` (one line per notable cost). Be " +
  "concrete — name files, commits, sessions. No filler, no praise.";

interface ProjectDigestCtx {
  name: string;
  activity: number; // sort key
  text: string;
}

async function gatherProject(
  projectId: string,
  projectPath: string,
  name: string,
  fromMs: number,
  toMs: number,
): Promise<ProjectDigestCtx | null> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  // Commits in window.
  const logRes = await runGit(
    projectPath,
    [
      "log",
      `--since=${fromIso}`,
      `--until=${toIso}`,
      "--pretty=format:%h|%s|%an",
    ],
    { allowFail: true },
  );
  const commits = logRes.stdout.split("\n").map((l) => l.trim()).filter(Boolean);

  // Sessions active in window.
  const sessions: string[] = [];
  for (const info of transcriptFilesForProject(projectPath)) {
    if (info.mtimeMs < fromMs || info.mtimeMs > toMs) continue;
    const parsed = transcriptRegistry.getParsed(info.sessionId);
    if (!parsed) continue;
    const files = new Set<string>();
    for (const e of parsed.events)
      if (e.kind === "tool" && e.isEdit?.path) files.add(e.isEdit.path);
    const title = parsed.title ?? info.sessionId.slice(0, 8);
    const fileList = [...files].slice(0, 8).join(", ");
    sessions.push(
      `- ${title} (${parsed.events.length} events${fileList ? `; files: ${fileList}` : ""})`,
    );
  }

  if (commits.length === 0 && sessions.length === 0) return null;

  const cost = (await getCostReport())
    .projects.find((p) => p.projectId === projectId);

  let text = `### ${name}\n`;
  if (commits.length) {
    text += `Commits:\n${commits.map((c) => `- ${c}`).join("\n")}\n`;
  }
  if (sessions.length) {
    text += `Agent sessions:\n${sessions.join("\n")}\n`;
  }
  if (cost) text += `Cost: $${cost.cost.toFixed(2)} (${cost.sessionCount} sessions)\n`;
  if (text.length > PER_PROJECT_CAP) text = text.slice(0, PER_PROJECT_CAP) + "…\n";

  const activity = Math.max(commits.length, sessions.length);
  return { name, activity, text };
}

export async function generateDigest(
  fromMs: number,
  toMs: number,
): Promise<{ markdown: string; path: string; name: string }> {
  const projects = projectRegistry.getAll().filter((p) => !p.hidden);
  const ctxs: ProjectDigestCtx[] = [];
  for (const p of projects) {
    const c = await gatherProject(p.id, p.path, p.name, fromMs, toMs);
    if (c) ctxs.push(c);
  }
  ctxs.sort((a, b) => b.activity - a.activity);

  let context = `Window: ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}\n\n`;
  for (const c of ctxs) {
    if (context.length + c.text.length > TOTAL_CAP) break;
    context += c.text + "\n";
  }

  let markdown: string;
  if (ctxs.length === 0) {
    markdown = `# Digest\n\n_No commits or agent sessions in this window._\n`;
  } else {
    const res = await aiComplete({
      feature: "digest",
      system: SYSTEM,
      prompt: context,
      maxTokens: 4000,
    });
    markdown = res?.text?.trim()
      ? res.text.trim()
      : `# Digest\n\n_AI digest unavailable; raw activity below._\n\n${context}`;
  }

  fs.mkdirSync(config.digestsDir, { recursive: true });
  const dateStr = new Date(toMs).toISOString().slice(0, 10);
  let n = 1;
  let name = `${dateStr}-${n}.md`;
  while (fs.existsSync(path.join(config.digestsDir, name))) {
    n += 1;
    name = `${dateStr}-${n}.md`;
  }
  const file = path.join(config.digestsDir, name);
  fs.writeFileSync(file, markdown, "utf8");
  return { markdown, path: file, name };
}

export function listDigests(): { name: string; ts: number }[] {
  try {
    return fs
      .readdirSync(config.digestsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        name: f,
        ts: fs.statSync(path.join(config.digestsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export function readDigest(name: string): string | null {
  // Guard against path traversal — only a bare filename in the digests dir.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  try {
    return fs.readFileSync(path.join(config.digestsDir, name), "utf8");
  } catch {
    return null;
  }
}

// ----- Scheduler (config-gated) -----
let scheduler: NodeJS.Timeout | null = null;
let lastFiredDay = "";

export function startDigestScheduler() {
  if (scheduler || !config.digestAt) return;
  const target = config.digestAt; // "HH:MM"
  scheduler = setInterval(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    const day = now.toISOString().slice(0, 10);
    if (hhmm === target && lastFiredDay !== day) {
      lastFiredDay = day;
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      void generateDigest(start.getTime(), now.getTime())
        .then((r) => {
          eventHub.publish([topics.projects], { t: "digest.ready", name: r.name });
        })
        .catch(() => {});
    }
  }, 60_000);
  scheduler.unref?.();
}

export function stopDigestScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}
