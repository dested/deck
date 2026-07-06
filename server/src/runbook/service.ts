import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Runbook, RunbookInfo, RunbookStatus } from "@deck/shared";
import { inspectProject } from "../projects/inspector.js";
import { portWatcher } from "../projects/ports.js";
import { aiComplete } from "../ai/client.js";

// M18 — deck.run.json: a small machine-readable "how to run/test this" record
// at each repo root. Deck (and any agent working in the repo) reads the same
// file. When absent, detection from package.json scripts / static ports fills
// in a best-effort runbook without touching the repo.

export const RUNBOOK_FILE = "deck.run.json";

const DEV_SCRIPT_PRIORITY = ["dev", "start", "serve", "watch"];
const TEST_SCRIPT_PRIORITY = ["test", "typecheck", "check", "lint"];

// Relative subdir only — no absolute paths, no escaping the repo.
function sanitizeCwd(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const clean = v.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (!clean) return null;
  if (path.win32.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) return null;
  if (clean.split("/").some((seg) => seg === "..")) return null;
  return clean;
}

function sanitizeRunbook(raw: unknown): Runbook {
  const out: Runbook = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const cwd = sanitizeCwd(r.cwd);
  if (cwd) out.cwd = cwd;
  const cmd = (v: unknown): string | null =>
    v && typeof v === "object" && typeof (v as { command?: unknown }).command === "string"
      ? ((v as { command: string }).command.trim() || null)
      : null;
  const devCmd = cmd(r.dev);
  if (devCmd) {
    const dev = r.dev as { port?: unknown; url?: unknown };
    out.dev = { command: devCmd };
    const port = Number(dev.port);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) out.dev.port = port;
    if (typeof dev.url === "string" && /^https?:\/\//.test(dev.url)) {
      out.dev.url = dev.url.trim();
    }
  }
  const testCmd = cmd(r.test);
  if (testCmd) out.test = { command: testCmd };
  const installCmd = cmd(r.install);
  if (installCmd) out.install = { command: installCmd };
  if (typeof r.notes === "string" && r.notes.trim()) {
    out.notes = r.notes.trim().slice(0, 2000);
  }
  return out;
}

function readRunbookFile(projectPath: string): Runbook | null {
  const p = path.win32.join(projectPath, RUNBOOK_FILE);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    return sanitizeRunbook(raw);
  } catch {
    return null; // malformed file == absent; detection covers us
  }
}

// Best-effort runbook from what the inspector already scrapes.
export function detectRunbook(projectId: string, projectPath: string): Runbook {
  const insp = inspectProject(projectId, projectPath);
  const out: Runbook = {};
  const scriptNames = new Set(insp.scripts.map((s) => s.name));
  const devScript = DEV_SCRIPT_PRIORITY.find((s) => scriptNames.has(s));
  if (devScript) {
    out.dev = { command: `${insp.runner} run ${devScript}` };
    if (insp.staticPorts[0]) out.dev.port = insp.staticPorts[0];
  }
  const testScript = TEST_SCRIPT_PRIORITY.find((s) => scriptNames.has(s));
  if (testScript) out.test = { command: `${insp.runner} run ${testScript}` };
  out.install = { command: `${insp.runner} install` };
  return out;
}

export function getRunbook(projectId: string, projectPath: string): RunbookInfo {
  const file = readRunbookFile(projectPath);
  if (file) return { runbook: file, hasFile: true };
  return { runbook: detectRunbook(projectId, projectPath), hasFile: false };
}

export function saveRunbook(projectPath: string, raw: unknown): Runbook {
  const clean = sanitizeRunbook(raw);
  const p = path.win32.join(projectPath, RUNBOOK_FILE);
  fs.writeFileSync(p, JSON.stringify(clean, null, 2) + "\n", "utf8");
  return clean;
}

// TCP probe — is anything listening on this port right now?
export function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, "127.0.0.1");
  });
}

function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return (
      h === "localhost" || h === "0.0.0.0" || h === "::1" || h.startsWith("127.")
    );
  } catch {
    return true; // unparseable — treat as local, the TCP probe path handles it
  }
}

// HTTP probe for EXTERNAL preview URLs (a local TCP probe says nothing about
// them): reachability + whether the response headers forbid iframe embedding
// (X-Frame-Options / CSP frame-ancestors — google.com et al. send these, so
// the preview iframe renders a browser error page we can't see into).
const urlProbeCache = new Map<
  string,
  { at: number; up: boolean; frameBlocked: boolean }
>();

async function probeUrl(
  url: string,
): Promise<{ up: boolean; frameBlocked: boolean }> {
  const hit = urlProbeCache.get(url);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  let up = false;
  let frameBlocked = false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    up = true; // any HTTP response = something is serving there
    const xfo = res.headers.get("x-frame-options");
    const csp = res.headers.get("content-security-policy") ?? "";
    frameBlocked = xfo != null || /frame-ancestors/i.test(csp);
  } catch {
    // unreachable / timed out
  }
  const out = { at: Date.now(), up, frameBlocked };
  urlProbeCache.set(url, out);
  return out;
}

export async function runbookStatus(
  projectId: string,
  projectPath: string,
): Promise<RunbookStatus> {
  const { runbook } = getRunbook(projectId, projectPath);
  const livePorts = portWatcher.getLive()[projectId] ?? [];
  // Effective port: explicit file/detected port first, else the live-detected
  // one (a dev server already running on a port we didn't predict).
  const port = runbook.dev?.port ?? livePorts[0] ?? null;
  const url =
    runbook.dev?.url ?? (port != null ? `http://localhost:${port}` : null);
  // Explicit non-local URL: the local port probe is meaningless — probe the
  // URL itself and report whether it can be iframed at all.
  if (url && runbook.dev?.url && !isLocalUrl(url)) {
    const probe = await probeUrl(url);
    return {
      port,
      url,
      listening: probe.up,
      frameBlocked: probe.frameBlocked,
      livePorts,
    };
  }
  const listening = port != null ? await probePort(port) : false;
  return { port, url, listening, frameBlocked: false, livePorts };
}

const GENERATE_PROMPT =
  "Inspect this repository (package.json scripts, README run instructions, " +
  "cliffnotes.md 'Run commands' section, vite/next config, .env PORT) and " +
  "produce a runbook JSON object describing how to run and test it. Shape:\n" +
  '{"cwd":"<relative subdir the commands run in, ONLY if not the repo root (monorepos)>",' +
  '"dev":{"command":"<start the dev server>","port":<number the app serves on>,' +
  '"url":"<optional explicit URL if not just localhost:port>"},' +
  '"test":{"command":"<run tests or typecheck>"},' +
  '"install":{"command":"<install deps>"},' +
  '"notes":"<one or two sentences of gotchas needed to run it, if any>"}\n' +
  "Omit any key you cannot determine. Output ONLY the JSON object.";

// AI-fill the runbook by reading the repo (cli backend runs with cwd access),
// then write deck.run.json so agents and Deck share it.
export async function generateRunbook(
  projectId: string,
  projectPath: string,
): Promise<Runbook | null> {
  const res = await aiComplete({
    feature: "runbook",
    prompt: GENERATE_PROMPT,
    cwd: projectPath,
    json: true,
    timeoutMs: 180_000,
  });
  if (!res?.text) return null;
  // Take the last {...} block in the output (cli chatter tolerance).
  const m = res.text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const clean = sanitizeRunbook(parsed);
  if (!clean.dev && !clean.test) return null; // AI gave us nothing usable
  return saveRunbook(projectPath, clean);
}
