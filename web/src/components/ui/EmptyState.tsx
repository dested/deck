import type { ReactNode } from "react";
import { Button } from "./Button";

// §8.5: one quiet sentence + one action. No illustrations.
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {icon && <div className="text-t3">{icon}</div>}
      <div className="text-[14px] font-medium text-t1">{title}</div>
      {hint && <div className="max-w-[380px] text-[13px] text-t2">{hint}</div>}
      {action && (
        <Button variant="primary" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
