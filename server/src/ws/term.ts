import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ptyManager } from "../pty/manager.js";
import type { WsTermClientMsg } from "@deck/shared";

// Raw PTY bridge (§3.2). Server->client: binary frames = PTY bytes; text frames
// = small JSON control ({op:"ready"|"exit"}). Client->client: JSON input/resize.
export async function registerTermRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/ws/term/:id",
    { websocket: true },
    (socket, req) => {
      const ws = socket as unknown as WebSocket;
      const id = req.params.id;
      const rec = ptyManager.get(id);

      if (!rec) {
        ws.send(JSON.stringify({ op: "exit", code: null }));
        ws.close();
        return;
      }

      // --- Reattach: snapshot then attach, all synchronous (no interleave) ---
      const snap = ptyManager.reattachSnapshot(id);
      if (snap) {
        const restore = snap.serialized || snap.raw;
        if (restore) ws.send(Buffer.from(restore, "utf8"));
      }
      ws.send(JSON.stringify({ op: "ready" }));

      const unsubData = ptyManager.onData(id, (data) => {
        if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, "utf8"));
      });
      const unsubExit = ptyManager.onExit(id, (code) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ op: "exit", code }));
        }
      });

      ws.on("message", (raw: Buffer) => {
        let msg: WsTermClientMsg;
        try {
          msg = JSON.parse(raw.toString("utf8")) as WsTermClientMsg;
        } catch {
          return;
        }
        if (msg.op === "input") {
          ptyManager.write(id, msg.data);
        } else if (msg.op === "resize") {
          ptyManager.resize(id, msg.cols, msg.rows);
        }
      });

      const cleanup = () => {
        unsubData();
        unsubExit();
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    },
  );
}
