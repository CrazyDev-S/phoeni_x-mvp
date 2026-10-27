"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_PALETTE,
  PALETTE_STORAGE_KEY,
  isPaletteId,
  type PaletteId,
} from "@/lib/palettes";

const EVENT = "ra:palette";

function read(): PaletteId {
  try {
    const saved = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPaletteId(saved) ? saved : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

function subscribe(onChange: () => void) {
  // "storage" carries a change made in another tab; EVENT one made in this one.
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The active colour palette and a setter that applies it at once and remembers it. */
export function usePalette() {
  const palette = useSyncExternalStore(subscribe, read, () => DEFAULT_PALETTE);

  const setPalette = useCallback((next: PaletteId) => {
    const root = document.documentElement;
    if (next === DEFAULT_PALETTE) delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // Private mode: the palette still applies for this page view.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { palette, setPalette };
}
