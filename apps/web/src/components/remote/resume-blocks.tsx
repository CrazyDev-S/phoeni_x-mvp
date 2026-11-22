import type { CSSProperties } from "react";

import { Glyph, type IconLook } from "@/components/remote/resume-glyph";

/**
 * The .docx export as data, and how each piece of it is drawn.
 *
 * Everything arrives from POST /api/v1/remote/export/preview, which runs the
 * docx renderer's own section code and reads styles back off the same carrier
 * the download is built from. Nothing here decides content or colour; it only
 * translates Word's units to CSS.
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
  center: boolean;
  left_indent_pt: number;
  right_indent_pt: number;
  first_line_indent_pt: number;
  keep_with_next: boolean;
  shading: string | null;
  border_top: PreviewBorder | null;
  border_bottom: PreviewBorder | null;
}

export interface PreviewBlock {
  kind: "paragraph" | "heading" | "contact" | "role" | "bullet" | "skill_line" | "skills_table" | "skills_grid";
  style: string;
  text: string;
  /** Follows a bold `text` on the same line (the organisation after a title). */
  rest: string | null;
  right: string | null;
  label: string | null;
  icon: string | null;
  items: { icon: string; text: string }[] | null;
  rows: { label: string; value: string }[] | null;
  /** "band" blocks sit in the coloured band on page one, outside the flow. */
  region: "band" | "body";
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
    bullet: string;
    date_italic: boolean;
    rest_italic: boolean;
    skills_cols: number;
    contact_cols: number;
    contact_hang_pt: number;
    contact_icon: IconLook | null;
    heading_icon: IconLook | null;
    band_fill: string | null;
    band_pad_top_pt: number;
    band_pad_bottom_pt: number;
  };
  styles: Record<string, PreviewStyle>;
  blocks: PreviewBlock[];
}

// Word's "multiple" line spacing scales the font's own line height, which for
// Calibri (and metric-compatible Carlito) is 1.22em - not CSS's 1.0.
export const FONT_LINE_HEIGHT = 1.22;

// The same characters the .docx uses between an icon and its text and between
// contact items on a line.
const ICON_GAP = " ";
const ITEM_GAP = "  ";
const TRAIL_GAP = " ";

export function paragraphCss(s: PreviewStyle): CSSProperties {
  const top = s.border_top;
  const bottom = s.border_bottom;
  return {
    margin: 0,
    marginTop: `${s.space_before_pt}pt`,
    marginBottom: `${s.space_after_pt}pt`,
    // Word's right indent shortens the paragraph, border and all.
    marginRight: s.right_indent_pt ? `${s.right_indent_pt}pt` : undefined,
    fontSize: `${s.size_pt}pt`,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textTransform: s.all_caps ? "uppercase" : undefined,
    color: s.color ? `#${s.color}` : "#000",
    lineHeight: FONT_LINE_HEIGHT * s.line_spacing,
    textAlign: s.center ? "center" : s.justify ? "justify" : "left",
    paddingLeft: s.left_indent_pt ? `${s.left_indent_pt}pt` : undefined,
    textIndent: s.first_line_indent_pt ? `${s.first_line_indent_pt}pt` : undefined,
    background: s.shading ? `#${s.shading}` : undefined,
    paddingTop: top ? `${top.space_pt}pt` : undefined,
    borderTop: top ? `${top.width_pt}pt solid #${top.color}` : undefined,
    paddingBottom: bottom ? `${bottom.space_pt}pt` : undefined,
    borderBottom: bottom ? `${bottom.width_pt}pt solid #${bottom.color}` : undefined,
    // Word keeps runs of spaces (the languages line joins entries with three).
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  };
}

export function Block({ block, data }: { block: PreviewBlock; data: ResumePreviewData }) {
  const { layout } = data;
  const style = data.styles[block.style];
  const css = paragraphCss(style);

  switch (block.kind) {
    case "role":
      // A right-aligned tab stop at the margin: the date sits on the last line
      // of the title, flush right.
      return (
        <div style={{ ...css, display: "flex", alignItems: "flex-end", gap: "1em" }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>{block.text}</span>
            {block.rest && (
              <span style={{ fontStyle: layout.rest_italic ? "italic" : "normal" }}>{block.rest}</span>
            )}
          </span>
          {block.right && (
            <span
              style={{
                fontStyle: layout.date_italic ? "italic" : "normal",
                color: `#${layout.date_color}`,
                whiteSpace: "nowrap",
              }}
            >
              {block.right}
            </span>
          )}
        </div>
      );

    case "heading":
      return (
        <p
          style={{
            ...css,
            display: "flex",
            alignItems: "baseline",
            justifyContent: style.center ? "center" : "flex-start",
          }}
        >
          {block.icon && layout.heading_icon && (
            <>
              <Glyph name={block.icon} look={layout.heading_icon} heightPt={style.size_pt * 1.25} />
              <span style={{ whiteSpace: "pre" }}>{ICON_GAP}</span>
            </>
          )}
          <span>{block.text}</span>
        </p>
      );

    case "contact": {
      const items = block.items ?? [];
      const look = layout.contact_icon;
      const height = style.size_pt * 1.35;

      if (layout.contact_cols) {
        // One cell per item, wrapped text hanging under its first word.
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${layout.contact_cols}, minmax(0, 1fr))`,
              columnGap: `${layout.cell_right_margin_pt}pt`,
            }}
          >
            {items.map((item, i) => (
              <p key={i} style={{ ...css, display: "flex" }}>
                {look && (
                  <span style={{ width: `${layout.contact_hang_pt}pt`, flexShrink: 0 }}>
                    <Glyph name={item.icon} look={look} heightPt={height} />
                  </span>
                )}
                <span style={{ minWidth: 0 }}>{item.text}</span>
              </p>
            ))}
          </div>
        );
      }

      // A flowing row: one paragraph, so it wraps like text.
      return (
        <p style={css}>
          {items.map((item, i) => (
            <span key={i}>
              {i > 0 && ITEM_GAP}
              {look && (
                <>
                  <Glyph name={item.icon} look={look} heightPt={height} />
                  {ICON_GAP}
                </>
              )}
              {item.text}
            </span>
          ))}
        </p>
      );
    }

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
            {layout.bullet}
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

    case "skills_table":
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
                    <p style={{ ...css, fontWeight: j === 0 ? 700 : css.fontWeight }}>{text}</p>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case "skills_grid":
      // Each category a labelled cell; the cells run across, then down.
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${layout.skills_cols}, minmax(0, 1fr))`,
            columnGap: "10.8pt",
          }}
        >
          {(block.rows ?? []).map((row, i) => (
            <div key={i}>
              <p style={{ ...css, fontWeight: 700, marginBottom: 0 }}>{row.label}</p>
              <p style={{ ...css, marginBottom: "5pt" }}>{row.value}</p>
            </div>
          ))}
        </div>
      );

    default:
      // An empty paragraph still occupies a line in Word.
      return <p style={css}>{block.text || "\u200b"}</p>;
  }
}
