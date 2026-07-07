import type { AiFeatureId } from "@deck/shared";

// Feature registry: per-feature model + budget defaults. User mandate — default
// Deck-internal AI to HAIKU for high-frequency features, SONNET for
// quality-sensitive ones. Never opus by default (cost). Model IDs are exact
// strings (no date suffixes).
export const AI_FEATURES: Record<
  AiFeatureId,
  {
    label: string;
    defaultModel: string;
    defaultEnabled: boolean;
    dailyBudgetUSD: number;
  }
> = {
  blurb: {
    label: "Library blurbs",
    defaultModel: "claude-haiku-4-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.25,
  },
  tabTitle: {
    label: "Tab titles + summaries",
    defaultModel: "claude-haiku-4-5",
    defaultEnabled: true,
    dailyBudgetUSD: 1.0,
  },
  liveSummary: {
    label: "Session summaries",
    defaultModel: "claude-haiku-4-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.5,
  },
  reviewSummary: {
    label: "Review summaries",
    defaultModel: "claude-haiku-4-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.25,
  },
  commitMessage: {
    label: "Commit messages",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.5,
  },
  promptEnhancer: {
    label: "Prompt enhancer",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.5,
  },
  digest: {
    label: "Digests",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 1.0,
  },
  runbook: {
    label: "Runbook generation",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.25,
  },
  dbQuery: {
    label: "AI database queries",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.5,
  },
  taskPrompt: {
    label: "Task prompt drafts",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 0.5,
  },
  prAudit: {
    label: "PR audits",
    defaultModel: "claude-sonnet-5",
    defaultEnabled: true,
    dailyBudgetUSD: 1.5,
  },
};

export const GLOBAL_DAILY_BUDGET_USD_DEFAULT = 3.0;

// Only these models may be selected from the admin UI / PATCH /ai/config.
export const ALLOWED_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
] as const;

export const AI_FEATURE_IDS = Object.keys(AI_FEATURES) as AiFeatureId[];
