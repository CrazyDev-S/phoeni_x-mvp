"use client";

import { Search, SmilePlus } from "lucide-react";
import { useState, type RefObject } from "react";

import { TOOL } from "@/components/text-style/tool";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLYPH_GROUPS, searchGlyphs, type Glyph } from "@/lib/emoji";
import { replaceRange, type Field } from "@/lib/field-edit";
import { cn } from "@/lib/utils";

const RECENT_KEY = "phoenix.recent-glyphs";
const RECENT_MAX = 16;

function readRecent(): Glyph[] {
  try {
    const chars: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    const known = new Map(GLYPH_GROUPS.flatMap((g) => g.glyphs).map((g) => [g.char, g]));
    return chars.map((c) => known.get(c) ?? { char: c, words: "" });
  } catch {
    return [];
  }
}

function remember(char: string) {
  try {
    const chars = [char, ...readRecent().map((g) => g.char).filter((c) => c !== char)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(chars));
  } catch {
    // Storage blocked: the picker still works, it just forgets.
  }
}

/** Emoji, symbols and dividers, put in at the caret. */
export function EmojiMenu({ target, disabled }: { target: RefObject<Field | null>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState(GLYPH_GROUPS[0].id);
  const [recent, setRecent] = useState<Glyph[]>([]);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setRecent(readRecent());
    }
    setOpen(next);
  };

  const pick = (char: string) => {
    setOpen(false);
    remember(char);
    const field = target.current;
    if (!field) return;
    const at = field.selectionEnd ?? field.value.length;
    replaceRange(field, field.selectionStart ?? at, at, char, "end");
  };

  const found = query.trim() ? searchGlyphs(query) : null;
  const current = GLYPH_GROUPS.find((g) => g.id === tab) ?? GLYPH_GROUPS[0];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Emoji and symbols" title="Emoji and symbols" disabled={disabled} className={TOOL}>
          <SmilePlus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-style-bar
        align="start"
        collisionPadding={8}
        className="w-[19.5rem] gap-0 p-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          target.current?.focus();
        }}
      >
        <div className="relative border-b p-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && found?.[0]) {
                e.preventDefault();
                pick(found[0].char);
              }
            }}
            placeholder="Search: rocket, check, star, divider…"
            aria-label="Search emoji and symbols"
            className="bg-muted/60 focus-visible:ring-ring/30 h-7 w-full rounded-md pr-2 pl-7 text-xs outline-none focus-visible:ring-2"
          />
        </div>

        {!found && (
          <div role="tablist" aria-label="Groups" className="flex gap-0.5 border-b px-1.5 py-1">
            {GLYPH_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={tab === g.id}
                title={g.label}
                aria-label={g.label}
                onClick={() => setTab(g.id)}
                className={cn(
                  "grid h-7 flex-1 place-items-center rounded text-base transition-colors",
                  tab === g.id ? "bg-foreground/10" : "opacity-60 hover:bg-muted hover:opacity-100",
                )}
              >
                {g.icon}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto p-1.5">
          {found ? (
            found.length ? (
              <GlyphGrid glyphs={found} onPick={pick} />
            ) : (
              <p className="text-muted-foreground px-1 py-6 text-center text-xs">Nothing matches “{query.trim()}”.</p>
            )
          ) : (
            <>
              {recent.length > 0 && tab === GLYPH_GROUPS[0].id && (
                <>
                  <GroupLabel>Recent</GroupLabel>
                  <GlyphGrid glyphs={recent} onPick={pick} />
                </>
              )}
              <GroupLabel>{current.label}</GroupLabel>
              <GlyphGrid glyphs={current.glyphs} onPick={pick} />
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-1 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">{children}</p>;
}

function GlyphGrid({ glyphs, onPick }: { glyphs: Glyph[]; onPick: (char: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {glyphs.map((g) => {
        const wide = Array.from(g.char).length > 3;
        return (
          <button
            key={g.char}
            type="button"
            title={g.words || g.char}
            aria-label={g.words || g.char}
            onClick={() => onPick(g.char)}
            className={cn(
              "hover:bg-muted focus-visible:bg-muted grid h-8 place-items-center rounded text-lg leading-none outline-none active:scale-90",
              wide && "col-span-8 justify-items-start px-2 text-sm tracking-tight",
            )}
          >
            {g.char}
          </button>
        );
      })}
    </div>
  );
}
