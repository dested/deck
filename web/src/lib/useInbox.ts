import { useMemo } from "react";
import type { Session, ReviewItem } from "@deck/shared";
import { useSessionsStore } from "../stores/sessionsStore";
import { useReviewsStore } from "../stores/reviewsStore";
import { useCostReport } from "./useCost";

// One global "needs you" queue derived client-side from the sessions store (+
// M11 reviews + M15 budget). No dedicated server route.
export type InboxKind =
  | "attention"
  | "finished"
  | "exited"
  | "review"
  | "budget";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  projectId: string;
  activityAt: number;
  session?: Session; // session-backed kinds
  review?: ReviewItem; // kind === "review"
  budget?: { blockId: string; text: string }; // kind === "budget"
}

const KIND_RANK: Record<InboxKind, number> = {
  attention: 0,
  review: 1,
  finished: 2,
  exited: 3,
  budget: 4,
};

// Derive the inbox items. Reviews are matched to their idle session; a budget
// alert fires once per active block when its projection exceeds blockUSD.
export function useInboxItems(): InboxItem[] {
  const sessionsById = useSessionsStore((s) => s.byId);
  const reviews = useReviewsStore((s) => s.byId);
  const { data: cost } = useCostReport();

  return useMemo(() => {
    const sessions = Object.values(sessionsById);
    const items: InboxItem[] = [];
    const reviewedSessionIds = new Set<string>();

    // Reviews (non-dismissed) — show as their own card, jumping into Git.
    for (const r of Object.values(reviews)) {
      if (r.dismissed) continue;
      reviewedSessionIds.add(r.sessionId);
      items.push({
        id: "review:" + r.id,
        kind: "review",
        projectId: r.projectId,
        activityAt: r.ts,
        review: r,
      });
    }

    for (const s of sessions) {
      if (s.status === "attention") {
        items.push({
          id: "att:" + s.id,
          kind: "attention",
          projectId: s.projectId,
          activityAt: s.activityAt,
          session: s,
        });
      } else if (
        s.source === "owned" &&
        s.unread &&
        s.status === "idle" &&
        !reviewedSessionIds.has(s.id)
      ) {
        items.push({
          id: "fin:" + s.id,
          kind: "finished",
          projectId: s.projectId,
          activityAt: s.activityAt,
          session: s,
        });
      } else if (
        s.source === "owned" &&
        s.status === "exited" &&
        s.exitCode !== 0 &&
        s.exitCode != null
      ) {
        items.push({
          id: "exit:" + s.id,
          kind: "exited",
          projectId: s.projectId,
          activityAt: s.activityAt,
          session: s,
        });
      }
    }

    // Budget alert (M15): one item per active block projected over blockUSD.
    const budgets = cost?.available ? cost.budgets : undefined;
    if (budgets && budgets.blockUSD != null && cost?.activeBlock?.projection) {
      const projected = cost.activeBlock.projection.totalCost;
      if (projected > budgets.blockUSD) {
        const endMin = new Date(cost.activeBlock.endTime).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        items.push({
          id: "budget:" + cost.activeBlock.id,
          kind: "budget",
          projectId: "",
          activityAt: cost.activeBlock.startTime,
          budget: {
            blockId: cost.activeBlock.id,
            text: `Current block projected $${projected.toFixed(2)} by ${endMin}`,
          },
        });
      }
    }

    items.sort((a, b) => {
      const r = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (r !== 0) return r;
      return b.activityAt - a.activityAt;
    });
    return items;
  }, [sessionsById, reviews, cost]);
}

// Badge count for the Rail bell: attention + finished + review + budget
// (actionable items). Exited errors are informational and excluded.
export function useInboxCount(): number {
  const items = useInboxItems();
  return items.filter((i) => i.kind !== "exited").length;
}
