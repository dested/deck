import type { FastifyInstance } from "fastify";
import { projectRegistry, ROOT_PROJECT_ID } from "../projects/registry.js";
import {
  getRunbook,
  saveRunbook,
  runbookStatus,
  generateRunbook,
} from "../runbook/service.js";

// M18 — runbook (deck.run.json) endpoints. The root pseudo-project has no repo
// of its own, so all of these 404 for it (same policy as git/files).
export async function registerRunbookRoutes(app: FastifyInstance) {
  const resolve = (id: string) => {
    if (id === ROOT_PROJECT_ID) return null;
    return projectRegistry.getById(id) ?? null;
  };

  app.get<{ Params: { id: string } }>(
    "/projects/:id/runbook",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return getRunbook(p.id, p.path);
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/runbook",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const runbook = saveRunbook(p.path, req.body);
      return { runbook, hasFile: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/runbook/status",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return runbookStatus(p.id, p.path);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/runbook/generate",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const runbook = await generateRunbook(p.id, p.path);
      if (!runbook)
        return reply
          .code(502)
          .send({ error: "AI runbook generation failed (budget/parse)" });
      return { runbook, hasFile: true };
    },
  );
}
