// Regenerates the in-app avatar and every app icon from the two source images
// in branding/. The outputs are committed, so this only needs running after a
// source image changes.
//
//   branding/avatar.(png|jpg|webp)  -> the mark beside the wordmark
//   branding/icon.(png|jpg|webp)    -> favicon, Apple touch icon, extension icons
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...parts) => path.join(ROOT, ...parts);

/** Near-white counts as background; the logos are drawn on white. */
const LIGHT = 230;
/** Transparent breathing room around the artwork, as a share of its longer side. */
const MARGIN = 0.06;

async function source(name) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const file = at("branding", name + ext);
    try {
      await access(file);
      return file;
    } catch {}
  }
  throw new Error(`Missing branding/${name}.png (or .jpg/.webp).`);
}

/**
 * The artwork with its background made transparent, cropped to a padded square.
 *
 * Only background reachable from the border is removed - a flood fill rather
 * than a colour key - so pale highlights inside the artwork stay opaque. The
 * two-pixel fringe next to it is un-blended from white, so the anti-aliased
 * edge does not leave a white halo on a dark theme.
 */
async function artwork(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isBackground = (p) => {
    const i = p * 4;
    return data[i + 3] < 16 || Math.min(data[i], data[i + 1], data[i + 2]) >= LIGHT;
  };

  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = (p) => {
    if (!bg[p] && isBackground(p)) {
      bg[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }

  // Grow the background by two pixels to find the fringe.
  let near = bg;
  for (let pass = 0; pass < 2; pass++) {
    const grown = near.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (near[y * w + x]) continue;
        for (let dy = -1; dy <= 1 && !grown[y * w + x]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && near[ny * w + nx]) {
              grown[y * w + x] = 1;
              break;
            }
          }
        }
      }
    }
    near = grown;
  }

  let [left, top, right, bottom] = [w, h, -1, -1];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (bg[p]) {
      data[i + 3] = 0;
    } else if (near[p]) {
      // Colour-to-alpha against white: the least opacity that explains the pixel.
      const alpha = (255 - Math.min(data[i], data[i + 1], data[i + 2])) / 255;
      if (alpha > 0) {
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(255 - (255 - data[i + c]) / alpha);
      }
      data[i + 3] = Math.round(data[i + 3] * alpha);
    }
    if (data[i + 3] > 8) {
      const x = p % w;
      const y = (p - x) / w;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error(`${path.relative(ROOT, file)} has no artwork left once its background is removed.`);

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const side = Math.round(Math.max(cropW, cropH) * (1 + 2 * MARGIN));
  const padX = side - cropW;
  const padY = side - cropH;
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: cropW, height: cropH })
    .extend({
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function write(image, size, out, { opaque = false } = {}) {
  const file = at(out);
  await mkdir(path.dirname(file), { recursive: true });
  let pipeline = sharp(image).resize(size, size);
  if (opaque) pipeline = pipeline.flatten({ background: "#ffffff" });
  await pipeline.png().toFile(file);
  console.log(`  ${out}  ${size}px`);
}

const avatar = await artwork(await source("avatar"));
await write(avatar, 256, "apps/web/public/phoenix-avatar.png");
await write(avatar, 256, "apps/extension/public/phoenix-avatar.png");

const icon = await artwork(await source("icon"));
// Next.js serves app/icon.png as the favicon and app/apple-icon.png as the
// touch icon. iOS paints transparency black, so the touch icon is flattened.
await write(icon, 512, "apps/web/src/app/icon.png");
await write(icon, 180, "apps/web/src/app/apple-icon.png", { opaque: true });
for (const size of [16, 32, 48, 96, 128]) {
  await write(icon, size, `apps/extension/public/icon/${size}.png`);
}
