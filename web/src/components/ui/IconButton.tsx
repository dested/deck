import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  side?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, children, active, danger, side = "bottom", className, ...rest }, ref) => (
    <Tooltip label={label} side={side}>
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-t2 transition-colors",
          "hover:bg-raised hover:text-t1",
          active && "bg-raised text-t1",
          danger && "hover:text-[color:var(--err)]",
          "disabled:opacity-40 disabled:pointer-events-none",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
