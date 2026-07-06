import type { WebSocket } from "ws";
import type { WsServerMsg, WsClientMsg } from "@deck/shared";

interface Client {
  ws: WebSocket;
  topics: Set<string>;
}

// Central pub-sub hub for /ws/events. Server modules import `eventHub` and call
// publish(); the hub fans out to every client subscribed to the message's topic.
type SubHandler = (topic: string, subscribed: boolean) => void;

class EventHub {
  private clients = new Set<Client>();
  private topicRefs = new Map<string, number>();
  private subHandler: SubHandler | null = null;

  // A handler fired when a topic gains its first subscriber (subscribed=true)
  // or loses its last (subscribed=false). Drives repo-tier watcher lifecycle.
  setSubHandler(h: SubHandler) {
    this.subHandler = h;
  }

  add(ws: WebSocket): Client {
    const client: Client = { ws, topics: new Set() };
    this.clients.add(client);
    this.send(ws, { t: "hello", time: Date.now() });
    return client;
  }

  remove(client: Client) {
    for (const t of client.topics) this.releaseTopic(t);
    this.clients.delete(client);
  }

  private acquireTopic(t: string) {
    const n = (this.topicRefs.get(t) ?? 0) + 1;
    this.topicRefs.set(t, n);
    if (n === 1) this.subHandler?.(t, true);
  }

  private releaseTopic(t: string) {
    const n = (this.topicRefs.get(t) ?? 0) - 1;
    if (n <= 0) {
      this.topicRefs.delete(t);
      this.subHandler?.(t, false);
    } else {
      this.topicRefs.set(t, n);
    }
  }

  handleMessage(client: Client, raw: string) {
    let msg: WsClientMsg;
    try {
      msg = JSON.parse(raw) as WsClientMsg;
    } catch {
      return;
    }
    switch (msg.op) {
      case "sub":
        for (const t of msg.topics) {
          if (!client.topics.has(t)) {
            client.topics.add(t);
            this.acquireTopic(t);
          }
        }
        break;
      case "unsub":
        for (const t of msg.topics) {
          if (client.topics.has(t)) {
            client.topics.delete(t);
            this.releaseTopic(t);
          }
        }
        break;
      case "ping":
        this.send(client.ws, { t: "pong" });
        break;
    }
  }

  private send(ws: WebSocket, msg: WsServerMsg) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Publish to every client subscribed to any of `topics`. If a message is
  // relevant to all clients (e.g. echo), pass topics that clients subscribe to.
  publish(topics: string[], msg: WsServerMsg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      let match = false;
      for (const t of topics) {
        if (client.topics.has(t)) {
          match = true;
          break;
        }
      }
      if (match && client.ws.readyState === client.ws.OPEN) {
        client.ws.send(data);
      }
    }
  }

  // Broadcast to all connected clients regardless of subscription.
  broadcast(msg: WsServerMsg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.ws.readyState === client.ws.OPEN) client.ws.send(data);
    }
  }

  get clientCount() {
    return this.clients.size;
  }

  // Does any client currently subscribe to this topic? (M12 bounds live-meta
  // spend to sessions with an open tab/feed via their transcript: topic.)
  hasSubscribers(topic: string): boolean {
    return (this.topicRefs.get(topic) ?? 0) > 0;
  }
}

export const eventHub = new EventHub();

// Topic helpers keep string construction in one place.
export const topics = {
  projects: "projects",
  sessions: "sessions",
  git: (projectId: string) => `git:${projectId}`,
  transcript: (sessionId: string) => `transcript:${sessionId}`,
};
