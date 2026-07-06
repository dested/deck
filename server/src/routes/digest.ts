import type { FastifyInstance } from "fastify";
import {
  generateDigest,
  listDigests,
  readDigest,
} from "../digest/service.js";

// M14: digest routes.
export async function registerDigestRoutes(app: FastifyInstance) {
  app.post<{
    Body: { range: "today" | "yesterday" | { hours: number } };
  }>("/digest", async (req) => {
    const now = Date.now();
    const range = req.body?.range ?? "today";
    let fromMs: number;
    let toMs = now;
    if (range === "today") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      fromMs = d.getTime();
    } else if (range === "yesterday") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      toMs = start.getTime();
      fromMs = toMs - 24 * 60 * 60 * 1000;
    } else {
      const hours = Math.max(1, Math.min(168, range.hours || 24));
      fromMs = now - hours * 60 * 60 * 1000;
    }
    return generateDigest(fromMs, toMs);
  });

  app.get("/digests", async () => listDigests());

  app.get<{ Params: { name: string } }>("/digests/:name", async (req, reply) => {
    const markdown = readDigest(req.params.name);
    if (markdown == null) return reply.code(404).send({ error: "not found" });
    return { markdown };
  });
}
