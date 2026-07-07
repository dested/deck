import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Plus, RefreshCw, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { api } from "../lib/api";
import { reloadUI, restartServer } from "../lib/serverControl";

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
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-t1">Root directories</span>
              <span className="text-[11.5px] text-t3">
                Folders scanned for projects. Changes take effect immediately —
                no restart.
              </span>
              <RootsEditor
                root={config?.root}
                roots={config?.roots}
                fileRoots={config?.fileRoots}
                extraRoots={config?.extraRoots}
              />
            </div>
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

            <div className="h-px bg-hair" />

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-t1">App</span>
              <span className="text-[11.5px] text-t3">
                Refresh without ever closing this window. Reload picks up a new UI
                build; Restart bounces the backend (it comes right back).
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <button
                  onClick={() => reloadUI()}
                  className="flex h-7 items-center gap-1.5 rounded-[6px] border border-hair bg-raised px-2.5 text-[12px] text-t2 hover:bg-overlay hover:text-t1"
                >
                  <RefreshCw size={13} /> Reload UI
                </button>
                <button
                  onClick={() => void restartServer()}
                  disabled={config != null && !config.supervised}
                  title={
                    config != null && !config.supervised
                      ? "Only available when running under the supervisor (bun start / deck.cmd)"
                      : undefined
                  }
                  className="flex h-7 items-center gap-1.5 rounded-[6px] border border-hair bg-raised px-2.5 text-[12px] text-t2 hover:bg-overlay hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCw size={13} /> Restart server
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RootsEditor({
  root,
  roots,
  fileRoots,
  extraRoots,
}: {
  root?: string;
  roots?: string[];
  fileRoots?: string[];
  extraRoots?: string[];
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!roots) return <div className="mono text-[12.5px] text-t3">…</div>;

  const locked = new Set(
    [root ?? "", ...(fileRoots ?? [])]
      .filter(Boolean)
      .map((r) => r.toLowerCase()),
  );
  const removable = new Set((extraRoots ?? []).map((r) => r.toLowerCase()));

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["config"] });
    // The server rescan already pushes projects.updated over WS, but nudge the
    // REST-cached list too in case a query is mounted.
    await qc.invalidateQueries({ queryKey: ["projects"] });
  }

  async function add() {
    const p = value.trim();
    if (!p) return;
    setBusy(p);
    setError(null);
    try {
      await api.addRoot(p);
      setValue("");
      await refresh();
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: string) {
    setBusy(p);
    setError(null);
    try {
      await api.removeRoot(p);
      await refresh();
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1 rounded-[8px] border border-hair bg-raised/40 p-1.5">
        {roots.map((r) => {
          const lc = r.toLowerCase();
          const isLocked = locked.has(lc);
          const canRemove = removable.has(lc);
          return (
            <div
              key={r}
              className="group flex items-center gap-2 rounded-[6px] px-2 py-1"
            >
              <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-t2">
                {r}
              </span>
              {isLocked ? (
                <span
                  className="flex items-center gap-1 text-[10.5px] text-t3"
                  title="Set in deck.config.json"
                >
                  <Lock size={11} /> config
                </span>
              ) : canRemove ? (
                <button
                  onClick={() => remove(r)}
                  disabled={busy !== null}
                  className="flex h-5 w-5 items-center justify-center rounded-[5px] text-t3 opacity-0 transition-opacity hover:bg-overlay hover:text-err group-hover:opacity-100 disabled:opacity-40"
                  title="Remove root"
                >
                  {busy === r ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <X size={13} />
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="D:\path\to\your\code"
          spellCheck={false}
          className="mono h-7 min-w-0 flex-1 rounded-[6px] border border-hair bg-root px-2 text-[12px] text-t1 outline-none placeholder:text-t3 focus:border-accent"
        />
        <button
          onClick={() => void add()}
          disabled={busy !== null || value.trim() === ""}
          className="flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-raised px-2.5 text-[12px] text-t2 hover:bg-overlay hover:text-t1 disabled:opacity-40"
        >
          {busy === value.trim() ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          Add
        </button>
      </div>
      {error && <span className="text-[11.5px] text-err">{error}</span>}
    </div>
  );
}

function msgOf(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // api.req throws "METHOD url -> STATUS detail"; surface just the detail.
  const m = raw.match(/->\s*\d+\s*(.*)$/);
  return (m?.[1] || raw).trim() || "failed";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-t1">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}
