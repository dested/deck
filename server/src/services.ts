import { projectRegistry } from "./projects/registry.js";
import {
  startWatchers,
  stopWatchers,
  syncGitHeartbeat,
  openRepoWatch,
  closeRepoWatch,
} from "./projects/watcher.js";
import { portWatcher } from "./projects/ports.js";
import { screenshotService } from "./projects/screenshots.js";
import { ptyManager } from "./pty/manager.js";
import { sessionManager } from "./sessions/manager.js";
import { transcriptRegistry } from "./transcripts/registry.js";
import { primeCostReport } from "./cost/service.js";
import { addTranscriptChangeListener } from "./transcripts/tailer.js";
import { eventHub } from "./ws/events.js";
import fs from "node:fs";
import { config } from "./config.js";
import { usageLedger } from "./ai/usage.js";
import { startLiveMetaTicker, stopLiveMetaTicker } from "./ai/liveMeta.js";
import { searchIndexer } from "./search/indexer.js";
import { startDigestScheduler, stopDigestScheduler } from "./digest/service.js";
import { startAutopilot, stopAutopilot } from "./tasks/autopilot.js";
import { studioManager } from "./db/studio.js";

let rescanTimer: NodeJS.Timeout | null = null;
let externalTimer: NodeJS.Timeout | null = null;

export async function startServices() {
  // M7: AI scratch dir + usage ledger warm-up.
  try {
    fs.mkdirSync(config.aiScratchDir, { recursive: true });
  } catch {
    /* ignore */
  }
  usageLedger.load();

  ptyManager.init();
  sessionManager.startStatusTicker();

  projectRegistry.rescan();
  void projectRegistry.refreshTopGit(30, 8);

  // Transcript index + external session discovery (§7.4).
  transcriptRegistry.refreshIndex();
  sessionManager.setExternalProvider(() =>
    transcriptRegistry.externalSessions(),
  );
  transcriptRegistry.setOwnedTranscriptChecker(() =>
    sessionManager.ownedTranscriptIds(),
  );
  addTranscriptChangeListener((file) => transcriptRegistry.onFileChanged(file));

  // M9: FTS search index. Boot sweep is incremental; live changes re-index the
  // touched file (debounced 2s) off the same central change hook.
  searchIndexer.init();
  const searchDebounce = new Map<string, NodeJS.Timeout>();
  addTranscriptChangeListener((file) => {
    const prev = searchDebounce.get(file);
    if (prev) clearTimeout(prev);
    searchDebounce.set(
      file,
      setTimeout(() => {
        searchDebounce.delete(file);
        searchIndexer.indexFile(file);
      }, 2000),
    );
  });
  searchIndexer.sweep();

  startWatchers();

  // Live dev-server ports → Library card badges; a live port also triggers a
  // (throttled) headless screenshot so the card gets a face.
  portWatcher.onLive((projectId, port) =>
    screenshotService.maybeCapture(projectId, port),
  );
  portWatcher.start();

  // Central topic-subscription lifecycle: git: -> repo watchers, transcript: ->
  // transcript live-tail subscription.
  eventHub.setSubHandler((topic, subscribed) => {
    if (topic.startsWith("git:")) {
      const id = topic.slice("git:".length);
      if (subscribed) openRepoWatch(id);
      else closeRepoWatch(id);
    } else if (topic.startsWith("transcript:")) {
      const id = topic.slice("transcript:".length);
      if (subscribed) transcriptRegistry.subscribe(id);
      else transcriptRegistry.unsubscribe(id);
    }
  });

  rescanTimer = setInterval(() => {
    projectRegistry.rescan();
    syncGitHeartbeat();
    transcriptRegistry.refreshIndex();
  }, 60_000);

  // External session status transitions (working->attention->idle->stale).
  externalTimer = setInterval(() => transcriptRegistry.tickExternal(), 10_000);

  // Warm the cost report so the dashboard opens instantly (ccusage is slow on
  // its first bun-x resolve). Fire-and-forget; failures degrade gracefully.
  primeCostReport();

  // M12: AI tab titles/summaries for sessions with an open tab/feed.
  startLiveMetaTicker();

  // M14: optional scheduled daily digest. M17: task-board autopilot.
  startDigestScheduler();
  startAutopilot();

  console.log(
    `[deck] discovered ${projectRegistry.getAll().length} projects, ` +
      `${sessionManager.list().length} sessions`,
  );
}

export function stopServices() {
  if (rescanTimer) clearInterval(rescanTimer);
  if (externalTimer) clearInterval(externalTimer);
  stopLiveMetaTicker();
  stopDigestScheduler();
  stopAutopilot();
  studioManager.disposeAll();
  portWatcher.stop();
  void stopWatchers();
}
