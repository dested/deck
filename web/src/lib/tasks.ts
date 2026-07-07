import { LIFE_PROJECT_ID, type TaskCard, type TaskStatus } from "@deck/shared";
import { api } from "./api";
import { useTasksStore } from "../stores/tasksStore";

// Focus-stack task helpers, shared by the BoardView, the rail Focus block,
// triage mode and the task panel — one place decides ordering + moves.

export { LIFE_PROJECT_ID };
export const LIFE_NAME = "Life";
export const isLife = (projectId: string | null | undefined) =>
  projectId === LIFE_PROJECT_ID;

export interface FocusBuckets {
  now: TaskCard[];
  next: TaskCard[];
  inbox: TaskCard[];
  done: TaskCard[];
}

// Bucket + sort every task once. `projectId` scopes to one project's cards
// (the per-project Tasks tab).
export function focusBuckets(
  tasks: Record<string, TaskCard>,
  projectId?: string,
): FocusBuckets {
  const b: FocusBuckets = { now: [], next: [], inbox: [], done: [] };
  for (const t of Object.values(tasks)) {
    if (projectId && t.projectId !== projectId) continue;
    (b[t.status] ?? b.inbox).push(t);
  }
  b.now.sort((a, z) => a.order - z.order);
  b.next.sort((a, z) => a.order - z.order);
  b.inbox.sort((a, z) => a.order - z.order);
  b.done.sort((a, z) => (z.doneAt ?? 0) - (a.doneAt ?? 0));
  return b;
}

// Optimistic move: paint the store first, then persist; the ws broadcast
// reconciles either way.
export function moveTask(task: TaskCard, status: TaskStatus, order: number) {
  useTasksStore.getState().upsert({
    ...task,
    status,
    order,
    doneAt: status === "done" ? task.doneAt ?? Date.now() : null,
  });
  void api.updateTask(task.id, { status, order }).catch(() => {});
}

// Move to the end of a status bucket (the common "send it there" case).
export function moveToStatus(task: TaskCard, status: TaskStatus) {
  if (task.status === status) return;
  const all = Object.values(useTasksStore.getState().byId);
  const maxOrder = all
    .filter((t) => t.status === status)
    .reduce((m, t) => Math.max(m, t.order), 0);
  moveTask(task, status, maxOrder + 1);
}
