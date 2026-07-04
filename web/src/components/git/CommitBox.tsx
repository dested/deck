import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import { menuContent, menuContentStyle, menuItem } from "../ui/menuStyles";

export function CommitBox({
  projectId,
  stagedCount,
  onCommitted,
}: {
  projectId: string;
  stagedCount: number;
  onCommitted: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const doCommit = async (amend: boolean) => {
    if (busy) return;
    if (!amend && (!message.trim() || stagedCount === 0)) return;
    setBusy(true);
    try {
      const res = await api.gitCommit(projectId, message.trim() || "amend", amend);
      setMessage("");
      setToast(`Committed ${res.hash}`);
      setTimeout(() => setToast(null), 3000);
      onCommitted();
    } catch (err) {
      setToast(String(err).slice(0, 80));
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(false);
    }
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
        <span className="mono text-[11px] text-t3">
          {stagedCount} staged
        </span>
        {toast && (
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-[color:var(--ok)]">
            <Check size={12} /> {toast}
          </span>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-t3 hover:bg-raised hover:text-t1 data-[state=open]:bg-raised"
              aria-label="More commit options"
            >
              <ChevronDown size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContent} style={menuContentStyle}>
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
