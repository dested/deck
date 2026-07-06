import { randomUUID } from "node:crypto";
import type { TaskCard } from "@deck/shared";
import { getState, updateState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { sessionManager } from "../sessions/manager.js";

// M17: task-board card operations, shared by the routes and the autopilot.
const CAP = 200;

export function listTasks(): TaskCard[] {
  return getState().tasks;
}

export function broadcastTask(t: TaskCard) {
  eventHub.publish([topics.sessions], { t: "tasks.updated", payload: t });
}

export function createTask(input: {
  title: string;
  body?: string;
  projectId: string;
  recipeId?: string | null;
}): TaskCard {
  const maxOrder = getState().tasks.reduce((m, t) => Math.max(m, t.order), 0);
  const card: TaskCard = {
    id: randomUUID(),
    title: input.title?.trim() || "Untitled task",
    body: input.body ?? "",
    projectId: input.projectId,
    recipeId: input.recipeId ?? null,
    sessionId: null,
    createdAt: Date.now(),
    startedAt: null,
    doneAt: null,
    order: maxOrder + 1,
    status: "backlog",
  };
  updateState((s) => {
    s.tasks.push(card);
    pruneDone(s.tasks);
  });
  broadcastTask(card);
  return card;
}

function pruneDone(tasks: TaskCard[]) {
  if (tasks.length <= CAP) return;
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  const overflow = tasks.length - CAP;
  for (const d of done.slice(0, overflow)) {
    const idx = tasks.indexOf(d);
    if (idx >= 0) tasks.splice(idx, 1);
  }
}

export function updateTask(
  id: string,
  patch: Partial<Pick<TaskCard, "title" | "body" | "projectId" | "order" | "status">>,
): TaskCard | null {
  let updated: TaskCard | null = null;
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    if (typeof patch.title === "string") t.title = patch.title;
    if (typeof patch.body === "string") t.body = patch.body;
    if (typeof patch.projectId === "string") t.projectId = patch.projectId;
    if (typeof patch.order === "number") t.order = patch.order;
    if (patch.status) {
      t.status = patch.status;
      if (patch.status === "done") t.doneAt = Date.now();
    }
    updated = t;
  });
  if (updated) broadcastTask(updated);
  return updated;
}

export function deleteTask(id: string): boolean {
  let found = false;
  updateState((s) => {
    const before = s.tasks.length;
    s.tasks = s.tasks.filter((t) => t.id !== id);
    found = s.tasks.length !== before;
  });
  return found;
}

// Spawn the linked claude session with the card body as the first message and
// flip the card to a derived ("linked") column.
export function startTask(id: string): TaskCard | null {
  const task = getState().tasks.find((t) => t.id === id);
  if (!task) return null;
  const session = sessionManager.create({
    projectId: task.projectId,
    kind: "claude",
    name: task.title,
    initialPrompt: task.body || undefined,
  });
  let updated: TaskCard | null = null;
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (t) {
      t.sessionId = session.id;
      t.status = "linked";
      t.startedAt = Date.now();
      updated = t;
    }
  });
  if (updated) broadcastTask(updated);
  return updated;
}
