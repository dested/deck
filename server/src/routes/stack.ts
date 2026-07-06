import type { FastifyInstance } from "fastify";
import { projectRegistry, ROOT_PROJECT_ID } from "../projects/registry.js";
import {
  stackReport,
  revealEnvVar,
  setEnvVar,
  connectionString,
} from "../env/service.js";
import { dbOverview, runReadOnlyQuery, aiQuery } from "../db/service.js";
import { studioManager } from "../db/studio.js";

// M20 — stack intelligence (env + database + Prisma Studio). Root pseudo-
// project has no repo → 404s, same policy as git/files/runbook.
export async function registerStackRoutes(app: FastifyInstance) {
  const resolve = (id: string) => {
    if (id === ROOT_PROJECT_ID) return null;
    return projectRegistry.getById(id) ?? null;
  };

  app.get<{ Params: { id: string } }>(
    "/projects/:id/stack",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return stackReport(p.id, p.path);
    },
  );

  // Reveal one env value (Deck is localhost-only; values still never ride the
  // batch report so they don't sit in normal API traffic / react-query caches).
  app.get<{ Params: { id: string }; Querystring: { file: string; key: string } }>(
    "/projects/:id/env/reveal",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const { file, key } = req.query;
      if (!file || !key) return reply.code(400).send({ error: "file+key required" });
      const value = revealEnvVar(p.path, file, key);
      if (value == null) return reply.code(404).send({ error: "var not found" });
      return { value };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { file: string; key: string; value: string };
  }>("/projects/:id/env", async (req, reply) => {
    const p = resolve(req.params.id);
    if (!p) return reply.code(404).send({ error: "project not found" });
    const { file, key, value } = req.body ?? {};
    if (!file || !key || typeof value !== "string") {
      return reply.code(400).send({ error: "file, key, value required" });
    }
    const res = setEnvVar(p.id, p.path, file, key, value);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    return res;
  });

  // ----- database -----

  const dbUrl = (id: string) => {
    const p = resolve(id);
    if (!p) return { p: null, url: null };
    return { p, url: connectionString(p.id, p.path) };
  };

  app.get<{ Params: { id: string } }>(
    "/projects/:id/db/overview",
    async (req, reply) => {
      const { p, url } = dbUrl(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      if (!url)
        return reply.code(400).send({ error: "no DATABASE_URL detected" });
      return dbOverview(url);
    },
  );

  app.post<{ Params: { id: string }; Body: { sql: string } }>(
    "/projects/:id/db/query",
    async (req, reply) => {
      const { p, url } = dbUrl(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      if (!url)
        return reply.code(400).send({ error: "no DATABASE_URL detected" });
      const res = await runReadOnlyQuery(url, req.body?.sql ?? "");
      if ("error" in res) return reply.code(400).send({ error: res.error });
      return res;
    },
  );

  app.post<{ Params: { id: string }; Body: { question: string } }>(
    "/projects/:id/db/ai-query",
    async (req, reply) => {
      const { p, url } = dbUrl(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      if (!url)
        return reply.code(400).send({ error: "no DATABASE_URL detected" });
      const q = (req.body?.question ?? "").trim();
      if (!q) return reply.code(400).send({ error: "question required" });
      const res = await aiQuery(url, q);
      if ("error" in res) return reply.code(400).send({ error: res.error });
      return res;
    },
  );

  // ----- Prisma Studio -----

  app.get<{ Params: { id: string } }>(
    "/projects/:id/db/studio",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return studioManager.status(p.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/db/studio/start",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const schema = stackReport(p.id, p.path).prismaSchemaPath;
      if (!schema)
        return reply.code(400).send({ error: "no schema.prisma in this project" });
      return studioManager.start(p.id, p.path, schema);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/db/studio/stop",
    async (req, reply) => {
      const p = resolve(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return studioManager.stop(p.id);
    },
  );
}
