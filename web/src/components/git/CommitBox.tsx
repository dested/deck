import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Check, ArrowUp } from "lucide-react";
import type { AheadBehind } from "@deck/shared";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import { menuContent, menuContentStyle, menuItem } from "../ui/menuStyles";

export function CommitBox({
  projectId,
  stagedCount,
  aheadBehind,
  hasUpstream,
  onCommitted,
}: {
  projectId: string;
  stagedCount: number;
  aheadBehind: AheadBehind | null;
  hasUpstream: boolean;
  onCommitted: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const ahead = aheadBehind?.ahead ?? 0;
  // Something to push when the branch is ahead, or it has no upstream yet
  // (first push sets one). Nothing to do when tracking and up to date.
  const canPush = ahead > 0 || !hasUpstream;

  const flash = (msg: string, isErr = false) => {
    setErr(isErr);
    setToast(msg);
    setTimeout(() => setToast(null), isErr ? 4000 : 3000);
  };

  const doCommit = async (amend: boolean): Promise<boolean> => {
    if (busy) return false;
    if (!amend && (!message.trim() || stagedCount === 0)) return false;
    setBusy(true);
    try {
      const res = await api.gitCommit(projectId, message.trim() || "amend", amend);
      setMessage("");
      flash(`Committed ${res.hash}`);
      onCommitted();
      return true;
    } catch (e) {
      flash(String(e).slice(0, 80), true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doPush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.gitPush(projectId);
      flash(res.output.split("\n").pop()?.slice(0, 80) || "Pushed");
      onCommitted();
    } catch (e) {
      flash(String(e).slice(0, 90), true);
    } finally {
      setBusy(false);
    }
  };

  const doCommitAndPush = async () => {
    if (await doCommit(false)) await doPush();
  };

  return (
    <div className="border-t border-hair p-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void doCommit(false);
          }
        }}
        placeholder="Commit message"
        rows={2}
        className="max-h-[120px] min-h-[52px] w-full resize-y rounded-[6px] border border-hair bg-raised px-2.5 py-2 text-[13px] text-t1 placeholder:text-t3 focus:border-hairfocus focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!message.trim() || stagedCount === 0 || busy}
          onClick={() => void doCommit(false)}
        >
          Commit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !canPush}
          onClick={() => void doPush()}
          title={
            !hasUpstream
              ? "Push and set upstream on origin"
              : ahead > 0
                ? `Push ${ahead} commit${ahead === 1 ? "" : "s"}`
                : "Nothing to push"
          }
        >
          <ArrowUp size={13} />
          Push{ahead > 0 ? ` ${ahead}` : ""}
        </Button>
        {toast && (
          <span
            className={
              "ml-auto flex items-center gap-1 text-[11.5px] " +
              (err ? "text-[color:var(--err)]" : "text-[color:var(--ok)]")
            }
          >
            {!err && <Check size={12} />} {toast}
          </span>
        )}
        {!toast && (
          <span className="mono ml-auto text-[11px] text-t3">
            {stagedCount} staged
          </span>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1 data-[state=open]:bg-raised"
              aria-label="More commit options"
            >
              <ChevronDown size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContent} style={menuContentStyle}>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() => void doCommitAndPush()}
              >
                Commit &amp; push
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItem} onSelect={() => void doCommit(true)}>
                Amend last commit
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
