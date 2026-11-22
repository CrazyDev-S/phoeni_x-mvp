"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { StyleBar } from "@/components/text-style/style-bar";
import { keepFocus } from "@/components/text-style/tool";
import { pressStyle, replaceRange, setTypingStyles, styledField, styleTyped, type Field } from "@/lib/field-edit";
import type { StyleId } from "@/lib/text-styles";

const SHORTCUTS: Record<string, StyleId> = { b: "bold", i: "italic", u: "underline" };

/** The bar's height and the gap it keeps from the field. */
const BAR_H = 32;
const GAP = 4;
/** Below this the app's top bar would cover it. */
const TOP_LIMIT = 48;

/**
 * Mounted once: every styled field (every Textarea, any input marked
 * data-styled) gets Ctrl+B / I / U, typing in a pressed style, and - unless
 * the field carries its own bar (data-styled="inline") - a style bar floating
 * over its top-right corner while it has focus.
 */
export function TextStyler() {
  const [field, setField] = useState<Field | null>(null);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const active = useRef<Field | null>(null);
  const target = useRef<Field | null>(null);
  target.current = field;

  useEffect(() => {
    const choose = (el: Field | null) => {
      if (active.current === el) return;
      // A typing style belongs to one stretch of typing in one field.
      if (active.current) setTypingStyles(active.current, []);
      active.current = el;
      setField(el);
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = styledField(e.target);
      if (el) choose(el);
      else if (!(e.target instanceof Element && e.target.closest("[data-style-bar]"))) choose(null);
    };
    const onFocusOut = (e: FocusEvent) => {
      // Focus leaving for nothing (the page, another window); a focusin covers the rest.
      if (styledField(e.target) && !e.relatedTarget) choose(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = styledField(e.target);
      const id = SHORTCUTS[e.key.toLowerCase()];
      if (!el || !id || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      pressStyle(el, id);
    };
    const onBeforeInput = (e: InputEvent) => {
      const el = styledField(e.target);
      if (!el || e.inputType !== "insertText" || !e.data) return;
      const out = styleTyped(el, e.data);
      if (out == null || out === e.data) return;
      e.preventDefault();
      replaceRange(el, el.selectionStart ?? 0, el.selectionEnd ?? 0, out, "end");
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, []);

  useEffect(() => {
    if (!field || field.dataset.styled !== "float") {
      setBox(null);
      return;
    }
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = field.getBoundingClientRect();
        const offscreen = r.bottom < TOP_LIMIT || r.top > window.innerHeight;
        if (!field.isConnected || field.disabled || field.readOnly || offscreen) return setBox(null);
        let top = r.top - BAR_H - GAP;
        if (top < TOP_LIMIT) {
          // No room above: under the field, or pinned inside its top edge when it is taller than the view.
          top = r.bottom + GAP + BAR_H < window.innerHeight ? r.bottom + GAP : Math.max(TOP_LIMIT, r.top + GAP);
        }
        setBox({ top, right: Math.max(8, window.innerWidth - r.right) });
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(field);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [field]);

  if (!field || !box) return null;
  return createPortal(
    <div
      data-style-bar
      onMouseDown={keepFocus}
      style={{ top: box.top, right: box.right }}
      className="bg-popover text-popover-foreground ring-foreground/10 animate-in fade-in-0 zoom-in-95 fixed z-50 rounded-md p-0.5 shadow-md ring-1 duration-100"
    >
      <StyleBar target={target} />
    </div>,
    document.body,
  );
}
