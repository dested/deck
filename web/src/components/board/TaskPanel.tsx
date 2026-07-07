import { useRef, useState } from "react";
import {
  X,
  Trash2,
  Sparkles,
  Loader2,
  Copy,
  Inbox,
  ListTodo,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { TaskCard, TaskStatus } from "@deck/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";
import { isLife, moveToStatus } from "../../lib/tasks";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/Toast";
import { ProjectPicker } from "./ProjectPicker";
import {
  imagesFromClipboard,
  imagesFromDrop,
  fileToPending,
  EditorImageGrid,
} from "./taskImages";

// The task edit side-panel: a right slide-over with the FULL card — title,
// project, status, notes, images, the AI prompt drafting tools. Opens from any
// task row and auto-opens after quick-capture (focus stays in the capture bar
// so dumping continues; ws broadcasts keep the fields honest).

const STATUSES: { key: TaskStatus; label: string; icon: LucideIcon }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "next", label: "Next", icon: ListTodo },
  { key: "now", label: "Now", icon: Star },
  { key: "done", label: "Done", icon: Trophy },
];

export function TaskPanel({
  task,
  scopedProject,
  onClose,
}: {
  task: TaskCard;
  scopedProject: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[85%] flex-col border-l border-hair bg-panel deck-rise"
      style={{ boxShadow: "var(--shadow-overlay)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) onClose();
      }}
    >
      {/* key= resets the local field state whenever the panel swaps tasks */}
      <PanelBody key={task.id} task={task} scopedProject={scopedProject} onClose={onClose} />
    </div>
  );
}

function PanelBody({
  task,
  scopedProject,
  onClose,
}: {
  task: TaskCard;
  scopedProject: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [prompt, setPrompt] = useState(task.prompt ?? "");
  const [generating, setGenerating] = useState(false);
  const promptDirty = useRef(false);

  // Generate updates the card server-side; mirror it in unless mid-edit.
  if (!promptDirty.current && (task.prompt ?? "") !== prompt) {
    setPrompt(task.prompt ?? "");
  }

  const save = (patch: Parameters<typeof api.updateTask>[1]) =>
    void api.updateTask(task.id, patch).catch(() => {});

  const canDraft = !!task.projectId && !isLife(task.projectId);

  const generate = async () => {
    if (!canDraft) {
      toast(
        isLife(task.projectId)
          ? "Life tasks don't get code prompts"
          : "Assign a project first — the prompt is written from its cliffnotes",
        "error",
      );
      return;
    }
    setGenerating(true);
    try {
      await api.generateTaskPrompt(task.id);
      toast("Prompt drafted", "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Prompt generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const copyPrompt = () => {
    if (!task.prompt) return;
    void navigator.clipboard?.writeText(task.prompt);
    toast("Prompt copied — paste it into a Claude session", "info");
  };

  const uploadFiles = async (files: File[]) => {
    try {
      for (const f of files) {
        const p = await fileToPending(f);
        await api.addTaskImage(task.id, { data: p.dataUrl, name: p.name, w: p.w, h: p.h });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Image upload failed", "error");
    }
  };

  return (
    <>
      {/* Header: status segmented + close */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hair px-3 py-2">
        <div className="flex overflow-hidden rounded-[6px] border border-hair">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => moveToStatus(task, s.key)}
              className={cn(
                "flex h-7 items-center gap-1 px-2 text-[11.5px] transition-colors",
                task.status === s.key
                  ? s.key === "now"
                    ? "bg-[color:var(--accent)]/15 font-medium text-accenttext"
                    : "bg-raised font-medium text-t1"
                  : "text-t3 hover:bg-raised/60 hover:text-t2",
              )}
            >
              <s.icon size={11} /> {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1"
          aria-label="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Fields */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3"
        onPaste={(e) => {
          const files = imagesFromClipboard(e);
          if (files.length) {
            e.preventDefault();
            void uploadFiles(files);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = imagesFromDrop(e);
          if (files.length) {
            e.preventDefault();
            void uploadFiles(files);
          }
        }}
      >
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
          rows={2}
          placeholder="Task title…"
          className="w-full resize-none rounded-[7px] border border-hair bg-raised p-2 text-[14px] font-semibold leading-snug text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
        />

        {!scopedProject && (
          <ProjectPicker block value={task.projectId} onChange={(id) => save({ projectId: id })} />
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== task.body && save({ body })}
          placeholder="Notes / description — paste images anywhere…"
          rows={6}
          className="w-full resize-y rounded-[7px] border border-hair bg-raised p-2 text-[12.5px] leading-relaxed text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
        />

        <EditorImageGrid task={task} onAddFiles={(f) => void uploadFiles(f)} />

        {/* AI prompt drafting — the board's only automation */}
        <div className="flex items-center gap-1.5">
          <Tooltip
            label={
              canDraft
                ? "Draft a Claude Code prompt from this card + the project's cliffnotes"
                : isLife(task.projectId)
                  ? "Life tasks don't get code prompts"
                  : "Assign a project first"
            }
          >
            <button
              onClick={() => void generate()}
              disabled={generating || !canDraft}
              className="flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-raised px-2 text-[11.5px] text-t2 hover:bg-overlay hover:text-t1 disabled:opacity-40"
            >
              {generating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {task.prompt ? "Redraft prompt" : "Draft prompt"}
            </button>
          </Tooltip>
          {task.prompt && (
            <button
              onClick={copyPrompt}
              className="flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-raised px-2 text-[11.5px] text-accenttext hover:bg-overlay"
            >
              <Copy size={12} /> Copy
            </button>
          )}
        </div>
        {task.prompt != null && (
          <textarea
            value={prompt}
            onChange={(e) => {
              promptDirty.current = true;
              setPrompt(e.target.value);
            }}
            onBlur={() => {
              promptDirty.current = false;
              if (prompt !== (task.prompt ?? "")) save({ prompt: prompt || null });
            }}
            rows={8}
            className="mono w-full resize-y rounded-[7px] border border-hair bg-raised p-2 text-[11.5px] leading-relaxed text-t1 focus:border-hairfocus focus:outline-none"
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-hair px-3 py-2">
        <span className="text-[10.5px] text-t3">added {relTime(task.createdAt)}</span>
        <button
          onClick={() => {
            void api.deleteTask(task.id).catch(() => {});
            onClose();
          }}
          className="ml-auto flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11.5px] text-t3 hover:bg-raised hover:text-err"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </>
  );
}
