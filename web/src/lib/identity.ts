// Deterministic visual identity for projects that have no screenshot yet:
// a stable two-hue gradient + initials derived from the project name, so
// every card/rail avatar is visually distinct even before it has a face.

function hash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function projectHue(name: string): number {
  return hash(name) % 360;
}

export function projectGradient(name: string): string {
  const h1 = projectHue(name);
  const h2 = (h1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${h1} 45% 30%) 0%, hsl(${h2} 55% 16%) 100%)`;
}

// Solid accent for tiny UI (rail avatar ring, dots).
export function projectColor(name: string): string {
  return `hsl(${projectHue(name)} 55% 55%)`;
}

// "agent-community" -> "AC", "deck" -> "DE", "my-site.gg" -> "MS"
export function projectInitials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
