import { useRef, useState, useLayoutEffect } from "react";
import { CornerDownLeft } from "lucide-react";
import { api } from "../../lib/api";
import { PromptToolbar } from "../prompt/PromptToolbar";

// §7.5 composer: single line growing to multiline. Enter sends (bracketed-paste
// into the PTY server-side), Shift+Enter inserts a newline.
export function Composer({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  const send = async () => {
    const t = text;
    if (!t.trim() || sending) return;
    setSending(true);
    setText("");
    try {
      await api.sendInput(sessionId, t, true);
    } catch {
      setText(t); // restore on failure
    } finally {
      setSending(false);
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  return (
    <div className="shrink-0 border-t border-hair bg-panel px-4 py-3">
      <div className="flex items-end gap-2 rounded-[8px] border border-hair bg-raised px-3 py-2 focus-within:border-hairfocus">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message this session…"
          className="max-h-[200px] flex-1 resize-none bg-transparent text-[13px] leading-[1.5] text-t1 placeholder:text-t3 focus:outline-none"
        />
        <PromptToolbar
          value={text}
          onChange={setText}
          projectId={projectId}
          textareaRef={ref}
        />
        <button
          onClick={() => void send()}
          disabled={!text.trim()}
          className="flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2 text-[12px] font-medium text-white transition disabled:opacity-40"
        >
          <CornerDownLeft size={13} /> Send
        </button>
      </div>
    </div>
  );
}
