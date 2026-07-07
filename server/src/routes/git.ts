import type { FastifyInstance } from "fastify";
import { projectRegistry, ROOT_PROJECT_ID } from "../projects/registry.js";
import { eventHub, topics } from "../ws/events.js";
import * as git from "../git/service.js";
import * as audit from "../git/audit.js";
import { aiComplete } from "../ai/client.js";

// M13: per-style system prompts for AI commit-message generation.
const COMMIT_SYSTEMS: Record<string, string> = {
  terse:
    "Output a single-line commit subject, ≤60 chars, imperative, matching the " +
    "style of the recent subjects provided. No body, no quotes.",
  conventional:
    "Output a Conventional Commits message: `type(scope): subject` ≤72 chars, " +
    "then a blank line and a 1–3 bullet body only if the change is non-trivial.",
  verbose:
    "Output a commit subject ≤72 chars, a blank line, then a bullet-point body " +
    "describing each meaningful change (what + why), one bullet per concern.",
};

export async function registerGitRoutes(app: FastifyInstance) {
  // Resolve the repo path for :id, or undefined (404). The root pseudo-project
  // (M10) has no git — treated as not-found here so its Git tab is never wired.
  const repo = (id: string) =>
    id === ROOT_PROJECT_ID ? undefined : projectRegistry.getPath(id);

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

  // M13: AI commit-message generation (sonnet).
  app.post<{
    Params: { id: string };
    Body: { style: "terse" | "conventional" | "verbose" };
  }>("/projects/:id/git/commit-message", async (req, reply) => {
    const cwd = repo(req.params.id);
    if (!cwd) return reply.code(404).send({ error: "project not found" });
    const style = req.body.style ?? "terse";
    const system = COMMIT_SYSTEMS[style] ?? COMMIT_SYSTEMS.terse;
    const ctx = await git.diffForAi(cwd);
    if (ctx.empty) {
      return reply.code(400).send({ error: "nothing staged or changed" });
    }
    const prompt =
      `Recent commit subjects (match this style):\n${ctx.recentSubjects}\n\n` +
      `Status:\n${ctx.summary}\n\nDiff:\n${ctx.diff}`;
    const res = await aiComplete({
      feature: "commitMessage",
      system,
      prompt,
      maxTokens: 700,
    });
    if (!res) return reply.code(502).send({ error: "generation failed or off" });
    return { message: res.text.trim() };
  });

  // PR audit: cached report + staleness (cheap-ish — recomputes the diff sig).
  app.get<{ Params: { id: string } }>(
    "/projects/:id/git/audit",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        return await audit.getAuditState(req.params.id, cwd);
      } catch (err) {
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  // PR audit: run a fresh one (always regenerates — the client gates on stale).
  app.post<{ Params: { id: string } }>(
    "/projects/:id/git/audit",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        const report = await audit.runAudit(req.params.id, cwd);
        if (!report) {
          return reply
            .code(503)
            .send({ error: "AI off, over budget, or an audit is already running" });
        }
        return report;
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // PR audit: ask a question about the pending change.
  app.post<{ Params: { id: string }; Body: { question: string } }>(
    "/projects/:id/git/audit/ask",
    async (req, reply) => {
      const cwd = repo(req.params.id);
      if (!cwd) return reply.code(404).send({ error: "project not found" });
      try {
        const answer = await audit.askAudit(
          req.params.id,
          cwd,
          req.body.question ?? "",
        );
        if (!answer) {
          return reply
            .code(503)
            .send({ error: "AI off, over budget, or an audit call is in flight" });
        }
        return { answer };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
