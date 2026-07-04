import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Files } from "lucide-react";
import { api } from "../../lib/api";
import { useUIStore } from "../../stores/uiStore";
import { FileTree } from "../files/FileTree";
import { EmptyState } from "../ui/EmptyState";

const FileEditor = lazy(() => import("../files/FileEditor"));

export function FilesTab({ projectId }: { projectId: string }) {
  const [path, setPath] = useState<string | null>(null);

  // "Open in Files" from the git panel routes a path here.
  useEffect(() => {
    const pending = useUIStore.getState().consumeFile(projectId);
    if (pending) setPath(pending);
  }, [projectId]);

  // Amber dots on git-modified files.
  const { data: status } = useQuery({
    queryKey: ["git", projectId, "status"],
    queryFn: () => api.gitStatus(projectId),
  });
  const modified = useMemo(() => {
    const s = new Set<string>();
    if (status) {
      for (const e of [...status.staged, ...status.unstaged, ...status.conflicted]) {
        s.add(e.path);
      }
    }
    return s;
  }, [status]);

  return (
    <div className="flex h-full">
      <div className="w-[280px] shrink-0 border-r border-hair">
        <FileTree
          projectId={projectId}
          selectedPath={path}
          onSelect={setPath}
          modifiedPaths={modified}
        />
      </div>
      <div className="min-w-0 flex-1">
        {path ? (
          <Suspense fallback={<div className="p-4 text-[13px] text-t3">Loading editor…</div>}>
            <FileEditor key={path} projectId={projectId} path={path} />
          </Suspense>
        ) : (
          <EmptyState
            icon={<Files size={22} />}
            title="No file open"
            hint="Select a file from the tree to view and edit it."
          />
        )}
      </div>
    </div>
  );
}
