import type { AiFeatureId, AiBackend, AiResult } from "@deck/shared";

// Server-only request/result helpers. The wire types (AiResult, etc.) live in
// `@deck/shared`.
export interface AiRequest {
  feature: AiFeatureId;
  prompt: string;
  system?: string; // api backend: system param; cli: prepended to prompt
  maxTokens?: number; // default 1024
  timeoutMs?: number; // default 60_000; cli first-run may be slow
  cwd?: string; // cli backend only — when claude needs repo access
  json?: boolean; // caller wants JSON back; adds discipline + loose-parse
}

export type { AiBackend, AiResult };
