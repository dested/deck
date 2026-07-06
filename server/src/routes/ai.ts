import type { FastifyInstance } from "fastify";
import type {
  AiConfigView,
  AiFeatureConfigView,
  AiFeatureId,
  AiUsageReport,
} from "@deck/shared";
import { getState, updateState } from "../state.js";
import {
  AI_FEATURES,
  AI_FEATURE_IDS,
  ALLOWED_MODELS,
  GLOBAL_DAILY_BUDGET_USD_DEFAULT,
} from "../ai/models.js";
import { usageLedger } from "../ai/usage.js";
import { aiComplete } from "../ai/client.js";
import { config } from "../config.js";
import { projectRegistry } from "../projects/registry.js";

function buildConfigView(): AiConfigView {
  const st = getState().aiConfig;
  const globalBudget = st.globalDailyBudgetUSD ?? GLOBAL_DAILY_BUDGET_USD_DEFAULT;
  const spentGlobal = usageLedger.spentToday();
  const features: AiFeatureConfigView[] = AI_FEATURE_IDS.map((id) => {
    const def = AI_FEATURES[id];
    const ov = st.features[id] ?? {};
    const budget = ov.dailyBudgetUSD ?? def.dailyBudgetUSD;
    const spent = usageLedger.spentToday(id);
    return {
      feature: id,
      label: def.label,
      enabled: ov.enabled ?? def.defaultEnabled,
      model: ov.model ?? def.defaultModel,
      dailyBudgetUSD: budget,
      spentTodayUSD: spent,
      callsToday: usageLedger.callsToday(id),
      capped: spent >= budget || spentGlobal >= globalBudget,
    };
  });
  const apiKeyPresent =
    !!config.anthropicApiKey || !!process.env.ANTHROPIC_API_KEY;
  return {
    backend: st.backend ?? "claude-cli",
    apiKeyPresent,
    globalDailyBudgetUSD: globalBudget,
    spentTodayUSD: spentGlobal,
    features,
  };
}

export async function registerAiRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { days?: string } }>("/ai/usage", async (req) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const report: AiUsageReport = usageLedger.usageReport(days);
    return report;
  });

  app.get("/ai/config", async () => buildConfigView());

  app.patch<{
    Body: {
      backend?: "claude-cli" | "api";
      globalDailyBudgetUSD?: number;
      feature?: AiFeatureId;
      enabled?: boolean;
      model?: string;
      dailyBudgetUSD?: number;
    };
  }>("/ai/config", async (req, reply) => {
    const b = req.body ?? {};
    if (b.model && !ALLOWED_MODELS.includes(b.model as never)) {
      return reply.code(400).send({ error: "invalid model" });
    }
    if (b.backend && b.backend !== "claude-cli" && b.backend !== "api") {
      return reply.code(400).send({ error: "invalid backend" });
    }
    updateState((s) => {
      const ai = s.aiConfig;
      if (b.backend) ai.backend = b.backend;
      if (typeof b.globalDailyBudgetUSD === "number")
        ai.globalDailyBudgetUSD = Math.max(0, b.globalDailyBudgetUSD);
      if (b.feature && AI_FEATURES[b.feature]) {
        const f = (ai.features[b.feature] ??= {});
        if (typeof b.enabled === "boolean") f.enabled = b.enabled;
        if (b.model) f.model = b.model;
        if (typeof b.dailyBudgetUSD === "number")
          f.dailyBudgetUSD = Math.max(0, b.dailyBudgetUSD);
      }
    });
    return buildConfigView();
  });

  // Admin "Test" button — one round-trip through the choke point.
  app.post("/ai/test", async (_req, reply) => {
    const res = await aiComplete({
      feature: "blurb",
      prompt: "Reply with exactly: ok",
    });
    if (!res) return reply.code(502).send({ error: "AI call failed or disabled" });
    return res;
  });

  // M13: prompt enhancer (sonnet). Rewrites a rough prompt without inventing
  // scope. When projectId is present, prefixes one line of project context.
  app.post<{ Body: { prompt: string; projectId?: string } }>(
    "/ai/enhance",
    async (req, reply) => {
      const raw = (req.body.prompt ?? "").trim();
      if (!raw) return reply.code(400).send({ error: "empty prompt" });
      const system =
        "You rewrite rough prompts into clear instructions for a coding agent. " +
        "Preserve the author's intent exactly — do not invent requirements or " +
        "expand scope. Add structure only where it helps: goal, key " +
        "constraints, acceptance criteria if clearly implied. Match the " +
        "original's language. Output ONLY the rewritten prompt text.";
      let prompt = raw;
      if (req.body.projectId) {
        const p = projectRegistry.getById(req.body.projectId);
        if (p) prompt = `Project: ${p.name} (${p.path})\n\n${raw}`;
      }
      const res = await aiComplete({
        feature: "promptEnhancer",
        system,
        prompt,
        maxTokens: 1500,
      });
      if (!res) return reply.code(502).send({ error: "enhance failed or off" });
      return { prompt: res.text.trim() };
    },
  );
}
