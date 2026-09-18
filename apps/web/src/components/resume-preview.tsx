"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The .docx export, drawn as pages.
 *
 * Everything here comes from POST /api/v1/export/preview, which runs the docx
 * renderer's own section code and reads styles back off the same carrier the
 * download is built from. This component only translates Word units to CSS
 * and paginates - it makes no content decisions of its own.
 */

export interface PreviewBorder {
  color: string;
  width_pt: number;
  space_pt: number;
}

export interface PreviewStyle {
  size_pt: number;
  bold: boolean;
  italic: boolean;
  all_caps: boolean;
  color: string | null;
  space_before_pt: number;
  space_after_pt: number;
  line_spacing: number;
  justify: boolean;
  left_indent_pt: number;
  first_line_indent_pt: number;
  keep_with_next: boolean;
  border_bottom: PreviewBorder | null;
}

export interface PreviewBlock {
  kind: "paragraph" | "role" | "bullet" | "skill_line" | "skills_table";
  style: string;
  text: string;
  right: string | null;
  label: string | null;
  rows: { label: string; value: string }[] | null;
}

export interface ResumePreviewData {
  profile: "designed" | "ats_plain";
  layout: {
    font: string;
    page_width_pt: number;
    page_height_pt: number;
    margin_top_pt: number;
    margin_right_pt: number;
    margin_bottom_pt: number;
    margin_left_pt: number;
    date_color: string;
    skills_label_pt: number;
    cell_right_margin_pt: number;
    table_rule_color: string;
    table_rule_pt: number;
  };
  styles: Record<string, PreviewStyle>;
  blocks: PreviewBlock[];
}

const PX_PER_PT = 96 / 72;
// Word's "multiple" line spacing scales the font's own line height, which for
// Calibri (and metric-compatible Carlito) is 1.22em - not CSS's 1.0.
const FONT_LINE_HEIGHT = 1.22;
const PAGE_GAP_PX = 24;

function paragraphCss(s: PreviewStyle): CSSProperties {
  const border = s.border_bottom;
  return {
    margin: 0,
    marginTop: `${s.space_before_pt}pt`,
    marginBottom: `${s.space_after_pt}pt`,
    fontSize: `${s.size_pt}pt`,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textTransform: s.all_caps ? "uppercase" : undefined,
    color: s.color ? `#${s.color}` : "#000",
    lineHeight: FONT_LINE_HEIGHT * s.line_spacing,
    textAlign: s.justify ? "justify" : "left",
    paddingLeft: s.left_indent_pt ? `${s.left_indent_pt}pt` : undefined,
    textIndent: s.first_line_indent_pt ? `${s.first_line_indent_pt}pt` : undefined,
    paddingBottom: border ? `${border.space_pt}pt` : undefined,
    borderBottom: border ? `${border.width_pt}pt solid #${border.color}` : undefined,
    // Word keeps runs of spaces (the languages line joins entries with three).
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  };
}

function Block({ block, data }: { block: PreviewBlock; data: ResumePreviewData }) {
  const style = data.styles[block.style];
  const css = paragraphCss(style);

  switch (block.kind) {
    case "role":
      // A right-aligned tab stop at the margin: the date sits on the last line
      // of the title, flush right.
      return (
        <div style={{ ...css, display: "flex", alignItems: "flex-end", gap: "1em" }}>
          <span style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{block.text}</span>
          {block.right && (
            <span
              style={{
                fontStyle: "italic",
                color: `#${data.layout.date_color}`,
                whiteSpace: "nowrap",
              }}
            >
              {block.right}
            </span>
          )}
        </div>
      );

    case "bullet":
      // "•<tab>text" against a hanging indent: the glyph fills the indent, so
      // wrapped lines align with the first word.
      return (
        <p style={css}>
          <span
            style={{
              display: "inline-block",
              width: `${style.left_indent_pt}pt`,
              textIndent: 0,
            }}
          >
            •
          </span>
          {block.text}
        </p>
      );

    case "skill_line":
      return (
        <p style={css}>
          <strong>{block.label}: </strong>
          {block.text}
        </p>
      );

    case "skills_table": {
      const { layout } = data;
      return (
        <table
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse: "collapse",
            margin: 0,
          }}
        >
          <colgroup>
            <col style={{ width: `${layout.skills_label_pt}pt` }} />
            <col />
          </colgroup>
          <tbody>
            {(block.rows ?? []).map((row, i) => (
              <tr
                key={i}
                style={{
                  // insideH only: rules between rows, no outer frame.
                  borderTop:
                    i > 0
                      ? `${layout.table_rule_pt}pt solid #${layout.table_rule_color}`
                      : undefined,
                }}
              >
                {[row.label, row.value].map((text, j) => (
                  <td
                    key={j}
                    style={{
                      padding: `0 ${layout.cell_right_margin_pt}pt 0 0`,
                      verticalAlign: "top",
                    }}
                  >
                    <p style={{ ...css, fontWeight: j === 0 ? 700 : css.fontWeight }}>
                      {text}
                    </p>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    default:
      // An empty paragraph still occupies a line in Word - the availability
      // line carries the header rule even when blank.
      return <p style={css}>{block.text || "​"}</p>;
  }
}

/**
 * Greedy page fill that honours keep-with-next the way Word does: a heading or
 * role line travels with whatever follows it. A chain taller than a page is
 * placed block by block. Trailing space-after may hang into the bottom margin.
 */
function paginate(
  metrics: { height: number; after: number }[],
  keep: boolean[],
  capacity: number,
): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  const place = (idx: number) => {
    const m = metrics[idx];
    if (used > 0 && used + m.height - m.after > capacity) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(idx);
    used += m.height;
  };

  for (let i = 0; i < metrics.length; ) {
    let j = i;
    while (j < metrics.length - 1 && keep[j]) j++;
    const chain = Array.from({ length: j - i + 1 }, (_, k) => i + k);
    const height =
      chain.reduce((sum, idx) => sum + metrics[idx].height, 0) - metrics[j].after;

    if (height <= capacity) {
      if (used > 0 && used + height > capacity) {
        pages.push([]);
        used = 0;
      }
      for (const idx of chain) {
        pages[pages.length - 1].push(idx);
        used += metrics[idx].height;
      }
    } else {
      chain.forEach(place);
    }
    i = j + 1;
  }
  return pages;
}

export function ResumePreview({
  data,
  onPageCount,
}: {
  data: ResumePreviewData;
  onPageCount?: (pages: number) => void;
}) {
  const { layout } = data;
  const pageW = layout.page_width_pt * PX_PER_PT;
  const pageH = layout.page_height_pt * PX_PER_PT;
  const contentW = (layout.page_width_pt - layout.margin_left_pt - layout.margin_right_pt) * PX_PER_PT;
  const contentH = (layout.page_height_pt - layout.margin_top_pt - layout.margin_bottom_pt) * PX_PER_PT;

  const frameRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Page splits are indices into `data.blocks`, so they are only valid for the
  // exact response they were measured from. Switching Designed/ATS changes the
  // block count, and the first render after that must not use the old split.
  const [split, setSplit] = useState<{ for: ResumePreviewData; pages: number[][] } | null>(
    null,
  );
  const pages = split?.for === data ? split.pages : null;
  const [fontsReady, setFontsReady] = useState(0);

  const fontFamily = `"${layout.font}", var(--font-carlito), Carlito, Arial, sans-serif`;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / pageW));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [pageW]);

  // Web fonts change line breaks, so measure again once they have loaded.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const metrics = Array.from(root.children).map((el) => {
      const cs = getComputedStyle(el);
      const before = parseFloat(cs.marginTop) || 0;
      const after = parseFloat(cs.marginBottom) || 0;
      return { height: el.getBoundingClientRect().height + before + after, after };
    });
    const keep = data.blocks.map((b) => data.styles[b.style]?.keep_with_next ?? false);
    const next = paginate(metrics, keep, contentH);
    setSplit({ for: data, pages: next });
    onPageCount?.(next.length);
  }, [data, contentH, fontsReady, onPageCount]);

  const sheet: CSSProperties = {
    fontFamily,
    color: "#000",
    fontKerning: "normal",
    WebkitFontSmoothing: "antialiased",
  };
  const column: CSSProperties = { display: "flex", flexDirection: "column" };

  return (
    <div ref={frameRef} className="w-full">
      {/* Off-screen copy at true size, so pagination never depends on zoom. Flex
          column stops CSS collapsing adjacent margins, which Word never does. */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          ...sheet,
          ...column,
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          left: -10_000,
          top: 0,
          width: contentW,
        }}
      >
        {data.blocks.map((block, i) => (
          <Block key={i} block={block} data={data} />
        ))}
      </div>

      <div className="flex flex-col items-center" style={{ gap: PAGE_GAP_PX }}>
        {(pages ?? [data.blocks.map((_, i) => i)]).map((indices, p) => (
          <div
            key={p}
            className="shrink-0 overflow-hidden rounded-[2px] shadow-md ring-1 ring-black/5"
            style={{ width: pageW * scale, height: pageH * scale }}
          >
            <div
              role="document"
              aria-label={`Page ${p + 1}`}
              style={{
                ...sheet,
                width: pageW,
                height: pageH,
                background: "#fff",
                padding: `${layout.margin_top_pt}pt ${layout.margin_right_pt}pt ${layout.margin_bottom_pt}pt ${layout.margin_left_pt}pt`,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                boxSizing: "border-box",
              }}
            >
              <div style={column}>
                {indices.map((i) => (
                  <Block key={i} block={data.blocks[i]} data={data} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
