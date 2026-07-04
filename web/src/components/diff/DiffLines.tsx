import type { DiffLine } from "@deck/shared";
import { cn } from "../../lib/cn";

// Renders DiffLine[] with §6 styling (line numbers both sides, +/- tints,
// optional word-level intra-line highlights). Shared by edit mini-diffs (§7.2)
// and the git hunk viewer (§6).
export function DiffLines({
  lines,
  showGutter = true,
}: {
  lines: DiffLine[];
  showGutter?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} showGutter={showGutter} />
      ))}
    </div>
  );
}

function DiffRow({ line, showGutter }: { line: DiffLine; showGutter: boolean }) {
  if (line.type === "meta") {
    return (
      <div className="diff-row" style={{ color: "var(--text-3)" }}>
        {showGutter && <span className="diff-gutter" />}
        {showGutter && <span className="diff-gutter" />}
        <span className="diff-text italic">{line.text || " "}</span>
      </div>
    );
  }
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return (
    <div
      className={cn(
        "diff-row",
        line.type === "add" && "diff-add",
        line.type === "del" && "diff-del",
      )}
    >
      {showGutter && (
        <>
          <span className="diff-gutter">{line.oldNo ?? ""}</span>
          <span className="diff-gutter">{line.newNo ?? ""}</span>
        </>
      )}
      <span className="diff-text">
        <span style={{ color: "var(--text-3)" }}>{sign} </span>
        {renderIntra(line.text, line.intra)}
      </span>
    </div>
  );
}

function renderIntra(text: string, intra?: [number, number][]) {
  if (!intra || intra.length === 0) return text || " ";
  const out: React.ReactNode[] = [];
  let cursor = 0;
  intra.forEach(([start, end], idx) => {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <span key={idx} className="diff-hl">
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
