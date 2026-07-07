import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LIFE_PROJECT_ID, type TaskCard, type TaskImage, type TaskStatus } from "@deck/shared";
import { config } from "../config.js";
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
  for (const t of stale) {
    deleteImageFiles(t);
    broadcastRemoved(t.id);
  }
}

// ----- attached images (bytes on disk, index on the card) -----

const imagesDir = () => path.join(config.deckStateDir, "task-images");
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_TASK = 12;

const MIME_EXT: Record<string, TaskImage["ext"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function imageFilePath(taskId: string, img: TaskImage): string {
  return path.join(imagesDir(), `${taskId}-${img.id}.${img.ext}`);
}

function deleteImageFiles(task: TaskCard) {
  for (const img of task.images ?? []) {
    try {
      fs.rmSync(imageFilePath(task.id, img), { force: true });
    } catch {
      /* best effort — an orphaned file is harmless */
    }
  }
}

// `data` is a data URL (data:image/png;base64,...) straight from the client's
// clipboard/file reader. Throws with a user-facing message on bad input.
export function addTaskImage(
  taskId: string,
  input: { data: string; name?: string; w?: number; h?: number },
): TaskCard {
  const task = getState().tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("task not found");
  if ((task.images ?? []).length >= MAX_IMAGES_PER_TASK)
    throw new Error(`max ${MAX_IMAGES_PER_TASK} images per card`);

  const m = /^data:([a-z/+.-]+);base64,(.+)$/is.exec(input.data ?? "");
  if (!m) throw new Error("expected a base64 data URL");
  const ext = MIME_EXT[m[1]!.toLowerCase()];
  if (!ext) throw new Error("unsupported image type (png/jpg/gif/webp only)");
  const buf = Buffer.from(m[2]!, "base64");
  if (!buf.length) throw new Error("empty image");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("image too large (15MB max)");

  const img: TaskImage = {
    id: randomUUID(),
    ext,
    name: (input.name ?? "").trim().slice(0, 120) || "pasted image",
    addedAt: Date.now(),
    ...(input.w && input.h ? { w: Math.round(input.w), h: Math.round(input.h) } : {}),
  };
  fs.mkdirSync(imagesDir(), { recursive: true });
  fs.writeFileSync(imageFilePath(taskId, img), buf);

  let updated: TaskCard | null = null;
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.images = [...(t.images ?? []), img];
    updated = { ...t };
  });
  if (!updated) {
    // task vanished between the read and the write — don't leak the file
    try {
      fs.rmSync(imageFilePath(taskId, img), { force: true });
    } catch {
      /* ignore */
    }
    throw new Error("task not found");
  }
  broadcastTask(updated);
  return updated;
}

export function removeTaskImage(taskId: string, imageId: string): TaskCard | null {
  let updated: TaskCard | null = null;
  let removed: TaskImage | undefined;
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return;
    removed = (t.images ?? []).find((i) => i.id === imageId);
    if (!removed) return;
    t.images = t.images.filter((i) => i.id !== imageId);
    updated = { ...t };
  });
  if (!updated || !removed) return null;
  try {
    fs.rmSync(imageFilePath(taskId, removed), { force: true });
  } catch {
    /* best effort */
  }
  broadcastTask(updated);
  return updated;
}

export function getTaskImage(
  taskId: string,
  imageId: string,
): { img: TaskImage; file: string } | null {
  const task = getState().tasks.find((t) => t.id === taskId);
  const img = task?.images?.find((i) => i.id === imageId);
  if (!task || !img) return null;
  return { img, file: imageFilePath(taskId, img) };
}

// The composer can capture straight into Next/Now, not just Inbox (never
// directly into Done — that's not how wins work).
const CREATABLE: TaskStatus[] = ["inbox", "next", "now"];

export function createTask(input: {
  title: string;
  body?: string;
  projectId?: string | null;
  status?: TaskStatus;
}): TaskCard {
  const maxOrder = getState().tasks.reduce((m, t) => Math.max(m, t.order), 0);
  const card: TaskCard = {
    id: randomUUID(),
    title: input.title?.trim() || "Untitled task",
    body: input.body ?? "",
    projectId: input.projectId ?? null,
    prompt: null,
    images: [],
    createdAt: Date.now(),
    doneAt: null,
    order: maxOrder + 1,
    status: input.status && CREATABLE.includes(input.status) ? input.status : "inbox",
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
    deleteImageFiles(d);
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
  const victim = getState().tasks.find((t) => t.id === id);
  let found = false;
  updateState((s) => {
    const before = s.tasks.length;
    s.tasks = s.tasks.filter((t) => t.id !== id);
    found = s.tasks.length !== before;
  });
  if (found) {
    if (victim) deleteImageFiles(victim);
    broadcastRemoved(id);
  }
  return found;
}

// Delete every Done card at once (the board's "Clear" button).
export function clearDone(): number {
  const done = getState().tasks.filter((t) => t.status === "done");
  if (!done.length) return 0;
  updateState((s) => {
    s.tasks = s.tasks.filter((t) => t.status !== "done");
  });
  for (const t of done) {
    deleteImageFiles(t);
    broadcastRemoved(t.id);
  }
  return done.length;
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
  if (task.projectId === LIFE_PROJECT_ID)
    throw new Error("Life tasks don't get code prompts — assign a code project");
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
