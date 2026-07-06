import type { FastifyInstance } from "fastify";
import { getCostReport } from "../cost/service.js";
import { getState, updateState } from "../state.js";

export async function registerCostRoutes(app: FastifyInstance) {
  // Served from a 60s background cache; ?force=1 refreshes synchronously.
  app.get<{ Querystring: { force?: string } }>("/cost", async (req) => {
    return getCostReport(req.query.force === "1");
  });

  // M15: spend budgets (monthly + per active-block). null clears a budget.
  app.patch<{
    Body: { monthlyUSD?: number | null; blockUSD?: number | null };
  }>("/cost/budgets", async (req) => {
    updateState((s) => {
      if ("monthlyUSD" in req.body)
        s.budgets.monthlyUSD =
          req.body.monthlyUSD == null ? null : Math.max(0, req.body.monthlyUSD);
      if ("blockUSD" in req.body)
        s.budgets.blockUSD =
          req.body.blockUSD == null ? null : Math.max(0, req.body.blockUSD);
    });
    return getState().budgets;
  });
}
