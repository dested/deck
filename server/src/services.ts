import { projectRegistry } from "./projects/registry.js";
import {
  startWatchers,
  stopWatchers,
  syncGitHeartbeat,
  openRepoWatch,
  closeRepoWatch,
} from "./projects/watcher.js";
import { ptyManager } from "./pty/manager.js";
import { sessionManager } from "./sessions/manager.js";
import { transcriptRegistry } from "./transcripts/registry.js";
import { primeCostReport } from "./cost/service.js";
import { addTranscriptChangeListener } from "./transcripts/tailer.js";
import { eventHub } from "./ws/events.js";

let rescanTimer: NodeJS.Timeout | null = null;
let externalTimer: NodeJS.Timeout | null = null;

export async function startServices() {
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

  startWatchers();

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

  console.log(
    `[deck] discovered ${projectRegistry.getAll().length} projects, ` +
      `${sessionManager.list().length} sessions`,
  );
}

export function stopServices() {
  if (rescanTimer) clearInterval(rescanTimer);
  if (externalTimer) clearInterval(externalTimer);
  void stopWatchers();
}
