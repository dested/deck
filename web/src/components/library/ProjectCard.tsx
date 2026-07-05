import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Pin,
  PinOff,
  EyeOff,
  Eye,
  Bot,
  SquareTerminal,
  FolderOpen,
  Copy,
  Code2,
  FolderInput,
  ChevronRight,
  Check,
  FolderPlus,
  FolderMinus,
  Play,
  Camera,
  Sparkles,
  Zap,
  GitBranch,
  Boxes,
  Loader2,
} from "lucide-react";
import type { ProjectSummary, ProjectInspection, Group } from "@deck/shared";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import { spawnSession, runScript } from "../../lib/sessions";
import { relTime } from "../../lib/format";
import { projectGradient, projectInitials } from "../../lib/identity";
import { useUIStore } from "../../stores/uiStore";
import { useLibraryStore } from "../../stores/libraryStore";
import type { ProjectSessionStats } from "../../stores/sessionsStore";
import {
  menuContent,
  menuContentStyle,
  menuItem,
  menuSeparator,
} from "../ui/menuStyles";

// Scripts worth surfacing as one-click launchers, in display priority.
const SCRIPT_PRIORITY = ["dev", "start", "serve", "watch", "build"];

function sortScripts(scripts: { name: string; command: string }[]) {
  return [...scripts].sort((a, b) => {
    const ai = SCRIPT_PRIORITY.indexOf(a.name);
    const bi = SCRIPT_PRIORITY.indexOf(b.name);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

export function ProjectCard({
  project,
  inspection,
  livePorts = [],
  shotAt,
  stats,
  groups = [],
}: {
  project: ProjectSummary;
  inspection?: ProjectInspection;
  livePorts?: number[];
  shotAt?: number;
  stats?: ProjectSessionStats;
  groups?: Group[];
}) {
  const openProject = useUIStore((s) => s.openProject);
  const setInspection = useLibraryStore((s) => s.setInspection);
  const [shotBroken, setShotBroken] = useState(false);
  const [blurbing, setBlurbing] = useState(false);

  const attention = stats?.attention ?? false;
  const running = stats?.running ?? 0;
  const scripts = inspection ? sortScripts(inspection.scripts).slice(0, 3) : [];
  const hasShot = shotAt != null && !shotBroken;

  const generateBlurb = async () => {
    if (blurbing) return;
    setBlurbing(true);
    try {
      const insp = await api.generateBlurb(project.id);
      setInspection(insp);
    } catch {
      /* surfaced as the button un-spinning with no text; retryable */
    } finally {
      setBlurbing(false);
    }
  };

  const recapture = () =>
    void api.captureScreenshot(project.id).catch(() => {});

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          onClick={() => openProject(project.id)}
          className={cn(
            "group flex cursor-pointer flex-col overflow-hidden rounded-[10px] border bg-panel transition-colors",
            attention
              ? "border-[color:var(--warn)]"
              : "border-hair hover:border-hairfocus",
          )}
        >
          {/* ---- face: screenshot or gradient identity ---- */}
          <div
            className="relative h-[104px] w-full shrink-0 overflow-hidden"
            style={hasShot ? undefined : { background: projectGradient(project.name) }}
          >
            {hasShot ? (
              <img
                src={`/api/projects/${encodeURIComponent(project.id)}/screenshot?ts=${shotAt}`}
                alt=""
                loading="lazy"
                onError={() => setShotBroken(true)}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-[26px] font-bold tracking-wide text-white/25 select-none">
                {projectInitials(project.name)}
              </span>
            )}

            {project.pinned && (
              <Pin
                size={12}
                fill="currentColor"
                className="absolute left-2 top-2 text-white/80 drop-shadow"
              />
            )}

            {/* live dev servers */}
            {livePorts.length > 0 && (
              <div className="absolute bottom-1.5 left-1.5 flex gap-1">
                {livePorts.slice(0, 3).map((port) => (
                  <a
                    key={port}
                    href={`http://localhost:${port}/`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={stop}
                    title={`Open http://localhost:${port}`}
                    className="mono flex items-center gap-1 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white/90 backdrop-blur-sm hover:bg-black/80"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--ok)] deck-pulse" />
                    :{port}
                  </a>
                ))}
              </div>
            )}

            {running > 0 && (
              <span
                className={cn(
                  "mono absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[10.5px] backdrop-blur-sm",
                  attention
                    ? "text-[color:var(--warn)]"
                    : "text-[color:var(--ok)]",
                )}
              >
                <Zap size={10} fill="currentColor" />
                {running}
              </span>
            )}

            {/* hover: recapture */}
            {livePorts.length > 0 && (
              <button
                onClick={(e) => {
                  stop(e);
                  recapture();
                }}
                title="Recapture screenshot"
                className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-[5px] bg-black/60 text-white/70 opacity-0 backdrop-blur-sm transition-opacity hover:text-white group-hover:opacity-100"
              >
                <Camera size={12} />
              </button>
            )}
          </div>

          {/* ---- body ---- */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-semibold text-t1">
                {project.name}
              </span>
              {inspection && inspection.workspaceGlobs > 0 && (
                <Boxes size={12} className="shrink-0 text-t3" />
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-t3">
                {project.branch && (
                  <span className="mono flex max-w-[110px] items-center gap-0.5">
                    <GitBranch size={10} className="shrink-0" />
                    <span className="truncate">{project.branch}</span>
                  </span>
                )}
                {project.dirtyCount != null && project.dirtyCount > 0 && (
                  <span className="mono tabular-nums text-[color:var(--warn)]">
                    {project.dirtyCount}
                  </span>
                )}
              </span>
            </div>

            {/* blurb, or the ✨ that earns one */}
            {inspection?.blurb ? (
              <p
                className="line-clamp-2 text-[12px] leading-[1.45] text-t2"
                title={inspection.blurb}
              >
                {inspection.blurb}
              </p>
            ) : inspection ? (
              <button
                onClick={(e) => {
                  stop(e);
                  void generateBlurb();
                }}
                disabled={blurbing}
                className="flex w-fit items-center gap-1 rounded-[5px] px-1 py-0.5 text-[11.5px] text-t3 hover:bg-raised hover:text-t2 disabled:opacity-70"
              >
                {blurbing ? (
                  <>
                    <Loader2 size={11} className="animate-spin" /> summarizing…
                  </>
                ) : (
                  <>
                    <Sparkles size={11} /> Describe with Claude
                  </>
                )}
              </button>
            ) : null}

            {/* framework chips + static port hint */}
            {inspection &&
              (inspection.frameworks.length > 0 ||
                (livePorts.length === 0 && inspection.staticPorts.length > 0)) && (
                <div className="flex flex-wrap items-center gap-1">
                  {inspection.frameworks.slice(0, 4).map((f) => (
                    <span
                      key={f}
                      className="rounded-[4px] border border-hair bg-raised px-1.5 py-[1px] text-[10.5px] text-t2"
                    >
                      {f}
                    </span>
                  ))}
                  {livePorts.length === 0 &&
                    inspection.staticPorts.slice(0, 2).map((p) => (
                      <span
                        key={p}
                        title="Port from config (not currently live)"
                        className="mono rounded-[4px] border border-hair px-1.5 py-[1px] text-[10.5px] text-t3"
                      >
                        :{p}
                      </span>
                    ))}
                </div>
              )}

            {/* run buttons */}
            {scripts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {scripts.map((s) => (
                  <button
                    key={s.name}
                    onClick={(e) => {
                      stop(e);
                      void runScript(
                        project.id,
                        s.name,
                        inspection!.runner,
                      ).catch(() => {});
                    }}
                    title={`${inspection!.runner} run ${s.name}\n${s.command}`}
                    className="mono flex items-center gap-1 rounded-[5px] border border-hair px-1.5 py-[2px] text-[11px] text-t2 transition-colors hover:border-hairfocus hover:bg-raised hover:text-t1"
                  >
                    <Play size={9} className="text-[color:var(--ok)]" />
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* footer */}
            <div className="mt-auto flex items-center gap-2 pt-0.5 text-[11px] text-t3">
              <span className="mono">{relTime(project.activityAt)}</span>
              <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    stop(e);
                    void spawnSession(project.id, "claude").catch(() => {});
                  }}
                  title="New Claude session"
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] hover:bg-raised hover:text-t1"
                >
                  <Bot size={13} />
                </button>
                <button
                  onClick={(e) => {
                    stop(e);
                    void spawnSession(project.id, "shell").catch(() => {});
                  }}
                  title="New terminal"
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] hover:bg-raised hover:text-t1"
                >
                  <SquareTerminal size={13} />
                </button>
                <button
                  onClick={(e) => {
                    stop(e);
                    void api.openInWebstorm(project.id).catch(() => {});
                  }}
                  title="Open in WebStorm"
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] hover:bg-raised hover:text-t1"
                >
                  <Code2 size={13} />
                </button>
              </span>
            </div>
          </div>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} style={menuContentStyle}>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.pinProject(project.id, !project.pinned)}
          >
            {project.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {project.pinned ? "Unpin" : "Pin"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.hideProject(project.id, !project.hidden)}
          >
            {project.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            {project.hidden ? "Unhide" : "Hide"}
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={menuItem}>
              <FolderInput size={14} /> Move to group
              <ChevronRight size={13} className="ml-auto text-t3" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className={menuContent}
                style={menuContentStyle}
              >
                {groups.map((g) => (
                  <ContextMenu.Item
                    key={g.id}
                    className={menuItem}
                    onSelect={() => api.assignProjectGroup(g.id, project.id)}
                  >
                    {project.groupId === g.id ? (
                      <Check size={14} />
                    ) : (
                      <span className="w-[14px]" />
                    )}
                    <span className="truncate">{g.name}</span>
                  </ContextMenu.Item>
                ))}
                {groups.length > 0 && (
                  <ContextMenu.Separator className={menuSeparator} />
                )}
                {project.groupId && (
                  <ContextMenu.Item
                    className={menuItem}
                    onSelect={() => api.assignProjectGroup(null, project.id)}
                  >
                    <FolderMinus size={14} /> Remove from group
                  </ContextMenu.Item>
                )}
                <ContextMenu.Item
                  className={menuItem}
                  onSelect={() =>
                    void api
                      .createProjectGroup("New group")
                      .then((g) => api.assignProjectGroup(g.id, project.id))
                      .catch(() => {})
                  }
                >
                  <FolderPlus size={14} /> New group…
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => void spawnSession(project.id, "claude").catch(() => {})}
          >
            <Bot size={14} /> New Claude session
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => void spawnSession(project.id, "shell").catch(() => {})}
          >
            <SquareTerminal size={14} /> New terminal
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item className={menuItem} onSelect={recapture}>
            <Camera size={14} /> Capture screenshot
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => void generateBlurb()}
          >
            <Sparkles size={14} /> Describe with Claude
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.revealProject(project.id)}
          >
            <FolderOpen size={14} /> Open in Explorer
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => api.openInWebstorm(project.id)}
          >
            <Code2 size={14} /> Open in WebStorm
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => navigator.clipboard?.writeText(project.path)}
          >
            <Copy size={14} /> Copy path
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
