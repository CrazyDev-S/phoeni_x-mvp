// Rasterizes the lucide glyphs the resume templates use into alpha masks.
//
// The web preview draws these same shapes with lucide-react; the .docx and PDF
// can only carry pictures, so the backend recolours these masks per template
// (backend/app/remote/export/icons.py). One source of shapes keeps the three
// outputs identical. Re-run only when the icon set changes: `npm run icons`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lucide = path.join(root, "node_modules/lucide-react/dist/esm/icons");
const out = path.join(root, "backend/app/remote/export/assets/icons");

// name -> lucide file
const ICONS = {
  mail: "mail",
  phone: "phone",
  pin: "map-pin",
  link: "link",
  summary: "id-card",
  experience: "briefcase-business",
  education: "graduation-cap",
  skills: "brain",
  languages: "globe",
  certifications: "file-badge",
  projects: "folder",
};

const SIZE = 192;

function toSvg(node) {
  const attrs = (a) =>
    Object.entries(a)
      .filter(([k]) => k !== "key")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
  const body = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

await mkdir(out, { recursive: true });
for (const [name, file] of Object.entries(ICONS)) {
  const mod = await import(path.join(lucide, `${file}.mjs`));
  const png = await sharp(Buffer.from(toSvg(mod.__iconData.node)), { density: 288 })
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();
  await writeFile(path.join(out, `${name}.png`), png);
}
console.log(`wrote ${Object.keys(ICONS).length} icons to ${path.relative(root, out)}`);
