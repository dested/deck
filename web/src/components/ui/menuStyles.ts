// Shared styling for Radix ContextMenu / DropdownMenu content + items so every
// menu in the app reads identically (§8: bg-overlay, hairline, no stock look).
export const menuContent =
  "z-50 min-w-[184px] rounded-[8px] border border-hair bg-overlay p-1 deck-rise";

export const menuContentStyle = { boxShadow: "var(--shadow-overlay)" } as const;

export const menuItem =
  "flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[13px] text-t1 " +
  "outline-none cursor-default select-none data-[highlighted]:bg-raised " +
  "data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";

export const menuItemDanger =
  menuItem + " text-[color:var(--err)] data-[highlighted]:bg-[rgba(215,84,85,0.12)]";

export const menuSeparator = "my-1 h-px bg-hair";

export const menuLabel =
  "px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3";
