import { useEffect } from "react";
import { create } from "zustand";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type ToastKind = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, kind: ToastKind) => void;
  dismiss: (id: number) => void;
}

// Monotonic id without Date.now (kept deterministic-ish; ids only need to be
// unique within a session).
let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, kind) =>
    set((s) => ({ items: [...s.items, { id: nextId++, message, kind }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

// Fire a toast from anywhere (no hook needed).
export function toast(message: string, kind: ToastKind = "info") {
  useToastStore.getState().push(message, kind);
}

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((t) => (
        <ToastRow key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4200);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  const Icon =
    item.kind === "ok" ? CheckCircle2 : item.kind === "error" ? AlertCircle : null;
  return (
    <div
      className="pointer-events-auto flex max-w-[380px] items-start gap-2 rounded-[8px] border border-hair bg-overlay px-3 py-2.5 deck-rise"
      style={{ boxShadow: "var(--shadow-overlay)" }}
    >
      {Icon && (
        <Icon
          size={15}
          className={cn(
            "mt-px shrink-0",
            item.kind === "ok" ? "text-ok" : "text-[color:var(--err)]",
          )}
        />
      )}
      <span className="min-w-0 flex-1 text-[12.5px] text-t1">{item.message}</span>
      <button
        onClick={onDismiss}
        className="shrink-0 text-t3 hover:text-t1"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
