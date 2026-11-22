"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  Block,
  type PreviewBlock,
  type ResumePreviewData,
} from "@/components/remote/resume-blocks";

export type { ResumePreviewData } from "@/components/remote/resume-blocks";

/**
 * The .docx export, drawn as pages.
 *
 * Everything comes from POST /api/v1/remote/export/preview (see resume-blocks).
 * This component only paginates and frames the pages - it makes no content
 * decisions of its own.
 */

const PX_PER_PT = 96 / 72;
const PAGE_GAP_PX = 24;

// The faces the templates ask for, each with the metric twin Word's own face
// falls back to, so lines break where they do in the file.
const FONT_STACKS: Record<string, string> = {
  Calibri: 'var(--font-carlito), Carlito, Calibri, Arial, sans-serif',
  Arial: 'var(--font-arimo), Arimo, Arial, "Liberation Sans", sans-serif',
  Cambria: 'var(--font-caladea), Caladea, Cambria, Georgia, serif',
};

/**
 * Greedy page fill that honours keep-with-next the way Word does: a heading or
 * role line travels with whatever follows it. A chain taller than a page is
 * placed block by block. Trailing space-after may hang into the bottom margin.
 * Page one can be shorter than the rest (a band across its top).
 */
function paginate(
  metrics: { height: number; after: number }[],
  keep: boolean[],
  capacityOf: (page: number) => number,
): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  const capacity = () => capacityOf(pages.length - 1);
  const startPage = () => {
    pages.push([]);
    used = 0;
  };
  const place = (idx: number) => {
    const m = metrics[idx];
    if (used > 0 && used + m.height - m.after > capacity()) startPage();
    pages[pages.length - 1].push(idx);
    used += m.height;
  };

  for (let i = 0; i < metrics.length; ) {
    let j = i;
    while (j < metrics.length - 1 && keep[j]) j++;
    const chain = Array.from({ length: j - i + 1 }, (_, k) => i + k);
    const height = chain.reduce((sum, idx) => sum + metrics[idx].height, 0) - metrics[j].after;

    if (height <= capacity()) {
      if (used > 0 && used + height > capacity()) startPage();
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

const column: CSSProperties = { display: "flex", flexDirection: "column" };

/** The coloured band across the top of page one. */
function Band({ data, blocks, width }: { data: ResumePreviewData; blocks: PreviewBlock[]; width: number }) {
  const { layout } = data;
  return (
    <div
      style={{
        ...column,
        boxSizing: "border-box",
        width,
        background: `#${layout.band_fill}`,
        padding: `${layout.band_pad_top_pt}pt ${layout.margin_right_pt}pt ${layout.band_pad_bottom_pt}pt ${layout.margin_left_pt}pt`,
      }}
    >
      {blocks.map((block, i) => (
        <Block key={i} block={block} data={data} />
      ))}
    </div>
  );
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
  const marginTop = layout.margin_top_pt * PX_PER_PT;
  const marginBottom = layout.margin_bottom_pt * PX_PER_PT;
  const contentW = (layout.page_width_pt - layout.margin_left_pt - layout.margin_right_pt) * PX_PER_PT;
  const contentH = pageH - marginTop - marginBottom;

  const band = useMemo(() => data.blocks.filter((b) => b.region === "band"), [data]);
  const body = useMemo(() => data.blocks.filter((b) => b.region === "body"), [data]);
  const hasBand = layout.band_fill !== null && band.length > 0;

  const frameRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Page splits are indices into `body`, so they are only valid for the exact
  // response they were measured from. Switching template or profile changes
  // the blocks, and the first render after that must not use the old split.
  const [split, setSplit] = useState<{ for: ResumePreviewData; pages: number[][]; bandH: number } | null>(null);
  const pages = split?.for === data ? split.pages : null;
  const bandH = split?.for === data ? split.bandH : 0;
  const [fontsReady, setFontsReady] = useState(0);

  const fontFamily = FONT_STACKS[layout.font] ?? `"${layout.font}", Arial, sans-serif`;

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
    const keep = body.map((b) => data.styles[b.style]?.keep_with_next ?? false);

    // Word starts the body below the first-page header or at the top margin,
    // whichever is lower.
    const measuredBand = bandRef.current?.getBoundingClientRect().height ?? 0;
    const firstTop = Math.max(marginTop, measuredBand);
    const firstCapacity = pageH - firstTop - marginBottom;

    const next = paginate(metrics, keep, (page) => (page === 0 ? firstCapacity : contentH));
    setSplit({ for: data, pages: next, bandH: measuredBand });
    onPageCount?.(next.length);
  }, [data, body, pageH, marginTop, marginBottom, contentH, fontsReady, onPageCount]);

  const sheet: CSSProperties = {
    fontFamily,
    color: "#000",
    fontKerning: "normal",
    WebkitFontSmoothing: "antialiased",
  };

  return (
    <div ref={frameRef} className="w-full">
      {/* Off-screen copies at true size, so pagination never depends on zoom. Flex
          column stops CSS collapsing adjacent margins, which Word never does. */}
      <div
        aria-hidden
        style={{
          ...sheet,
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          left: -10_000,
          top: 0,
        }}
      >
        {hasBand && (
          <div ref={bandRef} style={{ width: pageW }}>
            <Band data={data} blocks={band} width={pageW} />
          </div>
        )}
        <div ref={measureRef} style={{ ...column, width: contentW }}>
          {body.map((block, i) => (
            <Block key={i} block={block} data={data} />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center" style={{ gap: PAGE_GAP_PX }}>
        {(pages ?? [body.map((_, i) => i)]).map((indices, p) => {
          const withBand = p === 0 && hasBand;
          return (
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
                  position: "relative",
                  width: pageW,
                  height: pageH,
                  background: "#fff",
                  padding: `${withBand ? Math.max(marginTop, bandH) : marginTop}px ${layout.margin_right_pt}pt ${layout.margin_bottom_pt}pt ${layout.margin_left_pt}pt`,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  boxSizing: "border-box",
                }}
              >
                {withBand && (
                  <div style={{ position: "absolute", top: 0, left: 0 }}>
                    <Band data={data} blocks={band} width={pageW} />
                  </div>
                )}
                <div style={column}>
                  {indices.map((i) => (
                    <Block key={i} block={body[i]} data={data} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
