import type { editor } from "monaco-editor";

// Monaco theme tuned to the §8 tokens so the editor blends into the app.
export const DECK_MONACO_THEME: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "62656e", fontStyle: "italic" },
    { token: "keyword", foreground: "8b96e8" },
    { token: "string", foreground: "5bcb9b" },
    { token: "number", foreground: "e8b45c" },
    { token: "type", foreground: "79cbdb" },
    { token: "function", foreground: "cba0e8" },
    { token: "variable", foreground: "e6e7eb" },
  ],
  colors: {
    "editor.background": "#131418",
    "editor.foreground": "#e6e7eb",
    "editorLineNumber.foreground": "#62656e",
    "editorLineNumber.activeForeground": "#9da0a8",
    "editor.selectionBackground": "#6e7bd947",
    "editor.lineHighlightBackground": "#1a1c21",
    "editorGutter.background": "#131418",
    "editorCursor.foreground": "#aab3f0",
    "editorWidget.background": "#1e2026",
    "editorWidget.border": "#26282f",
    "diffEditor.insertedTextBackground": "#46b48624",
    "diffEditor.removedTextBackground": "#d7545524",
    "diffEditor.insertedLineBackground": "#46b48617",
    "diffEditor.removedLineBackground": "#d7545517",
    "scrollbarSlider.background": "#2a2c3388",
    "scrollbarSlider.hoverBackground": "#363943aa",
    "editorOverviewRuler.border": "#00000000",
  },
};

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  sh: "shell",
  ps1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  sql: "sql",
  xml: "xml",
};

export function languageFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  return EXT_LANG[ext] ?? "plaintext";
}
