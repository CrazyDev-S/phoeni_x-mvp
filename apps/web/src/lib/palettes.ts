/**
 * The colour palettes a person can pick in Settings > Appearance.
 *
 * A palette is a CSS file in styles/palettes/ that re-declares the colour
 * tokens under data-theme="<id>" on <html>, plus an entry below. The default
 * needs no file: it is the bare :root in globals.css. Light and dark mode are
 * separate (next-themes owns the .dark class), so each palette ships both.
 *
 * To add one: copy styles/palettes/prussian.css, change the id in its
 * selectors and the values, @import it in globals.css, and add it to PALETTES.
 *
 * Deliberately free of hooks, components and "use client": the root layout is a
 * server component and inlines PALETTE_SCRIPT from here.
 */
export const PALETTES = [
  {
    id: "ember",
    name: "Ember",
    description: "Warm stone with ember and teal.",
    // Canvas, ink, Remote accent, Freelancing accent: what the picker previews.
    swatches: ["#edeae5", "#2b2825", "#ff6f3c", "#34d1b1"],
  },
  {
    id: "prussian",
    name: "Prussian",
    description: "Papaya on navy, with peach and slate.",
    swatches: ["#ffefd3", "#294c60", "#ffc49b", "#9fb4d2"],
  },
  {
    id: "blush",
    name: "Blush",
    description: "Eggshell and slate, with blush and aqua.",
    swatches: ["#faf3dd", "#5e6472", "#ffa69e", "#b8f2e6"],
  },
  {
    id: "orchid",
    name: "Orchid",
    description: "Pale pink on velvet purple.",
    swatches: ["#fff0f4", "#643a71", "#fec0ce", "#d183c9"],
  },
  {
    id: "wisteria",
    name: "Wisteria",
    description: "Porcelain on indigo, with plum and sky.",
    swatches: ["#f4f4ed", "#3a428a", "#f7aef8", "#72ddf7"],
  },
  {
    id: "sky",
    name: "Sky",
    description: "Soft lavender on dusk blue.",
    swatches: ["#eeecf8", "#2f4a6d", "#eac5d8", "#56cbf9"],
  },
  {
    id: "mint",
    name: "Mint",
    description: "Pale mint on granite, with aqua and cyan.",
    swatches: ["#eaf6f0", "#5c6f68", "#95d9c3", "#a7fff6"],
  },
  {
    id: "linen",
    name: "Linen",
    description: "Neutral greys on carbon.",
    swatches: ["#ecebe4", "#1c1c1c", "#daddd8", "#c3c9d3"],
  },
  {
    id: "twitter",
    name: "Twitter",
    description: "Twitter blue on slate and cool greys.",
    swatches: ["#e6ecf0", "#15202b", "#1da1f2", "#aab8c2"],
  },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const DEFAULT_PALETTE: PaletteId = "ember";
export const PALETTE_STORAGE_KEY = "ra.palette";

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.some((p) => p.id === value);
}

/**
 * Sets data-theme on <html> before first paint, so a saved palette never
 * flashes the default. A string rather than a module: it has to run before any
 * bundle has loaded. Unknown or default ids leave the attribute off.
 */
export const PALETTE_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});if(p&&p!==${JSON.stringify(DEFAULT_PALETTE)}&&${JSON.stringify(PALETTES.map((x) => x.id))}.indexOf(p)>-1)document.documentElement.dataset.theme=p}catch(e){}`;
