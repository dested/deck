import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import type { ProjectDetail } from "@deck/shared";
import { projectRegistry } from "../projects/registry.js";
import { updateState } from "../state.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => projectRegistry.getAll());

  app.get<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    const p = projectRegistry.getById(req.params.id);
    if (!p) return reply.code(404).send({ error: "project not found" });
    // Trigger a git refresh on open (also happens via repo watcher subscribe).
    void projectRegistry.refreshGit(p.id);
    const detail: ProjectDetail = { ...p, hasGit: true };
    return detail;
  });

  app.post<{ Params: { id: string }; Body: { pinned: boolean } }>(
    "/projects/:id/pin",
    async (req, reply) => {
      const { id } = req.params;
      if (!projectRegistry.getById(id))
        return reply.code(404).send({ error: "not found" });
      updateState((s) => {
        const set = new Set(s.pinnedProjects);
        if (req.body.pinned) set.add(id);
        else set.delete(id);
        s.pinnedProjects = [...set];
      });
      projectRegistry.republish(id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { hidden: boolean } }>(
    "/projects/:id/hide",
    async (req, reply) => {
      const { id } = req.params;
      if (!projectRegistry.getById(id))
        return reply.code(404).send({ error: "not found" });
      updateState((s) => {
        const set = new Set(s.hiddenProjects);
        if (req.body.hidden) set.add(id);
        else set.delete(id);
        s.hiddenProjects = [...set];
      });
      projectRegistry.republish(id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/reveal",
    async (req, reply) => {
      const p = projectRegistry.getById(req.params.id);
      if (!p) return reply.code(404).send({ error: "not found" });
      execFile("explorer.exe", [p.path], () => {
        /* explorer returns non-zero even on success; ignore */
      });
      return { ok: true };
    },
  );
}
