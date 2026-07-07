import { execFile, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import type { StudioStatus } from "@deck/shared";
import { cleanEnv } from "../lib/cleanEnv.js";
import { probePort } from "../runbook/service.js";

// M20 — one managed Prisma Studio per project, embedded in the Stack tab via
// iframe. Spawned with `npx prisma studio --browser none` from the package dir
// that owns schema.prisma; killed as a tree so the npx wrapper dies too.

const BASE_PORT = 5555;
const START_TIMEOUT_MS = 90_000; // first npx run may download prisma

interface StudioEntry {
  child: ChildProcess;
  port: number;
  ready: boolean;
  error: string | null;
  stderrTail: string[];
}

const studios = new Map<string, StudioEntry>();

function toStatus(e: StudioEntry | undefined): StudioStatus {
  if (!e || e.child.exitCode !== null) {
    const error = e?.error ?? undefined;
    return { running: false, port: null, url: null, error };
  }
  return {
    running: e.ready,
    port: e.port,
    url: `http://localhost:${e.port}`,
    error: e.error ?? undefined,
  };
}

function freePort(start: number): Promise<number> {
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", () => {
        srv.close();
        if (port - start > 30) reject(new Error("no free port"));
        else resolve(tryPort(port + 1));
      });
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    });
  return tryPort(start);
}

export const studioManager = {
  status(projectId: string): StudioStatus {
    return toStatus(studios.get(projectId));
  },

  // Launch (or return the already-running) Studio for a project. `schemaRel`
  // is the repo-relative schema.prisma path; Studio runs from the package dir
  // that owns the `prisma/` folder so it picks up the right .env.
  async start(
    projectId: string,
    projectPath: string,
    schemaRel: string,
  ): Promise<StudioStatus> {
    const existing = studios.get(projectId);
    if (existing && existing.child.exitCode === null && existing.ready) {
      return toStatus(existing);
    }
    if (existing) studios.delete(projectId);

    // "server/prisma/schema.prisma" -> cwd <project>/server
    const parts = schemaRel.split("/");
    const pkgDir =
      parts.length > 2
        ? path.win32.join(projectPath, ...parts.slice(0, -2))
        : projectPath;

    const port = await freePort(BASE_PORT);
    const child = spawn(
      "cmd",
      ["/c", "npx", "prisma", "studio", "--port", String(port), "--browser", "none"],
      { cwd: pkgDir, env: cleanEnv(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    const entry: StudioEntry = {
      child,
      port,
      ready: false,
      error: null,
      stderrTail: [],
    };
    // 'error' (spawn failure) is an uncaught exception if unhandled — fold it
    // into the entry's error state instead of killing the server.
    child.on("error", (err) => {
      entry.ready = false;
      entry.error = `prisma studio spawn failed: ${err.message}`;
    });
    child.stderr?.on("data", (buf: Buffer) => {
      entry.stderrTail.push(buf.toString("utf8"));
      if (entry.stderrTail.length > 20) entry.stderrTail.shift();
    });
    child.on("exit", (code) => {
      if (!entry.ready && !entry.error) {
        entry.error =
          `prisma studio exited (${code ?? "?"}): ` +
          entry.stderrTail.join("").trim().slice(-400);
      }
      entry.ready = false;
    });
    studios.set(projectId, entry);

    // Wait for the port to come up (npx may resolve/download first).
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      if (await probePort(port)) {
        entry.ready = true;
        return toStatus(entry);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    if (child.exitCode === null && !entry.ready) {
      entry.error = "prisma studio did not start in time";
      this.stop(projectId);
    }
    return toStatus(studios.get(projectId));
  },

  stop(projectId: string): StudioStatus {
    const e = studios.get(projectId);
    if (e && e.child.pid && e.child.exitCode === null) {
      // Tree-kill: the cmd/npx wrapper owns the actual node process.
      execFile("taskkill", ["/PID", String(e.child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    }
    studios.delete(projectId);
    return { running: false, port: null, url: null };
  },

  disposeAll() {
    for (const id of [...studios.keys()]) this.stop(id);
  },
};
