import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Recipe } from "@deck/shared";
import { getState, updateState } from "../state.js";

// M13: prompt recipes — pure CRUD (no AI). Single client, so no broadcast;
// clients refetch on mutate via react-query invalidation.
export async function registerRecipeRoutes(app: FastifyInstance) {
  app.get("/recipes", async () => getState().recipes);

  app.post<{ Body: { name: string; body: string; tags?: string[] } }>(
    "/recipes",
    async (req) => {
      const recipe: Recipe = {
        id: randomUUID(),
        name: req.body.name?.trim() || "Untitled recipe",
        body: req.body.body ?? "",
        tags: Array.isArray(req.body.tags) ? req.body.tags : [],
        createdAt: Date.now(),
        lastUsedAt: null,
        useCount: 0,
      };
      updateState((s) => {
        s.recipes.push(recipe);
      });
      return recipe;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; body?: string; tags?: string[] };
  }>("/recipes/:id", async (req, reply) => {
    let updated: Recipe | undefined;
    updateState((s) => {
      const r = s.recipes.find((x) => x.id === req.params.id);
      if (r) {
        if (typeof req.body.name === "string") r.name = req.body.name.trim() || r.name;
        if (typeof req.body.body === "string") r.body = req.body.body;
        if (Array.isArray(req.body.tags)) r.tags = req.body.tags;
        updated = r;
      }
    });
    if (!updated) return reply.code(404).send({ error: "recipe not found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/recipes/:id", async (req, reply) => {
    updateState((s) => {
      s.recipes = s.recipes.filter((r) => r.id !== req.params.id);
    });
    return reply.code(204).send();
  });

  // Bump usage counters (recipe launched/inserted).
  app.post<{ Params: { id: string } }>("/recipes/:id/used", async (req) => {
    updateState((s) => {
      const r = s.recipes.find((x) => x.id === req.params.id);
      if (r) {
        r.useCount += 1;
        r.lastUsedAt = Date.now();
      }
    });
    return { ok: true };
  });
}
