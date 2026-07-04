import "../../lib/monacoSetup";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import { Save } from "lucide-react";
import { api } from "../../lib/api";
import { DECK_MONACO_THEME } from "../../lib/monacoTheme";
import { splitPath } from "../../lib/format";

// Monaco editor for a single file with Ctrl+S save (§9.4). Lazy chunk.
export default function FileEditor({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["file", projectId, path],
    queryFn: () => api.file(projectId, path),
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const modelValueRef = useRef<string>("");
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const { dir, name } = splitPath(path);

  const save = async () => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      await api.saveFile(projectId, path, editorRef.current.getValue());
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    setDirty(false);
  }, [path]);

  const beforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme("deck-dark", DECK_MONACO_THEME);
  };
  const onMount = (
    ed: MonacoEditorNS.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = ed;
    modelValueRef.current = ed.getValue();
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });
  };

  if (isLoading) return <div className="p-4 text-[13px] text-t3">Loading…</div>;
  if (data?.binary)
    return <div className="p-4 text-[13px] text-t3">Binary file — cannot edit.</div>;
  if (data?.truncated)
    return (
      <div className="p-4 text-[13px] text-t3">
        File too large to open ({Math.round((data.size ?? 0) / 1024)} KB).
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hair px-3">
        <span className="mono truncate text-[12px]">
          {dir && <span className="text-t3">{dir}</span>}
          <span className="text-t1">{name}</span>
        </span>
        {dirty && <span className="h-[6px] w-[6px] rounded-full" style={{ background: "var(--accent)" }} />}
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="ml-auto flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11.5px] text-t2 hover:bg-raised hover:text-t1 disabled:opacity-40"
        >
          <Save size={12} /> Save
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="deck-dark"
          path={path}
          defaultValue={data?.content ?? ""}
          language={data?.language}
          beforeMount={beforeMount}
          onMount={onMount}
          onChange={(v) => setDirty((v ?? "") !== modelValueRef.current)}
          options={{
            fontSize: 13,
            fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
