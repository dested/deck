import { useState, type RefObject } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { BookMarked, Sparkles, Save } from "lucide-react";
import { api } from "../../lib/api";
import { useRecipes, useInvalidateRecipes } from "../../lib/useRecipes";
import { menuContent, menuContentStyle } from "../ui/menuStyles";
import { toast } from "../ui/Toast";
import { cn } from "../../lib/cn";

// M13/M17: shared prompt tools — recipe insertion + AI enhance + save-as-recipe.
// Reused by the session Composer and the task-board card composer.
export function PromptToolbar({
  value,
  onChange,
  projectId,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  projectId?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const insertAtCursor = (body: string) => {
    const el = textareaRef?.current;
    if (el && typeof el.selectionStart === "number") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      onChange(value.slice(0, start) + body + value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + body.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      onChange(value ? `${value}\n${body}` : body);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <RecipeMenu onInsert={insertAtCursor} draft={value} />
      <EnhanceButton value={value} onChange={onChange} projectId={projectId} />
    </div>
  );
}

function RecipeMenu({
  onInsert,
  draft,
}: {
  onInsert: (body: string) => void;
  draft: string;
}) {
  const { data: recipes } = useRecipes();
  const invalidate = useInvalidateRecipes();
  const [filter, setFilter] = useState("");
  const list = (recipes ?? []).filter(
    (r) =>
      !filter ||
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())),
  );

  const saveDraft = async () => {
    const name = draft.split("\n")[0]!.slice(0, 40) || "New recipe";
    await api.createRecipe({ name, body: draft });
    invalidate();
    toast("Saved draft as recipe", "ok");
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1 data-[state=open]:bg-raised"
          title="Insert recipe"
          aria-label="Insert recipe"
        >
          <BookMarked size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={cn(menuContent, "w-[260px]")}
          style={menuContentStyle}
          onCloseAutoFocus={() => setFilter("")}
        >
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Filter recipes…"
            className="mb-1 h-7 w-full rounded-[5px] border border-hair bg-raised px-2 text-[12px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
          />
          <div className="max-h-[240px] overflow-y-auto">
            {list.length === 0 && (
              <div className="px-2 py-2 text-[12px] text-t3">No recipes</div>
            )}
            {list.map((r) => (
              <DropdownMenu.Item
                key={r.id}
                className="flex cursor-default flex-col rounded-[5px] px-2 py-1.5 text-[12.5px] text-t1 outline-none data-[highlighted]:bg-raised"
                onSelect={() => {
                  onInsert(r.body);
                  void api.useRecipe(r.id).catch(() => {});
                }}
              >
                <span className="truncate">{r.name}</span>
                {r.tags.length > 0 && (
                  <span className="mono text-[10px] text-t3">
                    {r.tags.join(" · ")}
                  </span>
                )}
              </DropdownMenu.Item>
            ))}
          </div>
          {draft.trim() && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-hair" />
              <DropdownMenu.Item
                className="flex cursor-default items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12.5px] text-t2 outline-none data-[highlighted]:bg-raised"
                onSelect={() => void saveDraft()}
              >
                <Save size={13} /> Save draft as recipe…
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function EnhanceButton({
  value,
  onChange,
  projectId,
}: {
  value: string;
  onChange: (v: string) => void;
  projectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enhanced, setEnhanced] = useState<string | null>(null);

  const run = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setOpen(true);
    setEnhanced(null);
    try {
      const res = await api.aiEnhance(value, projectId);
      setEnhanced(res.prompt);
    } catch {
      toast("Enhance failed (feature off or over budget)", "error");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          onClick={run}
          disabled={!value.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1 disabled:opacity-40 data-[state=open]:bg-raised"
          title="Enhance prompt"
          aria-label="Enhance prompt"
        >
          <Sparkles size={15} className={cn(busy && "animate-pulse text-accenttext")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[420px] max-w-[90vw] rounded-[10px] border border-hair bg-overlay p-3 deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-t3">
            Original
          </div>
          <p className="mb-3 max-h-[80px] overflow-y-auto whitespace-pre-wrap text-[12px] text-t3">
            {value}
          </p>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-accenttext">
            Enhanced
          </div>
          {busy ? (
            <div className="py-4 text-center text-[12px] text-t3">Enhancing…</div>
          ) : (
            <p className="mb-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[12.5px] text-t1">
              {enhanced}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              disabled={!enhanced}
              onClick={() => {
                if (enhanced) onChange(enhanced);
                setOpen(false);
              }}
              className="h-7 rounded-[6px] bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-40"
            >
              Use enhanced
            </button>
            <button
              onClick={() => setOpen(false)}
              className="h-7 rounded-[6px] border border-hair px-2.5 text-[12px] text-t2 hover:bg-raised"
            >
              Keep mine
            </button>
            <button
              disabled={busy}
              onClick={run}
              className="ml-auto h-7 rounded-[6px] px-2.5 text-[12px] text-t3 hover:text-t1 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
