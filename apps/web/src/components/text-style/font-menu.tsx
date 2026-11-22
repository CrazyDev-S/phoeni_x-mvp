"use client";

import { CaseSensitive, Check, ChevronDown, RemoveFormatting } from "lucide-react";
import { useState, type RefObject } from "react";

import { TOOL } from "@/components/text-style/tool";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pressStyle, replaceRange, selectedText, setTypingStyles, styleActive, type Field } from "@/lib/field-edit";
import { applyStyle, plain, STYLES, type StyleId, type TextStyle } from "@/lib/text-styles";
import { cn } from "@/lib/utils";

const GROUPS = STYLES.reduce<[string, TextStyle[]][]>((acc, style) => {
  const last = acc.at(-1);
  if (last?.[0] === style.group) last[1].push(style);
  else acc.push([style.group, [style]]);
  return acc;
}, []);

/** At most this many characters of the selection in each preview row. */
const PREVIEW_CHARS = 28;

/** Every style, each row previewing the selection in it - or its own name when nothing is selected. */
export function FontMenu({ target, disabled }: { target: RefObject<Field | null>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState("");
  const el = target.current;

  const onOpenChange = (next: boolean) => {
    if (next) {
      const picked = target.current ? selectedText(target.current).replace(/\s+/g, " ").trim() : "";
      const chars = Array.from(picked);
      setSample(chars.length > PREVIEW_CHARS ? chars.slice(0, PREVIEW_CHARS).join("") + "…" : picked);
    }
    setOpen(next);
  };

  const pick = (id: StyleId | null) => {
    setOpen(false);
    const field = target.current;
    if (!field) return;
    if (id) return pressStyle(field, id);
    const from = field.selectionStart ?? 0;
    const to = field.selectionEnd ?? 0;
    if (from !== to) replaceRange(field, from, to, plain(field.value.slice(from, to)));
    else setTypingStyles(field, []);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Fonts" title="Fonts" disabled={disabled} className={cn(TOOL, "flex w-auto gap-0.5 px-1")}>
          <CaseSensitive className="size-4" />
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-style-bar
        align="start"
        collisionPadding={8}
        className="w-72 gap-0 p-0"
        // Focus the panel, not its first button: a ring on "Plain" reads as the current style.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          target.current?.focus();
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-muted-foreground min-w-0 truncate text-xs">{sample ? "Restyle the selection" : "Pick a style, then type"}</p>
          <button type="button" onClick={() => pick(null)} className="text-muted-foreground hover:text-foreground hover:bg-muted flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs">
            <RemoveFormatting className="size-3.5" />
            Plain
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {GROUPS.map(([group, styles]) => (
            <div key={group} role="group" aria-label={group}>
              <p className="text-muted-foreground px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">{group}</p>
              {styles.map((style) => {
                const on = el ? styleActive(el, style.id) : false;
                return (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(style.id)}
                    className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-left outline-none"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-6">{applyStyle(sample || style.label, style.id)}</span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">{style.label}</span>
                    <Check className={cn("text-brand size-3.5 shrink-0", !on && "invisible")} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
