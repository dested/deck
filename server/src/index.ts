import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fs from "node:fs";
import path from "node:path";
import type { WebSocket } from "ws";
import { config } from "./config.js";
import { loadState, flushState } from "./state.js";
import { eventHub } from "./ws/events.js";
import type { WsServerMsg } from "@deck/shared";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerCostRoutes } from "./routes/cost.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerDigestRoutes } from "./routes/digest.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerRunbookRoutes } from "./routes/runbook.js";
import { registerStackRoutes } from "./routes/stack.js";
import { registerTermRoutes } from "./ws/term.js";
import { startServices, stopServices } from "./services.js";
import { ptyManager } from "./pty/manager.js";
import { saveAllScrollback } from "./pty/scrollback.js";
import { installCrashGuard, logCrash } from "./lib/crashGuard.js";

// Last-ditch durability before ANY exit path (fatal escalation included):
// persist state + every live terminal's screen so a restart can restore tabs.
function persistEverything() {
  try {
    saveAllScrollback();
  } catch {
    /* best-effort */
  }
  flushState();
}

async function main() {
  // First thing, before anything can throw: uncaught exceptions / unhandled
  // rejections are logged to ~/.deck/crash.log and survived, never fatal —
  // except a tight uncaught-exception loop, which flushes and exits(1) so the
  // supervisor (server/scripts/supervise.mjs) restarts us clean.
  installCrashGuard(persistEverything);

  loadState();

  const app = Fastify({
    logger: { level: config.isDev ? "warn" : "info" },
  });

  await app.register(fastifyWebsocket, {
    options: { maxPayload: 32 * 1024 * 1024 },
  });

  // ----- WebSocket: /ws/events (JSON pub-sub) -----
  app.get("/ws/events", { websocket: true }, (socket) => {
    const ws = socket as unknown as WebSocket;
    const client = eventHub.add(ws);
    ws.on("message", (raw: Buffer) => {
      const text = raw.toString("utf8");
      // Echo test hook (M0): {op:"echo"} bounces straight back.
      try {
        const parsed = JSON.parse(text) as { op?: string; data?: unknown };
        if (parsed.op === "echo") {
          const msg: WsServerMsg = { t: "echo", data: parsed.data };
          ws.send(JSON.stringify(msg));
          return;
        }
      } catch {
        /* fall through */
      }
      eventHub.handleMessage(client, text);
    });
    ws.on("close", () => eventHub.remove(client));
    ws.on("error", () => eventHub.remove(client));
  });

  // ----- Terminal WS bridge -----
  await registerTermRoutes(app);

  // ----- REST API -----
  await app.register(
    async (api) => {
      api.get("/config", async () => ({
        root: config.root,
        roots: config.roots,
        port: config.port,
        claudeBin: ptyManager.getClaudeBin(),
        defaultShell: config.defaultShell,
      }));
      api.get("/health", async () => ({ ok: true, time: Date.now() }));

      await registerProjectRoutes(api);
      await registerGitRoutes(api);
      await registerSessionRoutes(api);
      await registerFileRoutes(api);
      await registerCostRoutes(api);
      await registerAiRoutes(api);
      await registerRecipeRoutes(api);
      await registerReviewRoutes(api);
      await registerSearchRoutes(api);
      await registerDigestRoutes(api);
      await registerTaskRoutes(api);
      await registerSystemRoutes(api);
      await registerRunbookRoutes(api);
      await registerStackRoutes(api);
    },
    { prefix: "/api" },
  );

  // ----- Background services (scanner + watchers) -----
  await startServices();

  // ----- Static frontend (prod only) -----
  const webDist = path.join(config.repoRoot, "web", "dist");
  if (!config.isDev && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    const indexHtml = () => fs.readFileSync(path.join(webDist, "index.html"));
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.type("text/html").send(indexHtml());
    });
  }

  const closeGracefully = async (signal: string) => {
    console.log(`\n[deck] ${signal} — shutting down`);
    persistEverything(); // scrollback BEFORE disposeAll kills the rings
    stopServices();
    ptyManager.disposeAll();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void closeGracefully("SIGINT"));
  process.on("SIGTERM", () => void closeGracefully("SIGTERM"));
  // Whatever still manages to end the process, flush state synchronously.
  process.on("exit", () => flushState());

  await app.listen({ host: "127.0.0.1", port: config.port });
  const mode = config.isDev ? "dev (vite proxy on 12346)" : "prod";
  console.log(
    `\n  ▐ Deck server on http://127.0.0.1:${config.port}  [${mode}]\n`,
  );
}

main().catch((err) => {
  logCrash("fatal boot error", err);
  process.exit(1);
});
