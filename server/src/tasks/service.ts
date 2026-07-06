import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TaskCard, TaskStatus } from "@deck/shared";
import { getState, updateState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { projectRegistry } from "../projects/registry.js";
import { aiComplete } from "../ai/client.js";

// M17v2: personal task-board card operations. Pure kanban — this module NEVER
// spawns sessions; the only AI touchpoint drafts a prompt the user copies out.
const CAP = 200;
const DONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // done cards auto-prune

export function listTasks(): TaskCard[] {
  pruneOldDone();
  return getState().tasks;
}

export function broadcastTask(t: TaskCard) {
  eventHub.publish([topics.sessions], { t: "tasks.updated", payload: t });
}

function broadcastRemoved(id: string) {
  eventHub.publish([topics.sessions], { t: "tasks.removed", id });
}

// Done cards older than 30d disappear quietly so Done never becomes a guilt
// pile. Runs lazily on list/create — no timer needed.
function pruneOldDone() {
  const cutoff = Date.now() - DONE_RETENTION_MS;
  const stale = getState().tasks.filter(
    (t) => t.status === "done" && (t.doneAt ?? 0) < cutoff,
  );
  if (!stale.length) return;
  updateState((s) => {
    s.tasks = s.tasks.filter((t) => !stale.includes(t));
  });
  for (const t of stale) broadcastRemoved(t.id);
}

export function createTask(input: {
  title: string;
  body?: string;
  projectId?: string | null;
}): TaskCard {
  const maxOrder = getState().tasks.reduce((m, t) => Math.max(m, t.order), 0);
  const card: TaskCard = {
    id: randomUUID(),
    title: input.title?.trim() || "Untitled task",
    body: input.body ?? "",
    projectId: input.projectId ?? null,
    prompt: null,
    createdAt: Date.now(),
    doneAt: null,
    order: maxOrder + 1,
    status: "inbox",
  };
  updateState((s) => {
    s.tasks.push(card);
    pruneCap(s.tasks);
  });
  broadcastTask(card);
  return card;
}

function pruneCap(tasks: TaskCard[]) {
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
  patch: Partial<
    Pick<TaskCard, "title" | "body" | "projectId" | "prompt" | "order" | "status">
  >,
): TaskCard | null {
  let updated: TaskCard | null = null;
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    if (typeof patch.title === "string") t.title = patch.title;
    if (typeof patch.body === "string") t.body = patch.body;
    if (patch.projectId !== undefined) t.projectId = patch.projectId;
    if (patch.prompt !== undefined) t.prompt = patch.prompt;
    if (typeof patch.order === "number") t.order = patch.order;
    if (patch.status && patch.status !== t.status) {
      t.status = patch.status;
      // doneAt drives the fade/prune; moving back out of Done resurrects clean.
      t.doneAt = patch.status === "done" ? Date.now() : null;
    }
    updated = { ...t };
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
  if (found) broadcastRemoved(id);
  return found;
}

// Delete every Done card at once (the board's "Clear" button).
export function clearDone(): number {
  const doneIds = getState()
    .tasks.filter((t) => t.status === "done")
    .map((t) => t.id);
  if (!doneIds.length) return 0;
  updateState((s) => {
    s.tasks = s.tasks.filter((t) => t.status !== "done");
  });
  for (const id of doneIds) broadcastRemoved(id);
  return doneIds.length;
}

const CLIFFNOTES_CAP = 14_000; // chars of cliffnotes context sent to the model

function readCliffnotes(projectPath: string): string | null {
  for (const name of ["cliffnotes.md", "CLIFFNOTES.md"]) {
    const p = path.join(projectPath, name);
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").slice(0, CLIFFNOTES_CAP);
    } catch {
      /* unreadable → treat as absent */
    }
  }
  return null;
}

const PROMPT_SYSTEM =
  "You write prompts for Claude Code (an AI coding agent working inside the " +
  "repo). Given a task title, optional notes, and the project's cliffnotes " +
  "(its living map), draft ONE ready-to-paste prompt that gets the task done. " +
  "Be specific: name the files/systems the cliffnotes says are involved, state " +
  "the desired outcome and any constraints/gotchas that apply, and say how to " +
  "verify. Do not invent requirements beyond the task. Output ONLY the prompt " +
  "text — no preamble, no code fences, no commentary.";

// Draft a Claude Code prompt for a card from its title/body + the project's
// cliffnotes. Saves the result on the card. Throws with a user-facing message
// when preconditions fail; returns null when AI is off/over budget.
export async function generateTaskPrompt(id: string): Promise<TaskCard | null> {
  const task = getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error("task not found");
  if (!task.projectId) throw new Error("assign a project first");
  const projectPath = projectRegistry.getPath(task.projectId);
  if (!projectPath) throw new Error("project not found");

  const cliffnotes = readCliffnotes(projectPath);
  const parts = [
    `Task: ${task.title}`,
    task.body.trim() ? `Notes:\n${task.body.trim()}` : null,
    cliffnotes
      ? `Project cliffnotes:\n${cliffnotes}`
      : "This project has no cliffnotes.md — write the prompt from the task alone.",
  ].filter(Boolean);

  const res = await aiComplete({
    feature: "taskPrompt",
    prompt: parts.join("\n\n"),
    system: PROMPT_SYSTEM,
    maxTokens: 2048,
    timeoutMs: 120_000,
  });
  const text = res?.text?.trim();
  if (!text) return null;
  return updateTask(id, { prompt: text });
}
