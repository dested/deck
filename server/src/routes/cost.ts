import type { FastifyInstance } from "fastify";
import { getCostReport } from "../cost/service.js";

export async function registerCostRoutes(app: FastifyInstance) {
  // Served from a 60s background cache; ?force=1 refreshes synchronously.
  app.get<{ Querystring: { force?: string } }>("/cost", async (req) => {
    return getCostReport(req.query.force === "1");
  });
}
