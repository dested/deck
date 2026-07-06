import type { FastifyInstance } from "fastify";
import { systemOverview, killProcess } from "../system/service.js";

// M19 — system suite: ports + dev processes + kill.
export async function registerSystemRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { force?: string } }>(
    "/system/overview",
    async (req) => systemOverview(req.query.force === "1"),
  );

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
