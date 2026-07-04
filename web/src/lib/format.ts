// Relative time as compact tokens: "now", "2m", "3h", "5d". (§8.2)
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

// Split a repo-relative path into dimmed dir prefix + filename. (§6)
export function splitPath(p: string): { dir: string; name: string } {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return { dir: "", name: norm };
  return { dir: norm.slice(0, idx + 1), name: norm.slice(idx + 1) };
}

export function fileName(p: string): string {
  return splitPath(p).name;
}

// Section grouping label for history feeds.
export function dayBucket(ts: number, now = Date.now()): string {
  const day = 86400_000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (ts >= startOfToday.getTime()) return "Today";
  if (ts >= startOfToday.getTime() - day) return "Yesterday";
  if (ts >= now - 7 * day) return "This week";
  if (ts >= now - 30 * day) return "This month";
  return "Older";
}
