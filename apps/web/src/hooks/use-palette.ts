"use client";

import { useEffect, useState } from "react";

import { DEFAULT_PALETTE, PALETTE_KEY, isPalette, type Palette } from "@/lib/palette";

/**
 * The palette stored on this device, and a setter that applies it at once.
 *
 * The first render always reports the default - there is no localStorage on
 * the server - and the stored value lands on mount. The page is painted in the
 * right palette regardless: PALETTE_SCRIPT set the attribute before hydration.
 */
export function usePalette() {
  const [palette, setState] = useState<Palette>(DEFAULT_PALETTE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PALETTE_KEY);
      if (isPalette(stored)) setState(stored);
    } catch {
      // Storage is blocked; the default is all there is.
    }
  }, []);

  function setPalette(next: Palette) {
    const root = document.documentElement;
    if (next === DEFAULT_PALETTE) delete root.dataset.palette;
    else root.dataset.palette = next;
    try {
      localStorage.setItem(PALETTE_KEY, next);
    } catch {
      // Applied for this visit; it just will not survive a reload.
    }
    setState(next);
  }

  return { palette, setPalette };
}
