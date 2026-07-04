import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DiffLines } from "../diff/DiffLines";
import { splitPath } from "../../lib/format";
import { cn } from "../../lib/cn";

export function CommitDiff({ projectId, hash }: { projectId: string; hash: string }) {
  const { data: commit } = useQuery({
    queryKey: ["git", projectId, "show", hash],
    queryFn: () => api.gitShow(projectId, hash),
  });
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (commit && commit.files.length && !path) setPath(commit.files[0]!.path);
  }, [commit, path]);

  const { data: diff } = useQuery({
    queryKey: ["git", projectId, "showfile", hash, path],
    queryFn: () => api.gitShowFile(projectId, hash, path!),
    enabled: !!path,
  });

  if (!commit) return <div className="p-4 text-[13px] text-t3">Loading commit…</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-hair px-4 py-2.5">
        <div className="text-[13px] font-medium text-t1">{commit.subject}</div>
        <div className="mono mt-0.5 text-[11px] text-t3">
          {commit.hash.slice(0, 8)} · {commit.author}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[240px] shrink-0 overflow-y-auto border-r border-hair p-1.5">
          {commit.files.map((f) => {
            const { dir, name } = splitPath(f.path);
            return (
              <button
                key={f.path}
                onClick={() => setPath(f.path)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-[5px] px-2 py-1 text-left text-[12px]",
                  path === f.path ? "bg-raised" : "hover:bg-raised",
                )}
              >
                <span className="mono w-3 text-[11px] text-t3">{f.code}</span>
                <span className="min-w-0 flex-1 truncate">
                  {dir && <span className="text-t3">{dir}</span>}
                  <span className="text-t1">{name}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0 flex-1 overflow-auto" style={{ scrollbarGutter: "stable" }}>
          {diff?.hunks.map((h, i) => (
            <div key={i} className="border-b border-hair">
              <div className="sticky top-0 bg-raised px-3 py-1">
                <span className="mono text-[11.5px] text-t2">{h.header}</span>
              </div>
              <DiffLines lines={h.lines} />
            </div>
          ))}
          {diff && diff.hunks.length === 0 && (
            <div className="p-4 text-[13px] text-t3">No textual changes.</div>
          )}
        </div>
      </div>
    </div>
  );
}
