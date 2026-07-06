import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { api } from "../lib/api";

// §9.6 Settings dialog.
export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const fontSize = useUIStore((s) => s.terminalFontSize);
  const setFontSize = useUIStore((s) => s.setTerminalFontSize);
  const notif = useUIStore((s) => s.notificationsEnabled);
  const setNotif = useUIStore((s) => s.setNotificationsEnabled);
  const setRecipesOpen = useUIStore((s) => s.setRecipesOpen);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.config(),
    enabled: open,
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-hair bg-overlay p-5 deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <div className="mb-4 flex items-center">
            <Dialog.Title className="text-[15px] font-semibold text-t1">
              Settings
            </Dialog.Title>
            <Dialog.Close className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Root directory">
              <span className="mono text-[12.5px] text-t2">
                {config?.root ?? "…"}
              </span>
            </Field>
            <Field label="Server port">
              <span className="mono text-[12.5px] text-t2">
                {config?.port ?? 12345} (localhost only)
              </span>
            </Field>
            <Field label="Default shell">
              <span className="mono text-[12.5px] text-t2">
                {config?.defaultShell ?? "pwsh.exe"}
              </span>
            </Field>
            <Field label="Claude binary">
              <span className="mono truncate text-[12.5px] text-t2">
                {config?.claudeBin ?? "not found"}
              </span>
            </Field>

            <div className="h-px bg-hair" />

            <Field label={`Terminal font size — ${fontSize}px`}>
              <input
                type="range"
                min={12}
                max={15}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-40 accent-[color:var(--accent)]"
              />
            </Field>
            <Field label="Notifications">
              <button
                onClick={() => setNotif(!notif)}
                className={
                  "relative h-5 w-9 rounded-full transition-colors " +
                  (notif ? "bg-accent" : "bg-raised")
                }
                aria-pressed={notif}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                  style={{ left: notif ? 18 : 2 }}
                />
              </button>
            </Field>
            <Field label="Prompt recipes">
              <button
                onClick={() => {
                  setOpen(false);
                  setRecipesOpen(true);
                }}
                className="h-7 rounded-[6px] border border-hair bg-raised px-2.5 text-[12px] text-t2 hover:bg-overlay hover:text-t1"
              >
                Manage recipes
              </button>
            </Field>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-t1">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}
