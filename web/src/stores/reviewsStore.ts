import { useEffect } from "react";
import { create } from "zustand";
import type { ReviewItem } from "@deck/shared";
import { api } from "../lib/api";

// M11 review-queue items, keyed by id (== sessionId). Bootstrapped from
// GET /reviews and kept fresh by ws.ts on `reviews.updated` (replace-by-id).
interface ReviewsState {
  byId: Record<string, ReviewItem>;
  loaded: boolean;
  setAll: (items: ReviewItem[]) => void;
  upsert: (r: ReviewItem) => void;
  remove: (id: string) => void;
}

export const useReviewsStore = create<ReviewsState>((set) => ({
  byId: {},
  loaded: false,
  setAll: (items) =>
    set({ byId: Object.fromEntries(items.map((r) => [r.id, r])), loaded: true }),
  upsert: (r) =>
    set((st) => {
      if (r.dismissed) {
        const next = { ...st.byId };
        delete next[r.id];
        return { byId: next };
      }
      return { byId: { ...st.byId, [r.id]: r } };
    }),
  remove: (id) =>
    set((st) => {
      const next = { ...st.byId };
      delete next[id];
      return { byId: next };
    }),
}));

export function useReviewsBootstrap() {
  const setAll = useReviewsStore((s) => s.setAll);
  useEffect(() => {
    api.reviews().then(setAll).catch(() => {});
  }, [setAll]);
}
