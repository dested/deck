import type { FastifyInstance } from "fastify";
import { projectRegistry } from "../projects/registry.js";
import { eventHub, topics } from "../ws/events.js";
import * as git from "../git/service.js";

export async function registerGitRoutes(app: FastifyInstance) {
  // Resolve the repo path for :id or 404.
  const repo = (id: string) => projectRegistry.getPath(id);

  const notify = (id: string) => {
    eventHub.publish([topics.git(id)], { t: "git.updated", projectId: id });
    void projectRegistry.refreshGit(id);
  };

  app.get<{ Params: { id: string } }>(
    "/projects/:id/git/status",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        return await git.getStatus(cwd);
      } catch (err) {
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { path: string; staged?: string; context?: string };
  }>("/projects/:id/git/diff", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    const staged = req.query.staged === "true";
    const context = req.query.context ? Number(req.query.context) : 3;
    return git.getDiff(cwd, req.query.path, staged, context);
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/projects/:id/git/file-at-head",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      return git.getFileAtHead(cwd, req.query.path);
    },
  );

  app.post<{ Params: { id: string }; Body: { paths: string[] } }>(
    "/projects/:id/git/stage",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      await git.stage(cwd, req.body.paths);
      notify(req.params.id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { paths: string[] } }>(
    "/projects/:id/git/unstage",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      await git.unstage(cwd, req.body.paths);
      notify(req.params.id);
      return { ok: true };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { path: string; hunkHeader: string; patch: string };
  }>("/projects/:id/git/stage-hunk", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    const res = await git.applyHunk(cwd, req.body.patch, false);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    notify(req.params.id);
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { path: string; hunkHeader: string; patch: string };
  }>("/projects/:id/git/unstage-hunk", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    const res = await git.applyHunk(cwd, req.body.patch, true);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    notify(req.params.id);
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { path: string; hunkHeader: string; patch: string };
  }>("/projects/:id/git/discard-hunk", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    const res = await git.discardHunk(cwd, req.body.patch);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    notify(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { paths: string[] } }>(
    "/projects/:id/git/discard",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      await git.discard(cwd, req.body.paths);
      notify(req.params.id);
      return { ok: true };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { message: string; amend?: boolean };
  }>("/projects/:id/git/commit", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    try {
      const res = await git.commit(cwd, req.body.message, req.body.amend ?? false);
      notify(req.params.id);
      return res;
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/projects/:id/git/push",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        const res = await git.push(cwd);
        notify(req.params.id);
        return res;
      } catch (err) {
        return reply.code(400).send({ error: String(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/projects/:id/git/log",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      return git.log(cwd, req.query.limit ? Number(req.query.limit) : 50);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { hash: string } }>(
    "/projects/:id/git/show",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      return git.show(cwd, req.query.hash);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { hash: string; path: string };
  }>("/projects/:id/git/show-file", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    return git.showFileDiff(cwd, req.query.hash, req.query.path);
  });
}
