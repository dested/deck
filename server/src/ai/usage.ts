import fs from "node:fs";
import path from "node:path";
import type { AiUsageEntry, AiUsageReport, AiFeatureId } from "@deck/shared";
import { config } from "../config.js";

// Append-only usage ledger at ~/.deck/ai-usage.jsonl. One line per AI call
// (success AND failure). Kept in memory (last 90 days) for cheap reporting; the
// file is never truncated but rotates to ai-usage.<year>.jsonl past 5MB.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ROTATE_BYTES = 5 * 1024 * 1024;

class UsageLedger {
  private entries: AiUsageEntry[] = [];
  private loaded = false;

  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(config.aiUsageFile, "utf8");
      const cutoff = Date.now() - NINETY_DAYS_MS;
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const e = JSON.parse(t) as AiUsageEntry;
          if (typeof e.ts === "number" && e.ts >= cutoff) this.entries.push(e);
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* no ledger yet */
    }
  }

  recordUsage(entry: AiUsageEntry) {
    this.load();
    this.entries.push(entry);
    // Trim in-memory to 90 days so long-running servers don't grow unbounded.
    const cutoff = Date.now() - NINETY_DAYS_MS;
    if (this.entries.length > 5000 && this.entries[0]!.ts < cutoff) {
      this.entries = this.entries.filter((e) => e.ts >= cutoff);
    }
    try {
      fs.mkdirSync(config.deckStateDir, { recursive: true });
      this.maybeRotate();
      fs.appendFileSync(config.aiUsageFile, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      console.warn("[ai-usage] append failed:", err);
    }
  }

  private maybeRotate() {
    try {
      const st = fs.statSync(config.aiUsageFile);
      if (st.size < ROTATE_BYTES) return;
      const year = new Date().getFullYear();
      const rotated = path.join(config.deckStateDir, `ai-usage.${year}.jsonl`);
      // Append to the year file (may already exist) then truncate the live one.
      const data = fs.readFileSync(config.aiUsageFile, "utf8");
      fs.appendFileSync(rotated, data, "utf8");
      fs.writeFileSync(config.aiUsageFile, "", "utf8");
    } catch {
      /* rotation best-effort */
    }
  }

  private midnightMs(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Sum of costUSD since local midnight, optionally per feature.
  spentToday(feature?: AiFeatureId): number {
    this.load();
    const since = this.midnightMs();
    let sum = 0;
    for (const e of this.entries) {
      if (e.ts < since) continue;
      if (feature && e.feature !== feature) continue;
      sum += e.costUSD || 0;
    }
    return sum;
  }

  callsToday(feature?: AiFeatureId): number {
    this.load();
    const since = this.midnightMs();
    let n = 0;
    for (const e of this.entries) {
      if (e.ts < since) continue;
      if (feature && e.feature !== feature) continue;
      n += 1;
    }
    return n;
  }

  usageReport(days: number): AiUsageReport {
    this.load();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.entries.filter((e) => e.ts >= since);
    const byFeature: AiUsageReport["byFeature"] = {};
    const byModel: AiUsageReport["byModel"] = {};
    const byDayMap = new Map<string, { cost: number; calls: number }>();
    let totalCost = 0;
    for (const e of rows) {
      totalCost += e.costUSD || 0;
      const f = (byFeature[e.feature] ??= { calls: 0, cost: 0, tokens: 0 });
      f.calls += 1;
      f.cost += e.costUSD || 0;
      f.tokens += (e.inputTokens || 0) + (e.outputTokens || 0);
      const m = (byModel[e.model] ??= { calls: 0, cost: 0 });
      m.calls += 1;
      m.cost += e.costUSD || 0;
      const date = new Date(e.ts).toISOString().slice(0, 10);
      const d = byDayMap.get(date) ?? { cost: 0, calls: 0 };
      d.cost += e.costUSD || 0;
      d.calls += 1;
      byDayMap.set(date, d);
    }
    const byDay = [...byDayMap.entries()]
      .map(([date, v]) => ({ date, cost: v.cost, calls: v.calls }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const recent = rows.slice(-100).reverse();
    return { totalCost, days, byFeature, byModel, byDay, recent };
  }

  // Per-day AI cost map (YYYY-MM-DD -> cost) for the cost dashboard (M15).
  dailyCostMap(days: number): Map<string, number> {
    this.load();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const out = new Map<string, number>();
    for (const e of this.entries) {
      if (e.ts < since) continue;
      const date = new Date(e.ts).toISOString().slice(0, 10);
      out.set(date, (out.get(date) ?? 0) + (e.costUSD || 0));
    }
    return out;
  }
}

export const usageLedger = new UsageLedger();
