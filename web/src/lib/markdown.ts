import { marked } from "marked";

// Transcript markdown -> HTML. Content is the user's own local transcript data
// (trusted); we keep marked's default HTML-escaping on for raw tags anyway.
marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(md: string): string {
  try {
    return marked.parse(md, { async: false }) as string;
  } catch {
    // Never let a markdown edge case break the feed.
    return escapeHtml(md);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
