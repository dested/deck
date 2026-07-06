import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Newspaper, ChevronDown, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { relTime } from "../lib/format";
import { cn } from "../lib/cn";
import { menuContent, menuContentStyle, menuItem } from "../components/ui/menuStyles";
import { toast } from "../components/ui/Toast";

type Range = "today" | "yesterday" | { hours: number };
const RANGE_LABELS: { label: string; value: Range }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 24h", value: { hours: 24 } },
];

// M14: "what got done" digest — history rail + rendered markdown + Generate.
export function DigestView() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const { data: history } = useQuery({
    queryKey: ["digests"],
    queryFn: () => api.digests(),
  });

  const activeName = selected ?? history?.[0]?.name ?? null;

  const { data: doc } = useQuery({
    queryKey: ["digest", activeName],
    queryFn: () => api.digest(activeName!),
    enabled: !!activeName,
  });

  const generate = async (range: Range) => {
    setGenerating(true);
    try {
      const res = await api.generateDigest(range);
      await qc.invalidateQueries({ queryKey: ["digests"] });
      qc.setQueryData(["digest", res.name], { markdown: res.markdown });
      setSelected(res.name);
    } catch {
      toast("Digest generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* History rail */}
      <div className="flex w-[220px] shrink-0 flex-col border-r border-hair">
        <div className="flex h-12 items-center gap-2 border-b border-hair px-4">
          <Newspaper size={16} className="text-t2" />
          <span className="text-[14px] font-semibold text-t1">Digests</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {(history ?? []).length === 0 && (
            <div className="px-2 py-3 text-[12px] text-t3">No digests yet.</div>
          )}
          {(history ?? []).map((h) => (
            <button
              key={h.name}
              onClick={() => setSelected(h.name)}
              className={cn(
                "flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left",
                activeName === h.name ? "bg-raised" : "hover:bg-raised/60",
              )}
            >
              <span className="truncate text-[12.5px] text-t1">{h.name}</span>
              <span className="mono text-[10px] text-t3">{relTime(h.ts)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hair px-5">
          <span className="text-[14px] font-medium text-t1">
            {activeName ?? "Daily digest"}
          </span>
          <div className="ml-auto flex overflow-hidden rounded-[6px] border border-hair">
            <button
              onClick={() => void generate("today")}
              disabled={generating}
              className="flex h-7 items-center gap-1.5 bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-50"
            >
              <Sparkles size={13} className={cn(generating && "animate-pulse")} />
              {generating ? "Generating…" : "Generate Today"}
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  disabled={generating}
                  className="flex h-7 w-6 items-center justify-center border-l border-white/20 bg-accent text-white disabled:opacity-50"
                  aria-label="Digest range"
                >
                  <ChevronDown size={13} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className={menuContent}
                  style={menuContentStyle}
                >
                  {RANGE_LABELS.map((r) => (
                    <DropdownMenu.Item
                      key={r.label}
                      className={menuItem}
                      onSelect={() => void generate(r.value)}
                    >
                      {r.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          {generating && !doc ? (
            <div className="p-8 text-center text-[13px] text-t3">
              Reading projects… this can take 30–60s.
            </div>
          ) : doc ? (
            <div
              className="deck-md mx-auto max-w-[760px] px-8 py-6"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.markdown) }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-t3">
              <Newspaper size={28} className="opacity-40" />
              <span className="text-[13px]">
                Generate a digest to see what got done.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
