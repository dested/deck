import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type {
  ProjectDetail,
  ProjectInspection,
  Group,
} from "@deck/shared";
import { projectRegistry, ROOT_PROJECT_ID } from "../projects/registry.js";
import { inspectProject } from "../projects/inspector.js";
import { portWatcher } from "../projects/ports.js";
import { screenshotService } from "../projects/screenshots.js";
import { aiComplete } from "../ai/client.js";
import { getState, updateState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { config } from "../config.js";

// Broadcast the full project-group list on any group mutation. Clients keep a
// small store of groups; project->group assignment rides on the project summary.
function publishProjectGroups() {
  eventHub.publish([topics.projects], {
    t: "project-groups.updated",
    payload: getState().projectGroups,
  });
}

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => projectRegistry.getAll());

  // ----- Library enrichment (inspection / live ports / screenshots) -----

  // Batch: one request enriches every card. Pure fs reads, mtime-cached.
  app.get("/projects/inspections", async () => {
    const out: Record<string, ProjectInspection> = {};
    for (const p of projectRegistry.getAll()) {
      out[p.id] = inspectProject(p.id, p.path);
    }
    return out;
  });

  app.get("/projects/live-ports", async () => portWatcher.getLive());

  // projectId -> shot mtime, for cache-busting <img> URLs on boot.
  app.get("/projects/screenshots", async () =>
    screenshotService.allShotTimes(),
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/inspect",
    async (req, reply) => {
      const p = projectRegistry.getById(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      return inspectProject(p.id, p.path);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/screenshot",
    async (req, reply) => {
      const file = screenshotService.shotPath(req.params.id);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(file);
      } catch {
        return reply.code(404).send({ error: "no screenshot" });
      }
      return reply
        .type("image/png")
        .header("cache-control", "no-cache")
        .send(buf);
    },
  );

  // Manual 📸 recapture. Uses the live port if known, else a supplied/static one.
  app.post<{ Params: { id: string }; Body: { port?: number } }>(
    "/projects/:id/screenshot",
    async (req, reply) => {
      const p = projectRegistry.getById(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const port =
        req.body?.port ??
        portWatcher.getLive()[p.id]?.[0] ??
        inspectProject(p.id, p.path).staticPorts[0];
      if (!port)
        return reply
          .code(400)
          .send({ error: "no known port — is the dev server running?" });
      screenshotService.forceCapture(p.id, port);
      return { ok: true, port };
    },
  );

  // ✨ AI blurb: one-shot repo summary via the M7 choke point (cost-tracked; the
  // client dismisses the transcript so no ghost agent card is left behind).
  app.post<{ Params: { id: string } }>(
    "/projects/:id/blurb",
    async (req, reply) => {
      const p = projectRegistry.getById(req.params.id);
      if (!p) return reply.code(404).send({ error: "project not found" });
      const prompt =
        "Skim this repository (README, package.json, a key source file or two) " +
        "and describe what it is in ONE sentence of at most 140 characters. " +
        "Output only that sentence — no preamble, no quotes.";
      const res = await aiComplete({
        feature: "blurb",
        prompt,
        cwd: p.path,
        timeoutMs: 180_000,
      });
      const text = res?.text
        ? res.text.split(/\r?\n/).filter(Boolean).pop()?.trim() || null
        : null;
      if (!text)
        return reply.code(502).send({ error: "claude summary failed" });
      updateState((s) => {
        s.projectBlurbs[p.id] = { text, at: Date.now() };
      });
      return inspectProject(p.id, p.path);
    },
  );

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
      if (id === ROOT_PROJECT_ID)
        return reply.code(400).send({ error: "root project cannot be pinned" });
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
      if (id === ROOT_PROJECT_ID)
        return reply.code(400).send({ error: "root project cannot be hidden" });
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

  app.post<{ Params: { id: string } }>(
    "/projects/:id/webstorm",
    async (req, reply) => {
      const p = projectRegistry.getById(req.params.id);
      if (!p) return reply.code(404).send({ error: "not found" });
      // A configured absolute exe is launched directly; otherwise resolve the
      // JetBrains Toolbox `webstorm` shim from PATH via cmd.
      const [cmd, args] = config.webstormBin
        ? [config.webstormBin, [p.path]]
        : ["cmd", ["/c", "webstorm", p.path]];
      execFile(cmd, args, (err) => {
        if (err) console.warn("[webstorm] launch failed:", err.message);
      });
      return { ok: true };
    },
  );

  // ----- Project groups (sidebar) -----
  app.get("/project-groups", async () => getState().projectGroups);

  app.post<{ Body: { name: string } }>("/project-groups", async (req) => {
    const group: Group = {
      id: randomUUID(),
      name: req.body.name?.trim() || "New group",
      collapsed: false,
    };
    updateState((s) => {
      s.projectGroups.push(group);
    });
    publishProjectGroups();
    return group;
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; collapsed?: boolean };
  }>("/project-groups/:id", async (req, reply) => {
    let updated: Group | undefined;
    updateState((s) => {
      const g = s.projectGroups.find((x) => x.id === req.params.id);
      if (g) {
        if (typeof req.body.name === "string") g.name = req.body.name.trim() || g.name;
        if (typeof req.body.collapsed === "boolean") g.collapsed = req.body.collapsed;
        updated = g;
      }
    });
    if (!updated) return reply.code(404).send({ error: "group not found" });
    publishProjectGroups();
    return updated;
  });

  app.delete<{ Params: { id: string } }>(
    "/project-groups/:id",
    async (req, reply) => {
      const affected: string[] = [];
      updateState((s) => {
        s.projectGroups = s.projectGroups.filter((g) => g.id !== req.params.id);
        for (const [pid, gid] of Object.entries(s.projectGroupOf)) {
          if (gid === req.params.id) {
            delete s.projectGroupOf[pid];
            affected.push(pid);
          }
        }
      });
      publishProjectGroups();
      for (const pid of affected) projectRegistry.republish(pid);
      return reply.code(204).send();
    },
  );

  // Reorder groups (array order == display order).
  app.post<{ Body: { ids: string[] } }>(
    "/project-groups/reorder",
    async (req) => {
      updateState((s) => {
        const byId = new Map(s.projectGroups.map((g) => [g.id, g]));
        const next: Group[] = [];
        for (const id of req.body.ids) {
          const g = byId.get(id);
          if (g) {
            next.push(g);
            byId.delete(id);
          }
        }
        // Any groups not named in the payload keep their relative order at the end.
        for (const g of s.projectGroups) if (byId.has(g.id)) next.push(g);
        s.projectGroups = next;
      });
      publishProjectGroups();
      return { ok: true };
    },
  );

  // Assign a project to a group (id "none" -> ungroup).
  app.post<{ Params: { id: string }; Body: { projectId: string } }>(
    "/project-groups/:id/assign",
    async (req, reply) => {
      const { projectId } = req.body;
      if (!projectRegistry.getById(projectId))
        return reply.code(404).send({ error: "project not found" });
      const groupId = req.params.id === "none" ? null : req.params.id;
      updateState((s) => {
        if (groupId === null) delete s.projectGroupOf[projectId];
        else s.projectGroupOf[projectId] = groupId;
      });
      projectRegistry.republish(projectId);
      return { ok: true };
    },
  );
}
