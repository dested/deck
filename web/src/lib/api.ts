import type {
  ProjectSummary,
  ProjectDetail,
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

const enc = encodeURIComponent;

export const api = {
  config: () => get<DeckClientConfig>("/api/config"),

  projects: () => get<ProjectSummary[]>("/api/projects"),
  project: (id: string) => get<ProjectDetail>(`/api/projects/${enc(id)}`),
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
  }) => post<Session>("/api/sessions", body),
  killSession: (id: string) => post(`/api/sessions/${enc(id)}/kill`),
  renameSession: (id: string, name: string) =>
    post(`/api/sessions/${enc(id)}/rename`, { name }),
  sendInput: (id: string, text: string, submit: boolean) =>
    post(`/api/sessions/${enc(id)}/input`, { text, submit }),
  restartSession: (id: string) => post<Session>(`/api/sessions/${enc(id)}/restart`),
  adoptSession: (id: string) => post<Session>(`/api/sessions/${enc(id)}/adopt`),
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

  pinProject: (id: string, pinned: boolean) =>
    post(`/api/projects/${enc(id)}/pin`, { pinned }),
  hideProject: (id: string, hidden: boolean) =>
    post(`/api/projects/${enc(id)}/hide`, { hidden }),
  revealProject: (id: string) => post(`/api/projects/${enc(id)}/reveal`),
  openInWebstorm: (id: string) => post(`/api/projects/${enc(id)}/webstorm`),

  dismissSession: (id: string) => post(`/api/sessions/${enc(id)}/dismiss`),
};
