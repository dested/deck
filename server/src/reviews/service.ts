import type { ReviewItem, Session } from "@deck/shared";
import { getState, updateState } from "../state.js";
import { eventHub, topics } from "../ws/events.js";
import { transcriptRegistry } from "../transcripts/registry.js";
import { aiComplete } from "../ai/client.js";

// M11: when an owned claude finishes a burst of work (working → idle/attention),
// capture which files it touched since the last checkpoint and a one-line AI
// summary, surfaced as an Inbox "review" card that jumps into the Git tab.
const CAP = 100;

class ReviewService {
  // Per-session index of how far we've already reviewed (event count).
  private lastReviewedCount = new Map<string, number>();

  onSessionSettled(session: Session) {
    const transcriptId = session.transcriptSessionId;
    if (!transcriptId) return;
    const parsed = transcriptRegistry.getParsed(transcriptId);
    if (!parsed) return;
    const start = this.lastReviewedCount.get(session.id) ?? 0;
    this.lastReviewedCount.set(session.id, parsed.events.length);
    const fresh = parsed.events.slice(start);
    const files = new Set<string>();
    let lastAssistant = "";
    for (const e of fresh) {
      if (e.kind === "tool" && e.isEdit?.path) files.add(e.isEdit.path);
      if (e.kind === "assistant") lastAssistant = e.markdown;
    }
    if (files.size === 0) return;

    const item: ReviewItem = {
      id: session.id,
      sessionId: session.id,
      projectId: session.projectId,
      ts: Date.now(),
      files: [...files],
      summary: null,
      dismissed: false,
    };
    updateState((s) => {
      s.reviews[item.id] = item;
      const all = Object.values(s.reviews);
      if (all.length > CAP) {
        all.sort((a, b) => a.ts - b.ts);
        for (const old of all.slice(0, all.length - CAP)) delete s.reviews[old.id];
      }
    });
    this.broadcast(item);
    void this.generateSummary(item.id, lastAssistant, item.files);
  }

  private async generateSummary(id: string, lastAssistant: string, files: string[]) {
    const prompt =
      `${lastAssistant.slice(0, 2000)}\n\nFiles changed:\n${files.join("\n")}\n\n` +
      "One sentence, past tense, ≤120 chars, describing what was changed. " +
      "Output only the sentence.";
    const res = await aiComplete({ feature: "reviewSummary", prompt, maxTokens: 120 });
    if (!res) return;
    const summary = res.text.trim().replace(/\s+/g, " ").slice(0, 140);
    updateState((s) => {
      if (s.reviews[id]) s.reviews[id]!.summary = summary;
    });
    const updated = getState().reviews[id];
    if (updated && !updated.dismissed) this.broadcast(updated);
  }

  dismiss(id: string): boolean {
    let found = false;
    updateState((s) => {
      if (s.reviews[id]) {
        s.reviews[id]!.dismissed = true;
        found = true;
      }
    });
    if (found) {
      const item = getState().reviews[id];
      if (item) this.broadcast(item);
    }
    return found;
  }

  active(): ReviewItem[] {
    return Object.values(getState().reviews)
      .filter((r) => !r.dismissed)
      .sort((a, b) => b.ts - a.ts);
  }

  private broadcast(item: ReviewItem) {
    eventHub.publish([topics.sessions], { t: "reviews.updated", payload: item });
  }
}

export const reviewService = new ReviewService();
