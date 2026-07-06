import type { QueryClient } from "@tanstack/react-query";
import type { WsServerMsg, TranscriptEvent } from "@deck/shared";
import { useProjectsStore } from "../stores/projectsStore";
import { useProjectGroupsStore } from "../stores/projectGroupsStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useReviewsStore } from "../stores/reviewsStore";
import { useTasksStore } from "../stores/tasksStore";
import { useUIStore } from "../stores/uiStore";
import { toast } from "../components/ui/Toast";

type Listener = (msg: WsServerMsg) => void;

class EventsClient {
  private ws: WebSocket | null = null;
  private queryClient: QueryClient | null = null;
  private topicRefs = new Map<string, number>();
  private listeners = new Set<Listener>();
  private reconnectDelay = 500;
  private wantOpen = false;

  connect(queryClient: QueryClient) {
    this.queryClient = queryClient;
    this.wantOpen = true;
    this.open();
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/events`);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectDelay = 500;
      // Baseline topics; component-requested topics re-sent below.
      this.rawSend({ op: "sub", topics: ["projects", "sessions"] });
      const topics = [...this.topicRefs.keys()];
      if (topics.length) this.rawSend({ op: "sub", topics });
    };
    ws.onmessage = (ev) => this.dispatch(ev.data as string);
    ws.onclose = () => {
      this.ws = null;
      if (this.wantOpen) {
        setTimeout(() => this.open(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private rawSend(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  subscribe(topics: string[]) {
    const fresh: string[] = [];
    for (const t of topics) {
      const n = (this.topicRefs.get(t) ?? 0) + 1;
      this.topicRefs.set(t, n);
      if (n === 1) fresh.push(t);
    }
    if (fresh.length) this.rawSend({ op: "sub", topics: fresh });
  }

  unsubscribe(topics: string[]) {
    const gone: string[] = [];
    for (const t of topics) {
      const n = (this.topicRefs.get(t) ?? 0) - 1;
      if (n <= 0) {
        this.topicRefs.delete(t);
        gone.push(t);
      } else {
        this.topicRefs.set(t, n);
      }
    }
    if (gone.length) this.rawSend({ op: "unsub", topics: gone });
  }

  addListener(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private dispatch(raw: string) {
    let msg: WsServerMsg;
    try {
      msg = JSON.parse(raw) as WsServerMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case "projects.updated":
        useProjectsStore.getState().upsert(msg.payload);
        break;
      case "projects.removed":
        useProjectsStore.getState().remove(msg.id);
        break;
      case "project-groups.updated":
        useProjectGroupsStore.getState().setAll(msg.payload);
        break;
      case "ports.updated":
        useLibraryStore.getState().setLivePorts(msg.payload);
        break;
      case "screenshot.updated":
        useLibraryStore.getState().bumpShot(msg.projectId, msg.at);
        break;
      case "sessions.updated":
        useSessionsStore.getState().upsert(msg.payload);
        break;
      case "sessions.removed":
        useSessionsStore.getState().remove(msg.id);
        useUIStore.getState().removeSessionTabs(msg.id);
        break;
      case "git.updated":
        this.queryClient?.invalidateQueries({
          queryKey: ["git", msg.projectId],
        });
        break;
      case "reviews.updated":
        useReviewsStore.getState().upsert(msg.payload);
        break;
      case "tasks.updated":
        useTasksStore.getState().upsert(msg.payload);
        break;
      case "tasks.removed":
        useTasksStore.getState().remove(msg.id);
        break;
      case "digest.ready":
        toast(`Digest ready: ${msg.name}`, "info");
        break;
      // transcript.append + session.attention handled by component listeners
    }
    for (const l of this.listeners) l(msg);
  }
}

export const eventsClient = new EventsClient();

export function connectEvents(queryClient: QueryClient) {
  eventsClient.connect(queryClient);
}

// Convenience for transcript listeners (M3+).
export function onTranscriptAppend(
  sessionId: string,
  cb: (events: TranscriptEvent[]) => void,
): () => void {
  return eventsClient.addListener((msg) => {
    if (msg.t === "transcript.append" && msg.sessionId === sessionId) {
      cb(msg.events);
    }
  });
}
