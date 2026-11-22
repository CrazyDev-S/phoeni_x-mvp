import type { MouseEvent } from "react";

/** A style bar button: 28px, flat, pressed and open states shaded. */
export const TOOL =
  "text-foreground/75 hover:bg-muted aria-pressed:bg-foreground/10 aria-pressed:text-foreground aria-expanded:bg-muted focus-visible:ring-ring/40 grid size-7 shrink-0 place-items-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40";

/** Keeps focus - and so the selection - in the field while the bar is clicked. */
export function keepFocus(e: MouseEvent) {
  // React bubbles events out of portals; only the bar's own DOM, not a menu it opened.
  if (e.currentTarget.contains(e.target as Node)) e.preventDefault();
}
