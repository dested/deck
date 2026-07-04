import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitCommit } from "lucide-react";
import { api } from "../../lib/api";
import { relTime } from "../../lib/format";
import { cn } from "../../lib/cn";

export function LogPanel({
  projectId,
  onSelectCommit,
  selectedHash,
}: {
  projectId: string;
  onSelectCommit: (hash: string) => void;
  selectedHash: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { data: commits } = useQuery({
    queryKey: ["git", projectId, "log"],
    queryFn: () => api.gitLog(projectId, 50),
    enabled: open,
  });

  return (
    <div className="border-t border-hair">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-t2 hover:text-t1"
      >
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
        <GitCommit size={13} />
        <span className="text-[12px] font-medium">History</span>
      </button>
      {open && (
        <div className="max-h-[240px] overflow-y-auto px-1 pb-2">
          {!commits && <div className="px-3 py-1 text-[12px] text-t3">Loading…</div>}
          {commits?.map((c) => (
            <button
              key={c.hash}
              onClick={() => onSelectCommit(c.hash)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[5px] px-2 py-1 text-left",
                selectedHash === c.hash ? "bg-raised" : "hover:bg-raised",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-t1">{c.subject}</span>
              <span className="mono shrink-0 text-[10.5px] text-t3">{relTime(c.date)}</span>
              <span className="mono shrink-0 text-[10.5px] text-t2">{c.shortHash}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
