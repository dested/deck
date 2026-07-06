import type { FastifyInstance } from "fastify";
import type { Session } from "@deck/shared";
import { searchIndexer } from "../search/indexer.js";
import { transcriptRegistry } from "../transcripts/registry.js";

// M9: transcript search routes. FTS query terms are quoted server-side; raw user
// input never reaches fts5 syntax.
export async function registerSearchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; projectId?: string; limit?: string } }>(
    "/search",
    async (req) => {
      const q = req.query.q ?? "";
      const limit = req.query.limit ? Number(req.query.limit) : 30;
      return searchIndexer.search(q, req.query.projectId || undefined, limit);
    },
  );

  app.get<{ Querystring: { q?: string; projectId?: string } }>(
    "/search/sessions",
    async (req) => {
      const rows = searchIndexer.searchSessions(
        req.query.q ?? "",
        req.query.projectId || undefined,
      );
      const out: Session[] = [];
      for (const r of rows) {
        const s = transcriptRegistry.sessionForTranscript(r.sessionId);
        if (s) out.push(s);
      }
      return out;
    },
  );
}
