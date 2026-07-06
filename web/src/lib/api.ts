import type {
  ProjectSummary,
  ProjectDetail,
  ProjectInspection,
  LivePortMap,
  Session,
  Group,
  GitStatus,
  DiffResult,
  Commit,
  CommitShow,
  FileContent,
  FileAtHead,
  TreeNode,
  TranscriptPage,
  DeckClientConfig,
  CostReport,
  SessionRestore,
  AiUsageReport,
  AiConfigView,
  AiResult,
  AiFeatureId,
  SearchHit,
  ReviewItem,
  Recipe,
  TaskCard,
  RunbookInfo,
  RunbookStatus,
  Runbook,
  SystemOverview,
  StackReport,
  DbOverview,
  DbQueryResult,
  StudioStatus,
} from "@deck/shared";

async function req<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`${method} ${url} -> ${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(u: string) => req<T>("GET", u);
const post = <T>(u: string, b?: unknown) => req<T>("POST", u, b ?? {});
const put = <T>(u: string, b?: unknown) => req<T>("PUT", u, b ?? {});
const patch = <T>(u: string, b?: unknown) => req<T>("PATCH", u, b ?? {});
const del = <T>(u: string) => req<T>("DELETE", u);

const enc = encodeURIComponent;

export const api = {
  config: () => get<DeckClientConfig>("/api/config"),

  projects: () => get<ProjectSummary[]>("/api/projects"),
  project: (id: string) => get<ProjectDetail>(`/api/projects/${enc(id)}`),
  inspections: () =>
    get<Record<string, ProjectInspection>>("/api/projects/inspections"),
  livePorts: () => get<LivePortMap>("/api/projects/live-ports"),
  screenshotTimes: () =>
    get<Record<string, number>>("/api/projects/screenshots"),
  captureScreenshot: (id: string, port?: number) =>
    post<{ ok: boolean; port: number }>(
      `/api/projects/${enc(id)}/screenshot`,
      port ? { port } : {},
    ),
  generateBlurb: (id: string) =>
    post<ProjectInspection>(`/api/projects/${enc(id)}/blurb`),
  tree: (id: string, path = "") =>
    get<TreeNode[]>(`/api/projects/${enc(id)}/tree?path=${enc(path)}`),
  file: (id: string, path: string) =>
    get<FileContent>(`/api/projects/${enc(id)}/file?path=${enc(path)}`),
  saveFile: (id: string, path: string, content: string) =>
    put<{ ok: true }>(
      `/api/projects/${enc(id)}/file?path=${enc(path)}`,
      { content },
    ),

  gitStatus: (id: string) =>
    get<GitStatus>(`/api/projects/${enc(id)}/git/status`),
  gitDiff: (id: string, path: string, staged: boolean, context = 3) =>
    get<DiffResult>(
      `/api/projects/${enc(id)}/git/diff?path=${enc(path)}&staged=${staged}&context=${context}`,
    ),
  gitFileAtHead: (id: string, path: string) =>
    get<FileAtHead>(
      `/api/projects/${enc(id)}/git/file-at-head?path=${enc(path)}`,
    ),
  gitStage: (id: string, paths: string[]) =>
    post(`/api/projects/${enc(id)}/git/stage`, { paths }),
  gitUnstage: (id: string, paths: string[]) =>
    post(`/api/projects/${enc(id)}/git/unstage`, { paths }),
  gitStageHunk: (id: string, path: string, hunkHeader: string, patch: string) =>
    post(`/api/projects/${enc(id)}/git/stage-hunk`, { path, hunkHeader, patch }),
  gitUnstageHunk: (
    id: string,
    path: string,
    hunkHeader: string,
    patch: string,
  ) =>
    post(`/api/projects/${enc(id)}/git/unstage-hunk`, {
      path,
      hunkHeader,
      patch,
    }),
  gitDiscardHunk: (id: string, path: string, hunkHeader: string, patch: string) =>
    post(`/api/projects/${enc(id)}/git/discard-hunk`, { path, hunkHeader, patch }),
  gitDiscard: (id: string, paths: string[]) =>
    post(`/api/projects/${enc(id)}/git/discard`, { paths }),
  gitCommit: (id: string, message: string, amend = false) =>
    post<{ hash: string }>(`/api/projects/${enc(id)}/git/commit`, {
      message,
      amend,
    }),
  gitPush: (id: string) =>
    post<{ ok: boolean; output: string }>(`/api/projects/${enc(id)}/git/push`),
  gitLog: (id: string, limit = 50) =>
    get<Commit[]>(`/api/projects/${enc(id)}/git/log?limit=${limit}`),
  gitShow: (id: string, hash: string) =>
    get<CommitShow>(`/api/projects/${enc(id)}/git/show?hash=${enc(hash)}`),
  gitShowFile: (id: string, hash: string, path: string) =>
    get<DiffResult>(
      `/api/projects/${enc(id)}/git/show-file?hash=${enc(hash)}&path=${enc(path)}`,
    ),

  sessions: () => get<Session[]>("/api/sessions"),
  projectAgentSessions: (id: string) =>
    get<{ live: Session[]; history: Session[] }>(
      `/api/projects/${enc(id)}/agent-sessions`,
    ),
  createSession: (body: {
    projectId: string;
    kind: "claude" | "shell";
    name?: string;
    groupId?: string;
    claudeArgs?: string[];
    command?: string;
    initialPrompt?: string;
    cwd?: string;
  }) => post<Session>("/api/sessions", body),
  markSessionRead: (id: string) => post(`/api/sessions/${enc(id)}/read`),
  killSession: (id: string) => post(`/api/sessions/${enc(id)}/kill`),
  renameSession: (id: string, name: string) =>
    post(`/api/sessions/${enc(id)}/rename`, { name }),
  sendInput: (id: string, text: string, submit: boolean) =>
    post(`/api/sessions/${enc(id)}/input`, { text, submit }),
  restartSession: (id: string) => post<Session>(`/api/sessions/${enc(id)}/restart`),
  adoptSession: (id: string) => post<Session>(`/api/sessions/${enc(id)}/adopt`),
  restoreSession: (id: string) =>
    get<SessionRestore>(`/api/sessions/${enc(id)}/restore`),
  resumeTranscript: (body: {
    transcriptId: string;
    projectId: string;
    name?: string;
    groupId?: string;
  }) => post<Session>(`/api/sessions/resume`, body),
  transcript: (id: string, before?: number) =>
    get<TranscriptPage>(
      `/api/sessions/${enc(id)}/transcript${before != null ? `?before=${before}` : ""}`,
    ),

  groups: () => get<Group[]>("/api/groups"),
  createGroup: (name: string) => post<Group>("/api/groups", { name }),
  renameGroup: (id: string, name: string) =>
    req<Group>("PATCH", `/api/groups/${enc(id)}`, { name }),
  deleteGroup: (id: string) => req<void>("DELETE", `/api/groups/${enc(id)}`),
  assignGroup: (groupId: string, sessionId: string) =>
    post(`/api/groups/${enc(groupId)}/assign`, { sessionId }),
  ungroupSession: (sessionId: string) =>
    post(`/api/groups/none/assign`, { sessionId }),

  // Project groups (sidebar)
  projectGroups: () => get<Group[]>("/api/project-groups"),
  createProjectGroup: (name: string) =>
    post<Group>("/api/project-groups", { name }),
  updateProjectGroup: (id: string, patch: { name?: string; collapsed?: boolean }) =>
    req<Group>("PATCH", `/api/project-groups/${enc(id)}`, patch),
  deleteProjectGroup: (id: string) =>
    req<void>("DELETE", `/api/project-groups/${enc(id)}`),
  reorderProjectGroups: (ids: string[]) =>
    post(`/api/project-groups/reorder`, { ids }),
  assignProjectGroup: (groupId: string | null, projectId: string) =>
    post(`/api/project-groups/${enc(groupId ?? "none")}/assign`, { projectId }),

  pinProject: (id: string, pinned: boolean) =>
    post(`/api/projects/${enc(id)}/pin`, { pinned }),
  hideProject: (id: string, hidden: boolean) =>
    post(`/api/projects/${enc(id)}/hide`, { hidden }),
  revealProject: (id: string) => post(`/api/projects/${enc(id)}/reveal`),
  openInWebstorm: (id: string) => post(`/api/projects/${enc(id)}/webstorm`),

  dismissSession: (id: string) => post(`/api/sessions/${enc(id)}/dismiss`),

  cost: (force = false) =>
    get<CostReport>(`/api/cost${force ? "?force=1" : ""}`),

  // ----- M7: AI service / admin -----
  aiUsage: (days = 30) => get<AiUsageReport>(`/api/ai/usage?days=${days}`),
  aiConfig: () => get<AiConfigView>("/api/ai/config"),
  patchAiConfig: (body: {
    backend?: "claude-cli" | "api";
    globalDailyBudgetUSD?: number;
    feature?: AiFeatureId;
    enabled?: boolean;
    model?: string;
    dailyBudgetUSD?: number;
  }) => patch<AiConfigView>("/api/ai/config", body),
  aiTest: () => post<AiResult>("/api/ai/test"),

  // ----- M13: prompt enhancer + commit message -----
  aiEnhance: (prompt: string, projectId?: string) =>
    post<{ prompt: string }>("/api/ai/enhance", { prompt, projectId }),
  gitCommitMessage: (id: string, style: "terse" | "conventional" | "verbose") =>
    post<{ message: string }>(
      `/api/projects/${enc(id)}/git/commit-message`,
      { style },
    ),

  // ----- M13: recipes -----
  recipes: () => get<Recipe[]>("/api/recipes"),
  createRecipe: (body: { name: string; body: string; tags?: string[] }) =>
    post<Recipe>("/api/recipes", body),
  updateRecipe: (
    id: string,
    body: { name?: string; body?: string; tags?: string[] },
  ) => patch<Recipe>(`/api/recipes/${enc(id)}`, body),
  deleteRecipe: (id: string) => del<void>(`/api/recipes/${enc(id)}`),
  useRecipe: (id: string) => post(`/api/recipes/${enc(id)}/used`),

  // ----- M9: search -----
  search: (q: string, projectId?: string, limit = 30) =>
    get<SearchHit[]>(
      `/api/search?q=${enc(q)}${projectId ? `&projectId=${enc(projectId)}` : ""}&limit=${limit}`,
    ),
  searchSessions: (q: string, projectId?: string) =>
    get<Session[]>(
      `/api/search/sessions?q=${enc(q)}${projectId ? `&projectId=${enc(projectId)}` : ""}`,
    ),

  // ----- M11: reviews -----
  reviews: () => get<ReviewItem[]>("/api/reviews"),
  dismissReview: (id: string) => post(`/api/reviews/${enc(id)}/dismiss`),

  // ----- M14: digest -----
  generateDigest: (range: "today" | "yesterday" | { hours: number }) =>
    post<{ markdown: string; path: string; name: string }>("/api/digest", {
      range,
    }),
  digests: () => get<{ name: string; ts: number }[]>("/api/digests"),
  digest: (name: string) =>
    get<{ markdown: string }>(`/api/digests/${enc(name)}`),

  // ----- M15: budgets -----
  patchBudgets: (body: {
    monthlyUSD?: number | null;
    blockUSD?: number | null;
  }) => patch<{ monthlyUSD: number | null; blockUSD: number | null }>(
    "/api/cost/budgets",
    body,
  ),

  // ----- M17v2: personal task board -----
  tasks: () => get<TaskCard[]>("/api/tasks"),
  createTask: (body: { title: string; body?: string; projectId?: string | null }) =>
    post<TaskCard>("/api/tasks", body),
  updateTask: (
    id: string,
    body: Partial<
      Pick<TaskCard, "title" | "body" | "projectId" | "prompt" | "order" | "status">
    >,
  ) => patch<TaskCard>(`/api/tasks/${enc(id)}`, body),
  deleteTask: (id: string) => del<void>(`/api/tasks/${enc(id)}`),
  clearDoneTasks: () => post<{ cleared: number }>("/api/tasks/clear-done"),
  generateTaskPrompt: (id: string) =>
    post<TaskCard>(`/api/tasks/${enc(id)}/generate-prompt`),

  // ----- M18: runbook + preview -----
  runbook: (id: string) => get<RunbookInfo>(`/api/projects/${enc(id)}/runbook`),
  saveRunbook: (id: string, runbook: Runbook) =>
    put<RunbookInfo>(`/api/projects/${enc(id)}/runbook`, runbook),
  runbookStatus: (id: string) =>
    get<RunbookStatus>(`/api/projects/${enc(id)}/runbook/status`),
  generateRunbook: (id: string) =>
    post<RunbookInfo>(`/api/projects/${enc(id)}/runbook/generate`),

  // ----- M19: system suite -----
  systemOverview: (force = false) =>
    get<SystemOverview>(`/api/system/overview${force ? "?force=1" : ""}`),
  killPid: (pid: number) => post<{ ok: boolean }>(`/api/system/kill/${pid}`),

  // ----- M20: stack (env + db + studio) -----
  stack: (id: string) => get<StackReport>(`/api/projects/${enc(id)}/stack`),
  revealEnv: (id: string, file: string, key: string) =>
    get<{ value: string }>(
      `/api/projects/${enc(id)}/env/reveal?file=${enc(file)}&key=${enc(key)}`,
    ),
  setEnv: (id: string, file: string, key: string, value: string) =>
    put<{ ok: boolean }>(`/api/projects/${enc(id)}/env`, { file, key, value }),
  dbOverview: (id: string) =>
    get<DbOverview>(`/api/projects/${enc(id)}/db/overview`),
  dbQuery: (id: string, sql: string) =>
    post<DbQueryResult>(`/api/projects/${enc(id)}/db/query`, { sql }),
  dbAiQuery: (id: string, question: string) =>
    post<DbQueryResult>(`/api/projects/${enc(id)}/db/ai-query`, { question }),
  studioStatus: (id: string) =>
    get<StudioStatus>(`/api/projects/${enc(id)}/db/studio`),
  studioStart: (id: string) =>
    post<StudioStatus>(`/api/projects/${enc(id)}/db/studio/start`),
  studioStop: (id: string) =>
    post<StudioStatus>(`/api/projects/${enc(id)}/db/studio/stop`),
};
