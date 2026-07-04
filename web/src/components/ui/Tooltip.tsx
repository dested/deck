import * as RTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

// 300ms-delay tooltip on every icon-only button (§8.5).
export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-[6px] border border-hair bg-overlay px-2 py-1 text-[12px] text-t1 deck-fade-in"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          {label}
          <RTooltip.Arrow className="fill-[#1e2026]" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  );
}
