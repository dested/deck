import type { FastifyInstance } from "fastify";
import { projectRegistry } from "../projects/registry.js";
import { readFileContent, writeFileContent } from "../files/io.js";
import { listTree } from "../files/tree.js";

export async function registerFileRoutes(app: FastifyInstance) {
  const repo = (id: string) => projectRegistry.getPath(id);

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/projects/:id/tree",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        return await listTree(cwd, req.query.path ?? "");
      } catch (err) {
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/projects/:id/file",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        return readFileContent(cwd, req.query.path);
      } catch (err) {
        return reply.code(404).send({ error: String(err) });
      }
    },
  );

  app.put<{
    Params: { id: string };
    Querystring: { path: string };
    Body: { content: string };
  }>("/projects/:id/file", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    try {
      writeFileContent(cwd, req.query.path, req.body.content);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });
}
