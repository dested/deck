import type { FastifyInstance } from "fastify";
import type { AutopilotConfig } from "@deck/shared";
import { getState, updateState } from "../state.js";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  startTask,
} from "../tasks/service.js";

// M17: task board routes. Cards are also pushed live via `tasks.updated`.
export async function registerTaskRoutes(app: FastifyInstance) {
  app.get("/tasks", async () => listTasks());

  app.post<{
    Body: { title: string; body?: string; projectId: string; recipeId?: string | null };
  }>("/tasks", async (req, reply) => {
    if (!req.body.projectId) return reply.code(400).send({ error: "projectId required" });
    return createTask(req.body);
  });

  // Autopilot toggle — registered before /tasks/:id so "autopilot" isn't
  // captured as an :id.
  app.post<{ Body: Partial<AutopilotConfig> }>(
    "/tasks/autopilot",
    async (req) => {
      updateState((s) => {
        if (typeof req.body.enabled === "boolean")
          s.autopilot.enabled = req.body.enabled;
        if (typeof req.body.maxRunning === "number")
          s.autopilot.maxRunning = Math.max(1, Math.min(8, req.body.maxRunning));
      });
      return getState().autopilot;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      body?: string;
      projectId?: string;
      order?: number;
      status?: "backlog" | "queued" | "done" | "linked";
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

  app.post<{ Params: { id: string } }>("/tasks/:id/start", async (req, reply) => {
    try {
      const t = startTask(req.params.id);
      if (!t) return reply.code(404).send({ error: "task not found" });
      return t;
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });
}
