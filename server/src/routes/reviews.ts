import type { FastifyInstance } from "fastify";
import { reviewService } from "../reviews/service.js";

// M11: review queue routes. Items are also pushed live via `reviews.updated`.
export async function registerReviewRoutes(app: FastifyInstance) {
  app.get("/reviews", async () => reviewService.active());

  app.post<{ Params: { id: string } }>(
    "/reviews/:id/dismiss",
    async (req) => {
      reviewService.dismiss(req.params.id);
      return { ok: true };
    },
  );
}
