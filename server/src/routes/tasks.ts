import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { TaskStatus } from "@deck/shared";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  clearDone,
  generateTaskPrompt,
  addTaskImage,
  removeTaskImage,
  getTaskImage,
} from "../tasks/service.js";

// M17v2: personal task-board routes. Cards are pushed live via `tasks.updated`
// / `tasks.removed`. Nothing here can start a session.
export async function registerTaskRoutes(app: FastifyInstance) {
  app.get("/tasks", async () => listTasks());

  app.post<{
    Body: {
      title: string;
      body?: string;
      projectId?: string | null;
      status?: TaskStatus; // inbox/next/now — the composer can aim a capture
    };
  }>("/tasks", async (req, reply) => {
    if (!req.body.title?.trim())
      return reply.code(400).send({ error: "title required" });
    return createTask(req.body);
  });

  // Registered before /tasks/:id so "clear-done" isn't captured as an :id.
  app.post("/tasks/clear-done", async () => ({ cleared: clearDone() }));

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      body?: string;
      projectId?: string | null;
      prompt?: string | null;
      order?: number;
      status?: TaskStatus;
    };
  }>("/tasks/:id", async (req, reply) => {
    const updated = updateTask(req.params.id, req.body);
    if (!updated) return reply.code(404).send({ error: "task not found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", async (req, reply) => {
    if (!deleteTask(req.params.id))
      return reply.code(404).send({ error: "task not found" });
    return reply.code(204).send();
  });

  // ----- attached images -----

  // Upload: JSON { data: dataURL, name?, w?, h? }. The base64 envelope needs a
  // bigger body limit than fastify's 1MB default (15MB image ≈ 20MB base64).
  app.post<{
    Params: { id: string };
    Body: { data: string; name?: string; w?: number; h?: number };
  }>(
    "/tasks/:id/images",
    { bodyLimit: 24 * 1024 * 1024 },
    async (req, reply) => {
      try {
        return addTaskImage(req.params.id, req.body);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string; imageId: string } }>(
    "/tasks/:id/images/:imageId",
    async (req, reply) => {
      const hit = getTaskImage(req.params.id, req.params.imageId);
      if (!hit) return reply.code(404).send({ error: "image not found" });
      let buf: Buffer;
      try {
        buf = fs.readFileSync(hit.file);
      } catch {
        return reply.code(404).send({ error: "image file missing" });
      }
      return reply
        .type(hit.img.ext === "jpg" ? "image/jpeg" : `image/${hit.img.ext}`)
        // content is immutable for a given image id — cache hard
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(buf);
    },
  );

  app.delete<{ Params: { id: string; imageId: string } }>(
    "/tasks/:id/images/:imageId",
    async (req, reply) => {
      const updated = removeTaskImage(req.params.id, req.params.imageId);
      if (!updated) return reply.code(404).send({ error: "image not found" });
      return updated;
    },
  );

  // Draft a Claude Code prompt from the card + the project's cliffnotes and
  // save it on the card. 503 = AI disabled/over budget (feature `taskPrompt`).
  app.post<{ Params: { id: string } }>(
    "/tasks/:id/generate-prompt",
    async (req, reply) => {
      try {
        const t = await generateTaskPrompt(req.params.id);
        if (!t)
          return reply
            .code(503)
            .send({ error: "AI unavailable (disabled or over budget)" });
        return t;
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
