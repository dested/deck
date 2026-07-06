import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TranscriptPage, Group, SessionRestore } from "@deck/shared";
import { sessionManager } from "../sessions/manager.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { readScrollback } from "../pty/scrollback.js";
import { getState, updateState } from "../state.js";

const PAGE = 200;

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get("/sessions", async () => sessionManager.list());

  app.post<{
    Body: {
      projectId: string;
      kind: "claude" | "shell";
      name?: string;
      groupId?: string;
      claudeArgs?: string[];
      command?: string;
      initialPrompt?: string;
      cwd?: string;
    };
  }>("/sessions", async (req, reply) => {
    try {
      return sessionManager.create(req.body);
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/sessions/:id/kill",
    async (req, reply) => {
      if (!sessionManager.isOwned(req.params.id)) {
        return reply
          .code(400)
          .send({ error: "cannot kill an external session" });
      }
      sessionManager.kill(req.params.id);
      return { ok: true };
    },
  );

  // Remove a session from the live view. Owned sessions are killed; external
  // (transcript-only) sessions can't be killed, so they're dismissed — hidden
  // until their transcript sees new activity.
  app.post<{ Params: { id: string } }>(
    "/sessions/:id/dismiss",
    async (req) => {
      const { id } = req.params;
      if (sessionManager.isOwned(id)) {
        // Kill + fully remove (also clears zombies whose pty already died).
        sessionManager.forceClose(id);
        return { ok: true };
      }
      updateState((s) => {
        s.dismissedSessions[id] = Date.now();
      });
      sessionManager.publishRemoved(id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { name: string } }>(
    "/sessions/:id/rename",
    async (req) => {
      sessionManager.rename(req.params.id, req.body.name);
      return { ok: true };
    },
  );

  // M8: clear the unread flag (answering/opening from the Inbox card).
  app.post<{ Params: { id: string } }>("/sessions/:id/read", async (req) => {
    sessionManager.clearUnread(req.params.id);
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { text: string; submit: boolean };
  }>("/sessions/:id/input", async (req, reply) => {
    const ok = sessionManager.input(
      req.params.id,
      req.body.text,
      req.body.submit,
    );
    if (!ok) return reply.code(400).send({ error: "not an owned session" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    "/sessions/:id/restart",
    async (req, reply) => {
      const s = sessionManager.restart(req.params.id);
      if (!s) return reply.code(400).send({ error: "cannot restart" });
      return s;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sessions/:id/adopt",
    async (req, reply) => {
      const ext = sessionManager
        .list()
        .find((x) => x.id === req.params.id && x.source === "external");
      if (!ext) return reply.code(404).send({ error: "external session not found" });
      return sessionManager.adopt(ext.id, ext.projectId);
    },
  );

  // Restore a reopened tab whose session is no longer live (server bounced,
  // transcript aged out of the <30min live set, or it was closed). Resolves the
  // stale id to a read-only claude feed or a captured shell scrollback.
  app.get<{ Params: { id: string } }>(
    "/sessions/:id/restore",
    async (req): Promise<SessionRestore> => {
      const { id } = req.params;

      // 1. Owned tab: map pty id -> its transcript via the persisted record.
      const owned = sessionManager.ownedRecord(id);
      if (owned) {
        if (owned.kind === "claude" && owned.transcriptSessionId) {
          const session = transcriptRegistry.sessionForTranscript(
            owned.transcriptSessionId,
            { name: owned.name },
          );
          if (session) return { kind: "claude", session };
        }
        const scrollback = readScrollback(id);
        if (scrollback) return { kind: "shell", scrollback, name: owned.name };
        return { kind: "none" };
      }

      // 2. External tab: the id IS the transcript uuid.
      const session = transcriptRegistry.sessionForTranscript(id);
      if (session) return { kind: "claude", session };

      // 3. Last resort: a captured shell scrollback keyed by this id.
      const scrollback = readScrollback(id);
      if (scrollback) return { kind: "shell", scrollback, name: null };

      return { kind: "none" };
    },
  );

  // Resume a transcript as a fresh owned claude session (from a restored tab).
  app.post<{
    Body: { transcriptId: string; projectId: string; name?: string; groupId?: string };
  }>("/sessions/resume", async (req, reply) => {
    const { transcriptId, projectId, name, groupId } = req.body;
    if (!transcriptId || !projectId) {
      return reply.code(400).send({ error: "transcriptId and projectId required" });
    }
    return sessionManager.resumeTranscript(transcriptId, projectId, name, groupId);
  });

  // Paginated-backward transcript feed (§3.1). `before` = exclusive end index;
  // returns the PAGE events ending there. Omit for the latest page.
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    "/sessions/:id/transcript",
    async (req, reply) => {
      const transcriptId = sessionManager.resolveTranscriptId(req.params.id);
      if (!transcriptId) {
        const empty: TranscriptPage = {
          events: [],
          hasMore: false,
          total: 0,
          title: null,
        };
        return empty;
      }
      const parsed = transcriptRegistry.getParsed(transcriptId);
      if (!parsed) return reply.code(404).send({ error: "transcript not found" });
      const total = parsed.events.length;
      const end =
        req.query.before != null ? Math.max(0, Number(req.query.before)) : total;
      const start = Math.max(0, end - PAGE);
      const page: TranscriptPage = {
        events: parsed.events.slice(start, end),
        hasMore: start > 0,
        total,
        title: parsed.title,
      };
      return page;
    },
  );

  // Live + history transcript sessions for a project (Agents tab, §9.4).
  app.get<{ Params: { id: string } }>(
    "/projects/:id/agent-sessions",
    async (req) => transcriptRegistry.sessionsForProject(req.params.id),
  );

  // ----- Groups (§3.1) -----
  app.get("/groups", async () => getState().groups);

  app.post<{ Body: { name: string } }>("/groups", async (req) => {
    const group: Group = { id: randomUUID(), name: req.body.name };
    updateState((s) => {
      s.groups.push(group);
    });
    return group;
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/groups/:id",
    async (req, reply) => {
      let updated: Group | undefined;
      updateState((s) => {
        const g = s.groups.find((x) => x.id === req.params.id);
        if (g) {
          g.name = req.body.name;
          updated = g;
        }
      });
      if (!updated) return reply.code(404).send({ error: "group not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/groups/:id", async (req, reply) => {
    const affected: string[] = [];
    updateState((s) => {
      s.groups = s.groups.filter((g) => g.id !== req.params.id);
      for (const [sid, gid] of Object.entries(s.sessionGroups)) {
        if (gid === req.params.id) {
          s.sessionGroups[sid] = null;
          affected.push(sid);
        }
      }
    });
    for (const sid of affected) sessionManager.publishById(sid);
    return reply.code(204).send();
  });

  // Assign a session to a group (groupId "none" -> ungroup).
  app.post<{ Params: { id: string }; Body: { sessionId: string } }>(
    "/groups/:id/assign",
    async (req) => {
      const groupId = req.params.id === "none" ? null : req.params.id;
      sessionManager.assignGroup(req.body.sessionId, groupId);
      return { ok: true };
    },
  );
}
