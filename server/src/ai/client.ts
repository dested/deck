import { execFile } from "node:child_process";
import fs from "node:fs";
import type { AiFeatureId, AiResult, AiBackend } from "@deck/shared";
import { config } from "../config.js";
import { getState, updateState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { ptyManager } from "../pty/manager.js";
import { cleanEnv } from "../lib/cleanEnv.js";
import { AI_FEATURES } from "./models.js";
import { priceUsage } from "./pricing.js";
import { usageLedger } from "./usage.js";
import type { AiRequest } from "./types.js";

// The ONE choke point for every AI call Deck makes on its own behalf. Picks the
// model per feature (user-adjustable), enforces daily budgets, records
// cost/tokens/latency to the ledger, and supports two backends. Returns null
// when the feature is off / over budget / failed — callers degrade silently.

interface EffectiveConfig {
  enabled: boolean;
  model: string;
  featureBudget: number;
}

function effectiveConfig(feature: AiFeatureId): EffectiveConfig {
  const def = AI_FEATURES[feature];
  const override = getState().aiConfig.features[feature] ?? {};
  return {
    enabled: override.enabled ?? def.defaultEnabled,
    model: override.model ?? def.defaultModel,
    featureBudget: override.dailyBudgetUSD ?? def.dailyBudgetUSD,
  };
}

function globalBudget(): number {
  return getState().aiConfig.globalDailyBudgetUSD ?? 3.0;
}

// One in-flight call per feature; a second tick's request is dropped, not queued.
const inFlight = new Set<AiFeatureId>();
// budget marker de-dupe: "<feature>|<YYYY-MM-DD>" already logged.
const budgetMarked = new Set<string>();

function parseJsonLoose<T>(stdout: string): T | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    // Try trimming to the last closing brace (CLI may append trailing noise).
    const end = stdout.lastIndexOf("}");
    if (end > start) {
      try {
        return JSON.parse(stdout.slice(start, end + 1)) as T;
      } catch {
        /* give up */
      }
    }
    return null;
  }
}

// gotcha #3: a `claude -p` run writes a real transcript. Dismiss its session id
// immediately so it never surfaces as an external "agent" card — even for
// scratch-cwd calls (cheap insurance).
function dismissGhost(sessionId: string | undefined | null) {
  if (!sessionId) return;
  updateState((s) => {
    s.dismissedSessions[sessionId] = Date.now();
  });
  eventHub.publish([topics.sessions], { t: "sessions.removed", id: sessionId });
}

interface CliJson {
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  duration_ms?: number;
  session_id?: string;
  is_error?: boolean;
}

function buildPrompt(req: AiRequest): string {
  let p = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
  if (req.json) {
    p += "\n\nOutput ONLY valid JSON — no prose, no code fences.";
  }
  return p;
}

async function runCli(
  req: AiRequest,
  model: string,
): Promise<{ result: AiResult | null }> {
  const bin = ptyManager.getClaudeBin();
  if (!bin) return { result: null };
  fs.mkdirSync(config.aiScratchDir, { recursive: true });
  const prompt = buildPrompt(req);
  const timeout = req.timeoutMs ?? 60_000;
  const started = Date.now();
  return new Promise((resolve) => {
    // The prompt goes via STDIN (`claude -p` reads the query from stdin when no
    // positional is given). This avoids Windows' ~8KB command-line limit for
    // large prompts (commit diffs, digests) and any arg-quoting hazards.
    const child = execFile(
      "cmd",
      [
        "/c",
        bin,
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--max-turns",
        "1",
      ],
      {
        cwd: req.cwd ?? config.aiScratchDir,
        env: cleanEnv(),
        windowsHide: true,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout) => {
        const parsed = parseJsonLoose<CliJson>(stdout ?? "");
        // Always dismiss the ghost transcript, success or fail.
        dismissGhost(parsed?.session_id);
        if (!parsed || parsed.is_error || typeof parsed.result !== "string") {
          if (err) return resolve({ result: null });
          if (!parsed) return resolve({ result: null });
        }
        const u = parsed?.usage ?? {};
        const result: AiResult = {
          text: (parsed?.result ?? "").trim(),
          model,
          backend: "claude-cli",
          costUSD: parsed?.total_cost_usd ?? 0,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          durationMs: parsed?.duration_ms ?? Date.now() - started,
        };
        if (!result.text) return resolve({ result: null });
        resolve({ result });
      },
    );
    // Feed the prompt in and close stdin so claude starts processing.
    try {
      child.stdin?.end(prompt);
    } catch {
      /* if stdin is already gone, the callback path handles the failure */
    }
  });
}

// ----- api backend (lazy Anthropic SDK client) -----
let apiClient: unknown | null = null;
let apiClientKey: string | null = null;

function resolveApiKey(): string | null {
  return config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
}

async function getApiClient(key: string): Promise<any | null> {
  if (apiClient && apiClientKey === key) return apiClient;
  try {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = mod.default;
    apiClient = new Anthropic({ apiKey: key });
    apiClientKey = key;
    return apiClient;
  } catch (err) {
    console.warn("[ai] anthropic sdk unavailable:", err);
    return null;
  }
}

async function runApi(
  req: AiRequest,
  model: string,
  key: string,
): Promise<{ result: AiResult | null }> {
  const client = await getApiClient(key);
  if (!client) return { result: null };
  const started = Date.now();
  try {
    const prompt = req.json
      ? `${req.prompt}\n\nOutput ONLY valid JSON — no prose, no code fences.`
      : req.prompt;
    // gotcha #2: never send temperature/top_p/top_k; disable thinking on sonnet.
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [{ role: "user", content: prompt }],
    };
    if (req.system) body.system = req.system;
    if (model === "claude-sonnet-5") body.thinking = { type: "disabled" };
    const resp = await client.messages.create(body);
    const text = (resp.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const u = resp.usage ?? {};
    const { costUSD } = priceUsage(model, {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    });
    const result: AiResult = {
      text: text.trim(),
      model,
      backend: "api",
      costUSD,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      durationMs: Date.now() - started,
    };
    if (!result.text) return { result: null };
    return { result };
  } catch (err) {
    console.warn("[ai] api call failed:", err);
    return { result: null };
  }
}

export async function aiComplete(req: AiRequest): Promise<AiResult | null> {
  const feature = req.feature;
  const eff = effectiveConfig(feature);
  if (!eff.enabled) return null;

  // One concurrent call per feature; drop a second in-flight request.
  if (inFlight.has(feature)) return null;

  // Budget gates.
  const spentGlobal = usageLedger.spentToday();
  const spentFeature = usageLedger.spentToday(feature);
  if (spentGlobal >= globalBudget() || spentFeature >= eff.featureBudget) {
    const day = new Date().toISOString().slice(0, 10);
    const marker = `${feature}|${day}`;
    if (!budgetMarked.has(marker)) {
      budgetMarked.add(marker);
      usageLedger.recordUsage({
        ts: Date.now(),
        feature,
        model: eff.model,
        backend: getState().aiConfig.backend ?? "claude-cli",
        ok: false,
        error: "budget",
        costUSD: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      });
    }
    return null;
  }

  // Backend selection: default claude-cli; fall back to cli if api has no key.
  let backend: AiBackend = getState().aiConfig.backend ?? "claude-cli";
  const key = resolveApiKey();
  if (backend === "api" && !key) backend = "claude-cli";

  inFlight.add(feature);
  const started = Date.now();
  let result: AiResult | null = null;
  let error: string | undefined;
  try {
    if (backend === "api" && key) {
      result = (await runApi(req, eff.model, key)).result;
    } else {
      result = (await runCli(req, eff.model)).result;
    }
    if (!result) error = "call failed";
  } catch (err) {
    error = String(err);
    result = null;
  } finally {
    inFlight.delete(feature);
    usageLedger.recordUsage({
      ts: Date.now(),
      feature,
      model: result?.model ?? eff.model,
      backend: result?.backend ?? backend,
      ok: !!result,
      error: result ? undefined : error,
      costUSD: result?.costUSD ?? 0,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      durationMs: result?.durationMs ?? Date.now() - started,
    });
  }
  return result;
}

// Parse a JSON object out of an AI result's text (loose — for json:true calls).
export function parseAiJson<T>(text: string): T | null {
  return parseJsonLoose<T>(text);
}
