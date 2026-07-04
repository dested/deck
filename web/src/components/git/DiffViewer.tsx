import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, Rows3 } from "lucide-react";
import type { Hunk } from "@deck/shared";
import { api } from "../../lib/api";
import { DiffLines } from "../diff/DiffLines";
import { cn } from "../../lib/cn";
import type { SelectedFile } from "./StatusList";

const MonacoDiff = lazy(() => import("./MonacoDiff"));

export function DiffViewer({
  projectId,
  file,
  onChanged,
}: {
  projectId: string;
  file: SelectedFile;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"hunk" | "full">("hunk");
  const { data: diff, isLoading } = useQuery({
    queryKey: ["git", projectId, "diff", file.path, file.staged],
    queryFn: () => api.gitDiff(projectId, file.path, file.staged),
  });

  const stageHunk = async (h: Hunk) => {
    const patch = (diff?.fileHeader ?? "") + "\n" + h.patch + "\n";
    if (file.staged) await api.gitUnstageHunk(projectId, file.path, h.header, patch);
    else await api.gitStageHunk(projectId, file.path, h.header, patch);
    onChanged();
  };
  const discardHunk = async (h: Hunk) => {
    const patch = (diff?.fileHeader ?? "") + "\n" + h.patch + "\n";
    await api.gitDiscardHunk(projectId, file.path, h.header, patch);
    onChanged();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hair px-3">
        <span className="mono truncate text-[12px] text-t1">{file.path}</span>
        {file.staged && (
          <span className="rounded-[4px] bg-raised px-1.5 py-0.5 text-[10.5px] text-t2">
            staged
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Toggle active={mode === "hunk"} onClick={() => setMode("hunk")} label="Hunks">
            <Rows3 size={13} />
          </Toggle>
          <Toggle active={mode === "full"} onClick={() => setMode("full")} label="Full file">
            <FileCode2 size={13} />
          </Toggle>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading && <div className="p-4 text-[13px] text-t3">Loading diff…</div>}
        {diff?.binary && (
          <div className="p-4 text-[13px] text-t3">Binary file — no text diff.</div>
        )}
        {diff && !diff.binary && mode === "hunk" && (
          <div className="h-full overflow-auto" style={{ scrollbarGutter: "stable" }}>
            {diff.hunks.length === 0 && (
              <div className="p-4 text-[13px] text-t3">No changes.</div>
            )}
            {diff.hunks.map((h, i) => (
              <div key={i} className="border-b border-hair">
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-raised px-3 py-1">
                  <span className="mono truncate text-[11.5px] text-t2">{h.header}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <HunkBtn onClick={() => stageHunk(h)}>
                      {file.staged ? "Unstage hunk" : "Stage hunk"}
                    </HunkBtn>
                    {!file.staged && (
                      <HunkBtn danger onClick={() => discardHunk(h)}>
                        Discard hunk
                      </HunkBtn>
                    )}
                  </div>
                </div>
                <DiffLines lines={h.lines} />
              </div>
            ))}
          </div>
        )}
        {diff && !diff.binary && mode === "full" && (
          <Suspense fallback={<div className="p-4 text-[13px] text-t3">Loading editor…</div>}>
            <MonacoDiff projectId={projectId} path={file.path} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11.5px]",
        active ? "bg-raised text-t1" : "text-t3 hover:bg-raised hover:text-t1",
      )}
    >
      {children}
    </button>
  );
}

function HunkBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-[4px] px-1.5 py-0.5 text-[11px] text-t2 hover:bg-hair hover:text-t1",
        danger && "hover:text-[color:var(--err)]",
      )}
    >
      {children}
    </button>
  );
}
