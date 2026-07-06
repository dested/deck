import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Trash2, BookMarked } from "lucide-react";
import type { Recipe } from "@deck/shared";
import { useUIStore } from "../../stores/uiStore";
import { useRecipes, useInvalidateRecipes } from "../../lib/useRecipes";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";

// M13: manage prompt recipes. List sorted by useCount; inline edit; delete.
export function RecipesDialog() {
  const open = useUIStore((s) => s.recipesOpen);
  const setOpen = useUIStore((s) => s.setRecipesOpen);
  const { data: recipes } = useRecipes();
  const invalidate = useInvalidateRecipes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = [...(recipes ?? [])].sort((a, b) => b.useCount - a.useCount);
  const selected = sorted.find((r) => r.id === selectedId) ?? sorted[0] ?? null;

  const create = async () => {
    const r = await api.createRecipe({ name: "New recipe", body: "" });
    invalidate();
    setSelectedId(r.id);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[560px] max-h-[90vh] w-[720px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[10px] border border-hair bg-overlay deck-rise"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
            <BookMarked size={16} className="text-t2" />
            <Dialog.Title className="text-[14px] font-semibold text-t1">
              Prompt recipes
            </Dialog.Title>
            <button
              onClick={() => void create()}
              className="ml-auto flex h-7 items-center gap-1 rounded-[6px] border border-hair bg-panel px-2 text-[12px] text-t2 hover:bg-raised hover:text-t1"
            >
              <Plus size={13} /> New
            </button>
            <Dialog.Close className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* List */}
            <div className="w-[240px] shrink-0 overflow-y-auto border-r border-hair p-1.5">
              {sorted.length === 0 && (
                <div className="px-2 py-3 text-[12px] text-t3">
                  No recipes yet.
                </div>
              )}
              {sorted.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    "flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left",
                    selected?.id === r.id ? "bg-raised" : "hover:bg-raised/60",
                  )}
                >
                  <span className="truncate text-[12.5px] text-t1">{r.name}</span>
                  <span className="mono text-[10px] text-t3">
                    used {r.useCount}×
                  </span>
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              {selected ? (
                <RecipeEditor
                  key={selected.id}
                  recipe={selected}
                  onChanged={invalidate}
                  onDeleted={() => {
                    invalidate();
                    setSelectedId(null);
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-t3">
                  Select or create a recipe.
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RecipeEditor({
  recipe,
  onChanged,
  onDeleted,
}: {
  recipe: Recipe;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(recipe.name);
  const [body, setBody] = useState(recipe.body);
  const [tags, setTags] = useState(recipe.tags.join(", "));
  const [confirmDel, setConfirmDel] = useState(false);

  const save = async () => {
    await api.updateRecipe(recipe.id, {
      name: name.trim() || recipe.name,
      body,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    onChanged();
  };

  const del = async () => {
    await api.deleteRecipe(recipe.id);
    onDeleted();
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        placeholder="Recipe name"
        className="h-8 rounded-[6px] border border-hair bg-raised px-2.5 text-[13px] font-medium text-t1 focus:border-hairfocus focus:outline-none"
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        onBlur={() => void save()}
        placeholder="tags, comma separated"
        className="h-7 rounded-[6px] border border-hair bg-raised px-2.5 text-[12px] text-t2 focus:border-hairfocus focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void save()}
        placeholder="Prompt body…"
        className="mono min-h-0 flex-1 resize-none rounded-[6px] border border-hair bg-raised p-2.5 text-[12.5px] leading-[1.55] text-t1 focus:border-hairfocus focus:outline-none"
      />
      <div className="flex items-center gap-2">
        {confirmDel ? (
          <>
            <button
              onClick={() => void del()}
              className="flex h-7 items-center gap-1 rounded-[6px] bg-[rgba(215,84,85,0.15)] px-2.5 text-[12px] text-[color:var(--err)]"
            >
              <Trash2 size={13} /> Confirm delete
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              className="h-7 rounded-[6px] px-2 text-[12px] text-t3 hover:text-t1"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] text-t3 hover:text-[color:var(--err)]"
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
        <span className="mono ml-auto text-[11px] text-t3">
          used {recipe.useCount}×
        </span>
      </div>
    </div>
  );
}
