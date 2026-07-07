import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { eventsClient } from "../../lib/ws";
import { useUIStore } from "../../stores/uiStore";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { StatusList, type SelectedFile } from "./StatusList";
import { DiffViewer } from "./DiffViewer";
import { CommitBox } from "./CommitBox";
import { LogPanel } from "./LogPanel";
import { CommitDiff } from "./CommitDiff";
import { AuditPanel } from "./AuditPanel";

// Risk badge colors for the PR Audit row (mirrors AuditPanel's RISK map).
const AUDIT_BADGE: Record<string, string> = {
  low: "bg-[rgba(70,180,134,0.14)] text-[color:var(--ok)]",
  medium: "bg-[rgba(217,160,63,0.14)] text-[color:var(--warn)]",
  high: "bg-[rgba(215,84,85,0.16)] text-[color:var(--err)]",
};

// §6 git panel: left column (status + commit + log), right master-detail diff.
export function GitTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [commitHash, setCommitHash] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => {
    eventsClient.subscribe([`git:${projectId}`]);
    return () => eventsClient.unsubscribe([`git:${projectId}`]);
  }, [projectId]);

  const { data: status } = useQuery({
    queryKey: ["git", projectId, "status"],
    queryFn: () => api.gitStatus(projectId),
  });

  // Cached PR-audit report (shared query key with AuditPanel) — drives the
  // risk badge on the audit row before the panel is even opened.
  const { data: auditState } = useQuery({
    queryKey: ["git", projectId, "audit"],
    queryFn: () => api.gitAuditState(projectId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["git", projectId] });

  // M11: when a review card focuses a file, select it in the diff, then clear.
  const gitFocusPath = useUIStore((s) => s.gitFocusPath);
  const setGitFocusPath = useUIStore((s) => s.setGitFocusPath);
  useEffect(() => {
    if (!gitFocusPath || gitFocusPath.projectId !== projectId || !status) return;
    const path = gitFocusPath.path;
    const inStaged = status.staged.some((e) => e.path === path);
    const inChanges = [...status.unstaged, ...status.conflicted].some(
      (e) => e.path === path,
    );
    if (inStaged || inChanges) {
      setAuditOpen(false);
      setCommitHash(null);
      setFile({ path, staged: inStaged && !inChanges });
    }
    setGitFocusPath(null);
  }, [gitFocusPath, projectId, status, setGitFocusPath]);

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
    setAuditOpen(false);
    setCommitHash(null);
    setFile(f);
  };
  const selectCommit = (h: string) => {
    setAuditOpen(false);
    setFile(null);
    setCommitHash(h);
  };

  const openInFiles = (path: string) => {
    useUIStore.getState().requestFile(projectId, path);
    useUIStore.getState().openProject(projectId, "files");
  };

  // Audit finding chips: jump to the file's diff when it's in the change set,
  // otherwise fall back to the Files tab (branch-scope audits, committed files).
  const openAuditFile = (path: string) => {
    if (!status) return openInFiles(path);
    const inStaged = status.staged.some((e) => e.path === path);
    const inChanges = [...status.unstaged, ...status.conflicted].some(
      (e) => e.path === path,
    );
    if (inStaged || inChanges) {
      selectFile({ path, staged: inStaged && !inChanges });
    } else {
      openInFiles(path);
    }
  };

  const auditRisk = auditState?.report?.risk.level ?? null;

  return (
    <div className="flex h-full">
      {/* Left column */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-hair">
        {/* PR Audit row */}
        <button
          onClick={() => {
            setFile(null);
            setCommitHash(null);
            setAuditOpen(true);
          }}
          className={cn(
            "flex w-full items-center gap-2 border-b border-hair px-3 py-2 text-left text-[12.5px]",
            auditOpen
              ? "bg-raised text-t1"
              : "text-t2 hover:bg-panel hover:text-t1",
          )}
        >
          <ShieldCheck
            size={14}
            className={cn(auditOpen && "text-accenttext")}
          />
          <span className="font-medium">PR Audit</span>
          {auditRisk && (
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-bold tracking-wide",
                AUDIT_BADGE[auditRisk],
              )}
            >
              {auditRisk.toUpperCase()}
            </span>
          )}
          {auditState?.stale && (
            <span
              title="Diff changed since the last audit"
              className="h-1.5 w-1.5 rounded-full bg-[color:var(--warn)]"
            />
          )}
        </button>
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
          dirty={
            (status?.staged.length ?? 0) > 0 ||
            (status?.unstaged.length ?? 0) > 0 ||
            (status?.conflicted.length ?? 0) > 0
          }
          aheadBehind={status?.aheadBehind ?? null}
          hasUpstream={!!status?.upstream}
          onCommitted={refresh}
        />
        <LogPanel
          projectId={projectId}
          onSelectCommit={selectCommit}
          selectedHash={commitHash}
        />
      </div>

      {/* Right: audit / diff viewer */}
      <div className="min-w-0 flex-1">
        {auditOpen ? (
          <AuditPanel projectId={projectId} onOpenFile={openAuditFile} />
        ) : commitHash ? (
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
