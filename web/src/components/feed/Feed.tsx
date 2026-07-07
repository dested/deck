import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import type { TranscriptEvent } from "@deck/shared";
import { api } from "../../lib/api";
import { eventsClient, onTranscriptAppend } from "../../lib/ws";
import { useUIStore } from "../../stores/uiStore";
import { FeedEvent } from "./FeedEvent";

const CAP_PAGES = 30; // up to ~6000 events loaded up front

// Virtualized transcript feed (§9.3). Loads the whole transcript via the
// backward-paginated endpoint, then live-appends via the transcript topic.
export function Feed({
  sessionId,
  transcriptId,
}: {
  sessionId: string;
  transcriptId: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
    getItemKey: (i) => events[i]?.id ?? i,
  });

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Initial full load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEvents([]);
    (async () => {
      if (!transcriptId) {
        if (!cancelled) setLoading(false);
        return;
      }
      let all: TranscriptEvent[] = [];
      let before: number | undefined = undefined;
      for (let i = 0; i < CAP_PAGES; i++) {
        let page;
        try {
          page = await api.transcript(sessionId, before);
        } catch {
          break;
        }
        if (cancelled) return;
        all = [...page.events, ...all];
        if (!page.hasMore) break;
        before = page.total - all.length;
        if (before <= 0) break;
      }
      if (cancelled) return;
      setEvents(all);
      setLoading(false);
      requestAnimationFrame(() => {
        scrollToBottom();
        requestAnimationFrame(scrollToBottom);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, transcriptId, scrollToBottom]);

  // Live append. Subscribe whenever we have a transcript (not gated on current
  // status) so a session that resumes — e.g. right after a composer send —
  // streams in without a race between the status flip and subscription.
  useEffect(() => {
    if (!transcriptId) return;
    eventsClient.subscribe([`transcript:${transcriptId}`]);
    const off = onTranscriptAppend(transcriptId, (incoming) => {
      setEvents((prev) => mergeEvents(prev, incoming));
      if (followingRef.current) {
        requestAnimationFrame(scrollToBottom);
      }
    });
    return () => {
      off();
      eventsClient.unsubscribe([`transcript:${transcriptId}`]);
    };
  }, [transcriptId, scrollToBottom]);

  // Track whether we're pinned to bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < 48;
    followingRef.current = atBottom;
    setFollowing(atBottom);
  }, []);

  useLayoutEffect(() => {
    if (followingRef.current) scrollToBottom();
  }, [events.length, scrollToBottom]);

  const remeasure = useCallback(() => virtualizer.measure(), [virtualizer]);

  // M9: jump to a specific event (from search), flash it, then clear.
  const feedJump = useUIStore((s) => s.feedJump);
  const setFeedJump = useUIStore((s) => s.setFeedJump);
  useEffect(() => {
    if (
      !feedJump ||
      feedJump.sessionId !== sessionId ||
      loading ||
      events.length === 0
    )
      return;
    const idx = Math.max(0, Math.min(feedJump.eventIdx, events.length - 1));
    followingRef.current = false;
    setFollowing(false);
    setFeedJump(null);
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(idx, { align: "center" });
      setFlashIndex(idx);
      setTimeout(() => setFlashIndex(null), 2000);
    });
  }, [feedJump, sessionId, loading, events.length, virtualizer, setFeedJump]);

  if (!transcriptId) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-t3">
        No transcript for this session yet.
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-[1.55]"
        style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}
      >
        {loading && events.length === 0 && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 w-full max-w-[70%] rounded bg-raised" />
            ))}
          </div>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
            maxWidth: "108ch",
          }}
        >
          {items.map((vi) => {
            const ev = events[vi.index];
            if (!ev) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div
                  className="rounded-[6px] transition-colors duration-500"
                  style={
                    vi.index === flashIndex
                      ? {
                          background:
                            "color-mix(in srgb, var(--accent) 18%, transparent)",
                        }
                      : undefined
                  }
                >
                  <FeedEvent event={ev} onResize={remeasure} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!following && (
        <button
          onClick={() => {
            followingRef.current = true;
            setFollowing(true);
            scrollToBottom();
          }}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hair bg-overlay px-3 py-1.5 text-[12px] text-t1 deck-fade-in"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <ArrowDown size={13} /> Following
        </button>
      )}
    </div>
  );
}

// Upsert by id: update changed events in place, append genuinely new ones.
function mergeEvents(
  prev: TranscriptEvent[],
  incoming: TranscriptEvent[],
): TranscriptEvent[] {
  if (incoming.length === 0) return prev;
  const index = new Map(prev.map((e, i) => [e.id, i]));
  let next = prev;
  let appended = false;
  for (const ev of incoming) {
    const at = index.get(ev.id);
    if (at != null) {
      if (next === prev) next = [...prev];
      next[at] = ev;
    } else {
      if (!appended) {
        next = next === prev ? [...prev] : next;
        appended = true;
      }
      next.push(ev);
      index.set(ev.id, next.length - 1);
    }
  }
  return next;
}
