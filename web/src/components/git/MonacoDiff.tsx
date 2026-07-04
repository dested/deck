import "../../lib/monacoSetup";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiffEditor, type Monaco } from "@monaco-editor/react";
import { api } from "../../lib/api";
import { languageFromPath, DECK_MONACO_THEME } from "../../lib/monacoTheme";

// Full-file diff: HEAD vs worktree (§6). Lazy-loaded chunk.
export default function MonacoDiff({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const widthRef = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["git", projectId, "fullfile", path],
    queryFn: async () => {
      const [head, work] = await Promise.all([
        api.gitFileAtHead(projectId, path).catch(() => ({ content: "", exists: false })),
        api.file(projectId, path).catch(() => ({ content: "", language: "plaintext", size: 0, truncated: false })),
      ]);
      return { original: head.content, modified: work.content };
    },
  });

  const beforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme("deck-dark", DECK_MONACO_THEME);
  };

  if (!data) return <div className="p-4 text-[13px] text-t3">Loading…</div>;

  const sideBySide = (widthRef.current?.clientWidth ?? 1200) >= 1100;

  return (
    <div ref={widthRef} className="h-full w-full">
      <DiffEditor
        height="100%"
        theme="deck-dark"
        beforeMount={beforeMount}
        original={data.original}
        modified={data.modified}
        language={languageFromPath(path)}
        options={{
          readOnly: true,
          renderSideBySide: sideBySide,
          minimap: { enabled: false },
          fontSize: 12.5,
          fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );
}
