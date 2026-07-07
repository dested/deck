import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import type { TaskCard } from "@deck/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";

// Image plumbing for task cards: clipboard/file → data-URL payloads, the
// thumbnail strip on cards, and a minimal viewport lightbox.

export interface PendingImage {
  key: string; // local-only id while the task doesn't exist yet
  dataUrl: string;
  name: string;
  w?: number;
  h?: number;
}

const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Pull image files out of a paste event (screenshots arrive this way).
export function imagesFromClipboard(e: React.ClipboardEvent): File[] {
  const out: File[] = [];
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind !== "file" || !ACCEPTED.includes(item.type)) continue;
    const f = item.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

export function imagesFromDrop(e: React.DragEvent): File[] {
  return [...(e.dataTransfer?.files ?? [])].filter((f) => ACCEPTED.includes(f.type));
}

// File → { dataUrl, dims }. Dimensions are best-effort (layout hints only).
export async function fileToPending(file: File): Promise<PendingImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("failed to read image"));
    r.readAsDataURL(file);
  });
  const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
  return {
    key: crypto.randomUUID(),
    dataUrl,
    name: file.name || "pasted image",
    ...(dims ?? {}),
  };
}

// Upload a batch of pending images onto an existing task, sequentially (the
// ws broadcast reconciles the card after each one).
export async function uploadPending(taskId: string, pending: PendingImage[]) {
  for (const p of pending) {
    await api.addTaskImage(taskId, {
      data: p.dataUrl,
      name: p.name,
      w: p.w,
      h: p.h,
    });
  }
}

// Thumbnail strip on a collapsed card: up to 3 thumbs, "+N" on the last one.
export function CardThumbs({ task }: { task: TaskCard }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const imgs = task.images ?? [];
  if (!imgs.length) return null;
  const shown = imgs.slice(0, 3);
  const extra = imgs.length - shown.length;
  return (
    <>
      <div className="mt-1.5 flex gap-1.5 pl-[14px]">
        {shown.map((img, i) => (
          <button
            key={img.id}
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(i);
            }}
            className="relative h-14 w-20 shrink-0 overflow-hidden rounded-[6px] border border-hair bg-panel hover:border-hairfocus"
            aria-label={`View ${img.name}`}
          >
            <img
              src={api.taskImageUrl(task.id, img.id)}
              alt={img.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {extra > 0 && i === shown.length - 1 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[12px] font-semibold text-white">
                +{extra}
              </span>
            )}
          </button>
        ))}
      </div>
      {lightbox != null && (
        <Lightbox
          images={imgs.map((img) => ({
            url: api.taskImageUrl(task.id, img.id),
            name: img.name,
          }))}
          index={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

// Editor image grid: existing images (hover to delete) + an add tile.
export function EditorImageGrid({
  task,
  onAddFiles,
}: {
  task: TaskCard;
  onAddFiles: (files: File[]) => void;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const imgs = task.images ?? [];
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {imgs.map((img, i) => (
        <div
          key={img.id}
          className="group/img relative h-16 w-24 overflow-hidden rounded-[6px] border border-hair"
        >
          <button
            onClick={() => setLightbox(i)}
            className="h-full w-full"
            aria-label={`View ${img.name}`}
          >
            <img
              src={api.taskImageUrl(task.id, img.id)}
              alt={img.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
          <button
            onClick={() => void api.deleteTaskImage(task.id, img.id).catch(() => {})}
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-[4px] bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover/img:opacity-100"
            aria-label={`Remove ${img.name}`}
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <AddImageTile onFiles={onAddFiles} className="h-16 w-24" />
      {lightbox != null && (
        <Lightbox
          images={imgs.map((img) => ({
            url: api.taskImageUrl(task.id, img.id),
            name: img.name,
          }))}
          index={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// Dashed "add image" tile wrapping a hidden file input.
export function AddImageTile({
  onFiles,
  className,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[6px] border border-dashed border-hair text-t3 transition-colors hover:border-hairfocus hover:text-t2",
        className,
      )}
    >
      <ImagePlus size={14} />
      <span className="text-[9px]">or paste</span>
      <input
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

// Fullscreen viewer. Esc closes, arrows navigate. Portaled to <body> so card
// overflow/scroll containers can't clip it.
export function Lightbox({
  images,
  index,
  onClose,
}: {
  images: { url: string; name: string }[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  const img = images[Math.min(i, images.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") setI((v) => (v + 1) % images.length);
      else if (e.key === "ArrowLeft") setI((v) => (v - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images.length, onClose]);

  if (!img) return null;
  // NOTE: portaled to <body>, but React events still bubble through the React
  // tree — stop propagation so clicks don't reach the card underneath.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <img
        src={img.url}
        alt={img.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[94vw] rounded-[6px] object-contain"
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-[6px] bg-black/60 px-2.5 py-1 text-[11.5px] text-white/80">
        {img.name}
        {images.length > 1 && ` · ${i + 1}/${images.length}`}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/80"
        aria-label="Close"
      >
        <X size={17} />
      </button>
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setI((v) => (v - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/80"
            aria-label="Previous image"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setI((v) => (v + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/80"
            aria-label="Next image"
          >
            <ChevronRight size={17} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
