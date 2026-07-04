// Bounded ring of raw terminal output, capped by total UTF-8 char length.
// Used as the reattach fallback if headless-serialize misbehaves (§5.3).
export class RingBuffer {
  private chunks: string[] = [];
  private total = 0;
  constructor(private readonly max: number) {}

  push(s: string) {
    this.chunks.push(s);
    this.total += s.length;
    while (this.total > this.max && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.total -= removed.length;
    }
    // If a single chunk exceeds max, keep only its tail.
    if (this.total > this.max && this.chunks.length === 1) {
      const only = this.chunks[0]!;
      const tail = only.slice(only.length - this.max);
      this.chunks[0] = tail;
      this.total = tail.length;
    }
  }

  snapshot(): string {
    return this.chunks.join("");
  }

  clear() {
    this.chunks = [];
    this.total = 0;
  }
}
