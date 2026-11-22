"use client";

import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ComponentType, type RefObject } from "react";

import { EmojiMenu } from "@/components/text-style/emoji-menu";
import { FontMenu } from "@/components/text-style/font-menu";
import { keepFocus, TOOL } from "@/components/text-style/tool";
import { pressStyle, styleActive, subscribeTyping, toggleList, typingVersion, type Field } from "@/lib/field-edit";
import type { StyleId } from "@/lib/text-styles";
import { cn } from "@/lib/utils";

const QUICK: { id: StyleId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "bold", label: "Bold (Ctrl+B)", icon: Bold },
  { id: "italic", label: "Italic (Ctrl+I)", icon: Italic },
  { id: "underline", label: "Underline (Ctrl+U)", icon: Underline },
  { id: "strike", label: "Strikethrough", icon: Strikethrough },
];

export interface StyleBarProps {
  /** The field the bar styles. */
  target: RefObject<Field | null>;
  /** Adds bulleted and numbered line buttons. */
  lists?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Re-render whenever the target's selection, text or typing style may have changed. */
function useFieldTick(target: RefObject<Field | null>) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (e: Event) => {
      if (e.target === document || e.target === target.current) setTick((t) => t + 1);
    };
    const events = ["selectionchange", "select", "input", "keyup", "mouseup", "focusin"];
    events.forEach((name) => document.addEventListener(name, bump, true));
    return () => events.forEach((name) => document.removeEventListener(name, bump, true));
  }, [target]);
  useSyncExternalStore(subscribeTyping, typingVersion, typingVersion);
}

/**
 * Bold, italic, underline and strikethrough, every other "font", and emoji -
 * all as Unicode characters, so they survive any plain-text box they are
 * pasted into. Works on a selection, or at the caret for what is typed next.
 */
export function StyleBar({ target, lists, disabled, className }: StyleBarProps) {
  useFieldTick(target);
  const el = target.current;
  const run = (fn: (field: Field) => void) => () => {
    if (target.current) fn(target.current);
  };

  return (
    <div role="toolbar" aria-label="Text style" data-style-bar onMouseDown={keepFocus} className={cn("flex items-center gap-0.5", className)}>
      {QUICK.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={el ? styleActive(el, id) : false}
          disabled={disabled}
          onClick={run((field) => pressStyle(field, id))}
          className={TOOL}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      <span className="bg-border mx-1 h-4 w-px" aria-hidden />
      <FontMenu target={target} disabled={disabled} />
      <EmojiMenu target={target} disabled={disabled} />
      {lists && (
        <>
          <span className="bg-border mx-1 h-4 w-px" aria-hidden />
          <button type="button" aria-label="Bulleted list" title="Bulleted list" disabled={disabled} onClick={run((f) => toggleList(f, "bullets"))} className={TOOL}>
            <List className="size-3.5" />
          </button>
          <button type="button" aria-label="Numbered list" title="Numbered list" disabled={disabled} onClick={run((f) => toggleList(f, "numbers"))} className={TOOL}>
            <ListOrdered className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
