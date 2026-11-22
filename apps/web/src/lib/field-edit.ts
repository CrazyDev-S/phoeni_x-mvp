/**
 * Editing a text field from outside it - a style button, a picked emoji -
 * as if the user had typed: React's onChange fires and Ctrl+Z undoes it.
 */

import { applyStyle, hasStyle, isLine, toggleStyle, type StyleId } from "@/lib/text-styles";

export type Field = HTMLTextAreaElement | HTMLInputElement;

/** A field that takes styled text: every Textarea, and any input marked data-styled. */
export const STYLED = "textarea[data-styled], input[data-styled]";

export function styledField(node: EventTarget | null): Field | null {
  return node instanceof HTMLElement && node.matches(STYLED) ? (node as Field) : null;
}

let inserting = false;

/** Put text in place of [from, to), then select it (or put the caret after it). */
export function replaceRange(el: Field, from: number, to: number, text: string, caret: "select" | "end" = "select") {
  el.focus();
  el.setSelectionRange(from, to);
  inserting = true;
  // execCommand is deprecated but is still the only edit that joins the native undo stack.
  const done = document.execCommand("insertText", false, text);
  inserting = false;
  if (!done || el.value.slice(from, from + text.length) !== text) {
    el.setRangeText(text, from, to);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const end = from + text.length;
  el.setSelectionRange(caret === "select" ? from : end, end);
}

export const selectedText = (el: Field) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);

// -- typing in a style: B pressed with nothing selected styles what comes next

const typing = new WeakMap<Field, StyleId[]>();
const listeners = new Set<() => void>();
let version = 0;

export const typingStyles = (el: Field | null): StyleId[] => (el && typing.get(el)) || [];

export function setTypingStyles(el: Field, styles: StyleId[]) {
  if (styles.length) typing.set(el, styles);
  else typing.delete(el);
  version++;
  listeners.forEach((fn) => fn());
}

export function subscribeTyping(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const typingVersion = () => version;

/**
 * A style button: on a selection it toggles the style there; at a bare caret it
 * toggles typing in that style. One letter style at a time, lines on top.
 */
export function pressStyle(el: Field, id: StyleId) {
  const from = el.selectionStart ?? 0;
  const to = el.selectionEnd ?? 0;
  if (from !== to) {
    replaceRange(el, from, to, toggleStyle(el.value.slice(from, to), id));
    return;
  }
  const now = typingStyles(el);
  const next = now.includes(id) ? now.filter((s) => s !== id) : [...now.filter((s) => isLine(s) || isLine(id)), id];
  setTypingStyles(el, next);
  el.focus();
}

/** Whether the style is on: across the whole selection, or for typing at the caret. */
export function styleActive(el: Field, id: StyleId): boolean {
  const text = selectedText(el);
  return text ? hasStyle(text, id) : typingStyles(el).includes(id);
}

/** What a keystroke becomes while typing in a style; null when there is none. */
export function styleTyped(el: Field, data: string): string | null {
  if (inserting) return null;
  const styles = typingStyles(el);
  if (!styles.length) return null;
  // Letter style first, so a line lands on the styled letter.
  return [...styles].sort((a, b) => Number(isLine(a)) - Number(isLine(b))).reduce(applyStyle, data);
}

// -- lists, for the letter: "• " or "1. " at the start of each selected line

const MARK = { bullets: /^• /, numbers: /^\d+\. / } as const;

export function toggleList(el: Field, kind: keyof typeof MARK) {
  const { value } = el;
  const from = el.selectionStart ?? 0;
  const to = el.selectionEnd ?? 0;
  const start = value.lastIndexOf("\n", from - 1) + 1;
  const endAt = value.indexOf("\n", to);
  const end = endAt === -1 ? value.length : endAt;
  const lines = value.slice(start, end).split("\n");
  const on = lines.every((line) => MARK[kind].test(line));
  const block = lines
    .map((line, i) => {
      const bare = line.replace(MARK.bullets, "").replace(MARK.numbers, "");
      return on ? bare : `${kind === "bullets" ? "•" : `${i + 1}.`} ${bare}`;
    })
    .join("\n");
  replaceRange(el, start, end, block);
}
