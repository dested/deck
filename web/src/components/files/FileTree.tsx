import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, File as FileIcon, Folder, FolderOpen } from "lucide-react";
import type { TreeNode } from "@deck/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";

interface FlatNode {
  node: TreeNode;
  depth: number;
}

export function FileTree({
  projectId,
  selectedPath,
  onSelect,
  modifiedPaths,
}: {
  projectId: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  modifiedPaths: Set<string>;
}) {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (path: string) => {
      const nodes = await api.tree(projectId, path).catch(() => []);
      setChildren((c) => ({ ...c, [path]: nodes }));
    },
    [projectId],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const toggle = (node: TreeNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else {
        next.add(node.path);
        if (!children[node.path]) void load(node.path);
      }
      return next;
    });
  };

  // Flatten visible nodes respecting expansion + ignored toggle.
  const flat: FlatNode[] = [];
  const walk = (path: string, depth: number) => {
    const nodes = children[path];
    if (!nodes) return;
    for (const node of nodes) {
      if (node.ignored && !showIgnored) continue;
      flat.push({ node, depth });
      if (node.type === "dir" && expanded.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk("", 0);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 20,
  });

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto py-1"
        style={{ scrollbarGutter: "stable" }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const { node, depth } = flat[vi.index]!;
            const isDir = node.type === "dir";
            const isOpen = expanded.has(node.path);
            const selected = node.path === selectedPath;
            return (
              <div
                key={node.path}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: 24,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <button
                  onClick={() => (isDir ? toggle(node) : onSelect(node.path))}
                  className={cn(
                    "flex h-6 w-full items-center gap-1 pr-2 text-left text-[12.5px]",
                    selected ? "bg-raised text-t1" : "text-t2 hover:bg-raised hover:text-t1",
                    node.ignored && "opacity-50",
                  )}
                  style={{ paddingLeft: 6 + depth * 12 }}
                >
                  {isDir ? (
                    <ChevronRight
                      size={12}
                      className={cn("shrink-0 text-t3 transition-transform", isOpen && "rotate-90")}
                    />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  {isDir ? (
                    isOpen ? (
                      <FolderOpen size={13} className="shrink-0 text-t3" />
                    ) : (
                      <Folder size={13} className="shrink-0 text-t3" />
                    )
                  ) : (
                    <FileIcon size={13} className="shrink-0 text-t3" />
                  )}
                  <span className="truncate">{node.name}</span>
                  {!isDir && modifiedPaths.has(node.path) && (
                    <span
                      className="ml-auto h-[6px] w-[6px] shrink-0 rounded-full"
                      style={{ background: "var(--warn)" }}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <button
        onClick={() => setShowIgnored((v) => !v)}
        className="shrink-0 border-t border-hair px-3 py-1.5 text-left text-[11.5px] text-t3 hover:text-t2"
      >
        {showIgnored ? "Hide ignored" : "Show ignored"}
      </button>
    </div>
  );
}
