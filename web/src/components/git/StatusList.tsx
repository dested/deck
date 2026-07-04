import { useState } from "react";
import { Plus, Minus, Trash2, FileText } from "lucide-react";
import type { GitStatus, GitFileEntry, GitStatusCode } from "@deck/shared";
import { splitPath } from "../../lib/format";
import { cn } from "../../lib/cn";

export interface SelectedFile {
  path: string;
  staged: boolean;
}

const GLYPH_COLOR: Record<GitStatusCode, string> = {
  A: "var(--ok)",
  "?": "var(--ok)",
  M: "var(--warn)",
  T: "var(--warn)",
  D: "var(--err)",
  U: "var(--err)",
  R: "var(--accent)",
  C: "var(--accent)",
};

export function StatusList({
  status,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: {
  status: GitStatus;
  selected: SelectedFile | null;
  onSelect: (f: SelectedFile) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onOpenFile: (path: string) => void;
}) {
  const changes = [...status.conflicted, ...status.unstaged];
  return (
    <div className="flex flex-col gap-3">
      {status.staged.length > 0 && (
        <Section
          title="Staged"
          count={status.staged.length}
          headerAction={
            <button
              onClick={() => onUnstage(status.staged.map((e) => e.path))}
              className="text-[11px] text-t3 hover:text-t1"
            >
              Unstage all
            </button>
          }
        >
          {status.staged.map((e) => (
            <Row
              key={"s" + e.path}
              entry={e}
              staged
              selected={selected?.staged === true && selected.path === e.path}
              onSelect={() => onSelect({ path: e.path, staged: true })}
              onPrimary={() => onUnstage([e.path])}
              onOpenFile={() => onOpenFile(e.path)}
            />
          ))}
        </Section>
      )}
      <Section
        title="Changes"
        count={changes.length}
        headerAction={
          changes.length > 0 ? (
            <button
              onClick={() => onStage(changes.map((e) => e.path))}
              className="text-[11px] text-t3 hover:text-t1"
            >
              Stage all
            </button>
          ) : null
        }
      >
        {changes.length === 0 && (
          <div className="px-2 py-1 text-[12px] text-t3">No changes</div>
        )}
        {changes.map((e) => (
          <Row
            key={"c" + e.path}
            entry={e}
            staged={false}
            selected={selected?.staged === false && selected.path === e.path}
            onSelect={() => onSelect({ path: e.path, staged: false })}
            onPrimary={() => onStage([e.path])}
            onDiscard={() => onDiscard([e.path])}
            onOpenFile={() => onOpenFile(e.path)}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  headerAction,
  children,
}: {
  title: string;
  count: number;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="section-label">{title}</span>
        <span className="mono text-[11px] text-t3">{count}</span>
        <span className="ml-auto">{headerAction}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({
  entry,
  staged,
  selected,
  onSelect,
  onPrimary,
  onDiscard,
  onOpenFile,
}: {
  entry: GitFileEntry;
  staged: boolean;
  selected: boolean;
  onSelect: () => void;
  onPrimary: () => void;
  onDiscard?: () => void;
  onOpenFile: () => void;
}) {
  const { dir, name } = splitPath(entry.path);
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex h-[26px] cursor-default items-center gap-2 rounded-[5px] px-2 text-[12.5px]",
        selected ? "bg-raised" : "hover:bg-raised",
      )}
    >
      <span
        className="mono w-3 shrink-0 text-center text-[11px] font-semibold"
        style={{ color: GLYPH_COLOR[entry.code] }}
      >
        {entry.untracked ? "U" : entry.code}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {dir && <span className="text-t3">{dir}</span>}
        <span className="text-t1">{name}</span>
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <IconBtn label="Open" onClick={(e) => { e.stopPropagation(); onOpenFile(); }}>
          <FileText size={13} />
        </IconBtn>
        {onDiscard &&
          (confirm ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDiscard();
                setConfirm(false);
              }}
              className="rounded px-1 text-[11px] text-[color:var(--err)] hover:bg-[rgba(215,84,85,0.12)]"
            >
              Sure?
            </button>
          ) : (
            <IconBtn
              label="Discard"
              danger
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(true);
                setTimeout(() => setConfirm(false), 3000);
              }}
            >
              <Trash2 size={13} />
            </IconBtn>
          ))}
        <IconBtn
          label={staged ? "Unstage" : "Stage"}
          onClick={(e) => {
            e.stopPropagation();
            onPrimary();
          }}
        >
          {staged ? <Minus size={14} /> : <Plus size={14} />}
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  danger,
  label,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-[4px] text-t3 hover:bg-hair hover:text-t1",
        danger && "hover:text-[color:var(--err)]",
      )}
    >
      {children}
    </button>
  );
}
