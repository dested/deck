import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "default" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:brightness-110 border border-transparent",
  default:
    "bg-raised text-t1 hover:bg-overlay border border-hair hover:border-hairfocus",
  ghost: "bg-transparent text-t2 hover:bg-raised hover:text-t1 border border-transparent",
  danger:
    "bg-transparent text-[color:var(--err)] hover:bg-[rgba(215,84,85,0.12)] border border-transparent",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "default", size = "md", className, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium transition-colors whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
        VARIANTS[variant],
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
