import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { api } from "../../lib/api";
import { eventsClient } from "../../lib/ws";
import { useUIStore } from "../../stores/uiStore";
import { EmptyState } from "../ui/EmptyState";
import { StatusList, type SelectedFile } from "./StatusList";
import { DiffViewer } from "./DiffViewer";
import { CommitBox } from "./CommitBox";
import { LogPanel } from "./LogPanel";
import { CommitDiff } from "./CommitDiff";

// §6 git panel: left column (status + commit + log), right master-detail diff.
export function GitTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [commitHash, setCommitHash] = useState<string | null>(null);

  useEffect(() => {
    eventsClient.subscribe([`git:${projectId}`]);
    return () => eventsClient.unsubscribe([`git:${projectId}`]);
  }, [projectId]);

  const { data: status } = useQuery({
    queryKey: ["git", projectId, "status"],
    queryFn: () => api.gitStatus(projectId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["git", projectId] });

  // Keep the selected file valid as status changes.
  useEffect(() => {
    if (!status || !file) return;
    const inStaged = status.staged.some((e) => e.path === file.path);
    const inChanges = [...status.unstaged, ...status.conflicted].some(
      (e) => e.path === file.path,
    );
    if (file.staged && !inStaged && inChanges) setFile({ ...file, staged: false });
    else if (!file.staged && !inChanges && inStaged) setFile({ ...file, staged: true });
    else if (!inStaged && !inChanges) setFile(null);
  }, [status, file]);

  const selectFile = (f: SelectedFile) => {
    setCommitHash(null);
    setFile(f);
  };
  const selectCommit = (h: string) => {
    setFile(null);
    setCommitHash(h);
  };

  const openInFiles = (path: string) => {
    useUIStore.getState().requestFile(projectId, path);
    useUIStore.getState().openProject(projectId, "files");
  };

  return (
    <div className="flex h-full">
      {/* Left column */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-hair">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {status ? (
            <StatusList
              status={status}
              selected={file}
              onSelect={selectFile}
              onStage={async (p) => {
                await api.gitStage(projectId, p);
                refresh();
              }}
              onUnstage={async (p) => {
                await api.gitUnstage(projectId, p);
                refresh();
              }}
              onDiscard={async (p) => {
                await api.gitDiscard(projectId, p);
                refresh();
              }}
              onOpenFile={openInFiles}
            />
          ) : (
            <div className="p-2 text-[13px] text-t3">Loading status…</div>
          )}
        </div>
        <CommitBox
          projectId={projectId}
          stagedCount={status?.staged.length ?? 0}
          onCommitted={refresh}
        />
        <LogPanel
          projectId={projectId}
          onSelectCommit={selectCommit}
          selectedHash={commitHash}
        />
      </div>

      {/* Right: diff viewer */}
      <div className="min-w-0 flex-1">
        {commitHash ? (
          <CommitDiff projectId={projectId} hash={commitHash} />
        ) : file ? (
          <DiffViewer projectId={projectId} file={file} onChanged={refresh} />
        ) : (
          <EmptyState
            icon={<GitBranch size={22} />}
            title="No file selected"
            hint="Select a changed file to view its diff, or a commit from history."
          />
        )}
      </div>
    </div>
  );
}
