/**
 * "Fonts" that survive a plain-text box.
 *
 * Upwork's fields - cover letter, answers, profile overview - and most others
 * keep no formatting, so a bold that is to reach the client has to be in the
 * characters themselves: Unicode's mathematical, enclosed and fullwidth
 * letters, or a combining line drawn under or through each one. Every style
 * maps plain ASCII to its look and back, so styles swap and toggle off cleanly.
 * The backend writes the same bold and italic (backend/app/freelancing/upwork_text.py).
 */

export type StyleId =
  | "bold"
  | "italic"
  | "boldItalic"
  | "serifBold"
  | "serifItalic"
  | "serifBoldItalic"
  | "script"
  | "boldScript"
  | "fraktur"
  | "boldFraktur"
  | "doubleStruck"
  | "sans"
  | "mono"
  | "smallCaps"
  | "wide"
  | "circled"
  | "circledDark"
  | "squared"
  | "squaredDark"
  | "underline"
  | "strike";

export interface TextStyle {
  id: StyleId;
  label: string;
  group: string;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const char = (cp: number) => String.fromCodePoint(cp);

/** A run of consecutive code points per alphabet, with Unicode's older letters filling its holes. */
function shifted(upper: number, lower: number | null, digit: number | null, holes: Record<string, number> = {}) {
  const map = new Map<string, string>();
  [...UPPER].forEach((c, i) => map.set(c, char(upper + i)));
  [...LOWER].forEach((c, i) => map.set(c, lower == null ? char(upper + i) : char(lower + i)));
  if (digit != null) [...DIGITS].forEach((c, i) => map.set(c, char(digit + i)));
  for (const [c, cp] of Object.entries(holes)) map.set(c, char(cp));
  return map;
}

function listed(plain: string, styled: string) {
  const to = [...styled];
  return new Map([...plain].map((c, i) => [c, to[i]] as const).filter(([c, s]) => s && s !== c));
}

const LETTERS: Partial<Record<StyleId, Map<string, string>>> = {
  bold: shifted(0x1d5d4, 0x1d5ee, 0x1d7ec),
  italic: shifted(0x1d608, 0x1d622, null),
  boldItalic: shifted(0x1d63c, 0x1d656, null),
  serifBold: shifted(0x1d400, 0x1d41a, 0x1d7ce),
  serifItalic: shifted(0x1d434, 0x1d44e, null, { h: 0x210e }),
  serifBoldItalic: shifted(0x1d468, 0x1d482, null),
  script: shifted(0x1d49c, 0x1d4b6, null, {
    B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b,
    e: 0x212f, g: 0x210a, o: 0x2134,
  }),
  boldScript: shifted(0x1d4d0, 0x1d4ea, null),
  fraktur: shifted(0x1d504, 0x1d51e, null, { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 }),
  boldFraktur: shifted(0x1d56c, 0x1d586, null),
  doubleStruck: shifted(0x1d538, 0x1d552, 0x1d7d8, {
    C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124,
  }),
  sans: shifted(0x1d5a0, 0x1d5ba, 0x1d7e2),
  mono: shifted(0x1d670, 0x1d68a, 0x1d7f6),
  smallCaps: listed(LOWER, "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ"),
  wide: new Map(
    Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => [char(0x21 + i), char(0xff01 + i)] as const),
  ),
  circled: (() => {
    const map = shifted(0x24b6, 0x24d0, null);
    map.set("0", "⓪");
    [..."123456789"].forEach((c, i) => map.set(c, char(0x2460 + i)));
    return map;
  })(),
  circledDark: (() => {
    const map = shifted(0x1f150, null, null);
    map.set("0", "⓿");
    [..."123456789"].forEach((c, i) => map.set(c, char(0x2776 + i)));
    return map;
  })(),
  squared: shifted(0x1f130, null, null),
  squaredDark: shifted(0x1f170, null, null),
};

/** Lines drawn by a combining mark after each character. */
const LINES: Partial<Record<StyleId, string>> = { underline: "̲", strike: "̶" };

export const STYLES: TextStyle[] = [
  { id: "bold", label: "Bold", group: "Everyday" },
  { id: "italic", label: "Italic", group: "Everyday" },
  { id: "boldItalic", label: "Bold italic", group: "Everyday" },
  { id: "underline", label: "Underline", group: "Everyday" },
  { id: "strike", label: "Strikethrough", group: "Everyday" },
  { id: "serifBold", label: "Serif bold", group: "Serif" },
  { id: "serifItalic", label: "Serif italic", group: "Serif" },
  { id: "serifBoldItalic", label: "Serif bold italic", group: "Serif" },
  { id: "sans", label: "Sans", group: "Clean" },
  { id: "mono", label: "Monospace", group: "Clean" },
  { id: "smallCaps", label: "Small caps", group: "Clean" },
  { id: "wide", label: "Wide", group: "Clean" },
  { id: "script", label: "Script", group: "Decorative" },
  { id: "boldScript", label: "Bold script", group: "Decorative" },
  { id: "fraktur", label: "Gothic", group: "Decorative" },
  { id: "boldFraktur", label: "Bold gothic", group: "Decorative" },
  { id: "doubleStruck", label: "Outline", group: "Decorative" },
  { id: "circled", label: "Circled", group: "Badges" },
  { id: "circledDark", label: "Circled dark", group: "Badges" },
  { id: "squared", label: "Squared", group: "Badges" },
  { id: "squaredDark", label: "Squared dark", group: "Badges" },
];

/** Every styled character back to the plain one it was made from. */
const PLAIN = new Map<string, string>();
for (const map of Object.values(LETTERS)) for (const [plain, styled] of map) if (!PLAIN.has(styled)) PLAIN.set(styled, plain);
const MARKS = new Set(Object.values(LINES));

/** Where a line mark may go: on letters, digits and punctuation - not spaces, other marks or emoji. */
const LINEABLE = /^[^\s\p{M}\p{Extended_Pictographic}‍️]$/u;

const plainChar = (c: string) => PLAIN.get(c) ?? c;

/** The text with every letter style undone; line marks stay. */
function unletter(text: string): string {
  return Array.from(text, plainChar).join("");
}

/** The text with no style at all. */
export function plain(text: string): string {
  return Array.from(text, (c) => (MARKS.has(c) ? "" : plainChar(c))).join("");
}

function withLine(text: string, mark: string): string {
  return Array.from(text, (c) => (MARKS.has(c) && c === mark ? "" : c))
    .map((c) => (c && LINEABLE.test(c) ? c + mark : c))
    .join("");
}

/** The text in one style. Letter styles replace each other; lines add on top. */
export function applyStyle(text: string, id: StyleId): string {
  const mark = LINES[id];
  if (mark) return withLine(text, mark);
  const map = LETTERS[id]!;
  // A character the style has no form of goes back to plain, not to the last style.
  return Array.from(text, (c) => {
    const base = plainChar(c);
    return map.get(base) ?? base;
  }).join("");
}

/** Whether every character the style can change already wears it. */
export function hasStyle(text: string, id: StyleId): boolean {
  const mark = LINES[id];
  if (mark) {
    // Each character the line can go on, and whether the marks after it hold the line.
    const lined: boolean[] = [];
    for (const c of text) {
      if (LINEABLE.test(c)) lined.push(false);
      else if (c === mark && lined.length) lined[lined.length - 1] = true;
    }
    return lined.length > 0 && lined.every(Boolean);
  }
  const map = LETTERS[id]!;
  let changed = 0;
  for (const c of text) {
    const styled = map.get(plainChar(c));
    if (styled == null) continue;
    if (styled !== c) return false;
    if (styled !== plainChar(c)) changed++;
  }
  return changed > 0;
}

/** On when off, off when on: a style button's press. */
export function toggleStyle(text: string, id: StyleId): string {
  if (!hasStyle(text, id)) return applyStyle(text, id);
  const mark = LINES[id];
  if (mark) return Array.from(text, (c) => (c === mark ? "" : c)).join("");
  return unletter(text);
}

export const isLine = (id: StyleId) => id in LINES;
