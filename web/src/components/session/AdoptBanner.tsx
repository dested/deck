import { useState } from "react";
import { Radio, ChevronDown } from "lucide-react";
import type { Session } from "@deck/shared";
import { Button } from "../ui/Button";
import { api } from "../../lib/api";
import { useUIStore } from "../../stores/uiStore";

// §7.5 read-only banner + Adopt migration path (adopt endpoint lands in M4).
export function AdoptBanner({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  const openSession = useUIStore((s) => s.openSession);

  const adopt = async () => {
    try {
      const s = await api.adoptSession(session.id);
      openSession(s.id);
    } catch {
      /* M4 */
    }
  };

  return (
    <div className="shrink-0 border-b border-hair bg-panel px-5 py-2">
      <div className="flex items-center gap-2 text-[12.5px] text-t2">
        <Radio size={13} className="text-t3" />
        <span>Read-only — running in an external terminal</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-[12px] text-t3 hover:text-t2"
          >
            How <ChevronDown size={12} />
          </button>
          <Button size="sm" variant="default" onClick={adopt}>
            Adopt…
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 max-w-[560px] text-[12px] leading-[1.5] text-t3">
          Adopting kills nothing on its own. Close this session in Windows
          Terminal first, then Deck restarts it as an app-owned terminal via{" "}
          <span className="mono text-t2">claude --resume {session.id.slice(0, 8)}…</span>{" "}
          so you can drive it from here.
        </div>
      )}
    </div>
  );
}
