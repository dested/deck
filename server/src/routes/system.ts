import type { FastifyInstance } from "fastify";
import { systemOverview, killProcess } from "../system/service.js";
import { restartServer, isSupervised } from "../lib/lifecycle.js";

// M19 — system suite: ports + dev processes + kill.
export async function registerSystemRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { force?: string } }>(
    "/system/overview",
    async (req) => systemOverview(req.query.force === "1"),
  );

  // Restart the backend in place (supervisor respawns it). The window stays
  // open; the client just reconnects its WS to the fresh process.
  app.post("/system/restart", async (_req, reply) => {
    if (!isSupervised())
      return reply.code(409).send({
        error:
          "server is not running under the supervisor (bun start) — restart it manually",
      });
    restartServer();
    return { ok: true };
  });

  app.post<{ Params: { pid: string } }>(
    "/system/kill/:pid",
    async (req, reply) => {
      const pid = Number(req.params.pid);
      const res = await killProcess(pid);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res;
    },
  );
}
