import { execa } from "execa";
import type {
  CostReport,
  ProjectCost,
  SessionCost,
  DailyCost,
  ActiveBlock,
  CostModelBreakdown,
} from "@deck/shared";
import { config } from "../config.js";
import { transcriptRegistry } from "../transcripts/registry.js";

// ============================================================================
// Cost dashboard data, sourced from `ccusage` (which reads the same Claude Code
// JSONL transcripts Deck parses). We shell out to three ccusage reports and
// stitch them into one CostReport, joining per-session cost onto Deck projects
// by transcript uuid. Everything is filtered to Claude models — Deck is a
// Claude mission-control, and ccusage also tracks other agents on this machine.
// ============================================================================

const TTL_MS = 60_000; // background report cache
const CMD_TIMEOUT_MS = 120_000; // first run may download ccusage via bun x

// bun x ccusage <cmd>. The user runs `bunx ccusage`; `bun x` is the same and
// avoids depending on the bunx.exe shim being on PATH.
const CCUSAGE = ["x", "ccusage"];

function isClaudeModel(name: string | undefined | null): boolean {
  return !!name && /claude|opus|sonnet|haiku/i.test(name);
}

// ccusage JSON row shapes (only the fields we consume).
interface RawModelBreakdown {
  modelName?: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}
interface RawSession {
  period?: string; // transcript uuid
  totalCost?: number;
  totalTokens?: number;
  modelBreakdowns?: RawModelBreakdown[];
  metadata?: { lastActivity?: string };
}
interface RawDaily {
  period?: string; // YYYY-MM-DD
  modelBreakdowns?: RawModelBreakdown[];
}
interface RawBlock {
  id?: string;
  isActive?: boolean;
  isGap?: boolean;
  startTime?: string;
  endTime?: string;
  costUSD?: number;
  totalTokens?: number;
  models?: string[];
  burnRate?: { costPerHour?: number; tokensPerMinute?: number };
  projection?: {
    remainingMinutes?: number;
    totalCost?: number;
    totalTokens?: number;
  };
}

// bun x may print progress ("Resolving dependencies…") before the JSON; parse
// from the first brace so that preamble never breaks us.
function parseJsonLoose<T>(stdout: string): T | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return null;
  }
}

async function runCcusage<T>(args: string[]): Promise<T | null> {
  const res = await execa("bun", [...CCUSAGE, ...args, "--json", "--offline"], {
    cwd: config.repoRoot,
    reject: false,
    windowsHide: true,
    timeout: CMD_TIMEOUT_MS,
  });
  if (res.exitCode !== 0 && !res.stdout) return null;
  return parseJsonLoose<T>(res.stdout ?? "");
}

// Sum only the Claude-model breakdowns of a row into a per-model map.
function accumulate(
  into: Map<string, CostModelBreakdown>,
  breakdowns: RawModelBreakdown[] | undefined,
): { cost: number; tokens: number } {
  let cost = 0;
  let tokens = 0;
  for (const b of breakdowns ?? []) {
    if (!isClaudeModel(b.modelName)) continue;
    const c = b.cost ?? 0;
    const t =
      (b.inputTokens ?? 0) +
      (b.outputTokens ?? 0) +
      (b.cacheCreationTokens ?? 0) +
      (b.cacheReadTokens ?? 0);
    cost += c;
    tokens += t;
    const key = b.modelName!;
    const cur =
      into.get(key) ??
      ({
        model: key,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      } satisfies CostModelBreakdown);
    cur.cost += c;
    cur.inputTokens += b.inputTokens ?? 0;
    cur.outputTokens += b.outputTokens ?? 0;
    cur.cacheCreationTokens += b.cacheCreationTokens ?? 0;
    cur.cacheReadTokens += b.cacheReadTokens ?? 0;
    into.set(key, cur);
  }
  return { cost, tokens };
}

async function buildReport(): Promise<CostReport> {
  const base: CostReport = {
    generatedAt: Date.now(),
    available: false,
    totalCost: 0,
    totalTokens: 0,
    projects: [],
    daily: [],
    sessions: {},
    activeBlock: null,
  };

  const [sessionRes, dailyRes, blockRes] = await Promise.all([
    runCcusage<{ session?: RawSession[] }>(["session"]),
    runCcusage<{ daily?: RawDaily[] }>(["daily"]),
    runCcusage<{ blocks?: RawBlock[] }>(["blocks", "--active"]),
  ]);

  if (!sessionRes && !dailyRes) {
    return {
      ...base,
      error:
        "ccusage not available — install it (bun add -g ccusage) or run `bunx ccusage` once.",
    };
  }

  // ---- Per-session cost, joined to projects by transcript uuid ----
  const sessionProjects = transcriptRegistry.allSessionProjects();
  const sessions: Record<string, SessionCost> = {};
  const projMap = new Map<
    string,
    { cost: number; tokens: number; count: number; byModel: Map<string, CostModelBreakdown>; last: number | null }
  >();

  for (const s of sessionRes?.session ?? []) {
    const id = s.period;
    if (!id) continue;
    const perModel = new Map<string, CostModelBreakdown>();
    const { cost, tokens } = accumulate(perModel, s.modelBreakdowns);
    if (cost === 0 && tokens === 0) continue; // no Claude usage in this session
    const last = s.metadata?.lastActivity
      ? Date.parse(s.metadata.lastActivity)
      : null;
    sessions[id] = {
      sessionId: id,
      cost,
      totalTokens: tokens,
      lastActivity: Number.isNaN(last as number) ? null : last,
      models: [...perModel.keys()],
    };

    const projectId = sessionProjects.get(id);
    if (!projectId) continue; // usage outside Deck's project root — still in totals
    const cur =
      projMap.get(projectId) ??
      { cost: 0, tokens: 0, count: 0, byModel: new Map(), last: null };
    cur.cost += cost;
    cur.tokens += tokens;
    cur.count += 1;
    if (last && (!cur.last || last > cur.last)) cur.last = last;
    for (const [k, v] of perModel) {
      const m =
        cur.byModel.get(k) ??
        ({ model: k, cost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } satisfies CostModelBreakdown);
      m.cost += v.cost;
      m.inputTokens += v.inputTokens;
      m.outputTokens += v.outputTokens;
      m.cacheCreationTokens += v.cacheCreationTokens;
      m.cacheReadTokens += v.cacheReadTokens;
      cur.byModel.set(k, m);
    }
    projMap.set(projectId, cur);
  }

  const projects: ProjectCost[] = [...projMap.entries()]
    .map(([projectId, v]) => ({
      projectId,
      cost: v.cost,
      totalTokens: v.tokens,
      sessionCount: v.count,
      byModel: [...v.byModel.values()].sort((a, b) => b.cost - a.cost),
      lastActivity: v.last,
    }))
    .sort((a, b) => b.cost - a.cost);

  // ---- Daily series (Claude-only) — the truthful all-time totals ----
  const daily: DailyCost[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  for (const d of dailyRes?.daily ?? []) {
    if (!d.period) continue;
    const { cost, tokens } = accumulate(new Map(), d.modelBreakdowns);
    if (cost === 0 && tokens === 0) continue;
    daily.push({ date: d.period, cost, totalTokens: tokens });
    totalCost += cost;
    totalTokens += tokens;
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  // ---- Active 5-hour billing block (live burn rate) ----
  let activeBlock: ActiveBlock | null = null;
  const block = (blockRes?.blocks ?? []).find(
    (b) => b.isActive && !b.isGap && (b.models ?? []).some(isClaudeModel),
  );
  if (block) {
    const start = block.startTime ? Date.parse(block.startTime) : Date.now();
    const end = block.endTime ? Date.parse(block.endTime) : Date.now();
    activeBlock = {
      id: block.id ?? "active",
      startTime: start,
      endTime: end,
      costUSD: block.costUSD ?? 0,
      totalTokens: block.totalTokens ?? 0,
      models: (block.models ?? []).filter(isClaudeModel),
      burnRate: block.burnRate
        ? {
            costPerHour: block.burnRate.costPerHour ?? 0,
            tokensPerMinute: block.burnRate.tokensPerMinute ?? 0,
          }
        : null,
      projection: block.projection
        ? {
            remainingMinutes: block.projection.remainingMinutes ?? 0,
            totalCost: block.projection.totalCost ?? 0,
            totalTokens: block.projection.totalTokens ?? 0,
          }
        : null,
    };
  }

  return {
    generatedAt: Date.now(),
    available: true,
    totalCost,
    totalTokens,
    projects,
    daily,
    sessions,
    activeBlock,
  };
}

let cached: CostReport | null = null;
let inflight: Promise<CostReport> | null = null;

// Serve from cache; refresh in the background when stale. Callers never wait on
// ccusage unless there's no cached report yet.
export async function getCostReport(force = false): Promise<CostReport> {
  const fresh = cached && Date.now() - cached.generatedAt < TTL_MS;
  if (cached && fresh && !force) return cached;
  if (inflight) return cached ?? inflight;
  inflight = buildReport()
    .then((r) => {
      cached = r;
      return r;
    })
    .catch((err) => {
      const r: CostReport = {
        generatedAt: Date.now(),
        available: false,
        error: String(err),
        totalCost: 0,
        totalTokens: 0,
        projects: [],
        daily: [],
        sessions: {},
        activeBlock: null,
      };
      cached = r;
      return r;
    })
    .finally(() => {
      inflight = null;
    });
  return cached ?? inflight;
}

// Fire-and-forget warm-up at boot.
export function primeCostReport(): void {
  void getCostReport(true).catch(() => {});
}
