/**
 * The colour palettes a user can pick in Settings -> Appearance.
 *
 * Deliberately free of hooks and "use client": the root layout is a server
 * component and inlines PALETTE_SCRIPT from here.
 */
export const PALETTES = [
  { value: "phoenix", label: "Phoenix", swatches: ["#f6a228", "#f4562c", "#d32127"] },
  { value: "blue", label: "Blue", swatches: ["#93c5fd", "#3b82f6", "#1d4ed8"] },
] as const;

export type Palette = (typeof PALETTES)[number]["value"];

/** Phoenix is the bare :root palette in globals.css, so it needs no attribute. */
export const DEFAULT_PALETTE: Palette = "phoenix";

export const PALETTE_KEY = "palette";

export function isPalette(value: unknown): value is Palette {
  return PALETTES.some((p) => p.value === value);
}

/**
 * Runs in <head> before first paint, so a stored palette never flashes the
 * default first. A string rather than a module: it has to run before any
 * bundle has loaded.
 */
export const PALETTE_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});if(p&&p!==${JSON.stringify(DEFAULT_PALETTE)})document.documentElement.dataset.palette=p}catch(e){}`;
