/**
 * Generates the PWA icons from the brand mark.
 *
 * Run with `npm run icons -w @ciq/web`. Checked in rather than run at build
 * time: the output changes only when the mark does, and a build step that
 * rasterises images on every deploy is a slow thing to pay for daily to catch
 * something that happens once a year.
 *
 * Written by hand rather than with sharp or jimp because the mark is four
 * rectangles and a triangle. Pulling in a native image dependency — and its
 * platform-specific binaries, which have to resolve inside an Alpine container
 * as well as on Windows — is a large price for a shape that fits in a scanline
 * loop. `zlib` is built in, and PNG's structure is three chunks.
 */
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = [0x11, 0x18, 0x27]; // #111827 — the dark field
const PAPER = [0xff, 0xff, 0xff]; // #ffffff — the mark
const ACCENT = [0x29, 0xab, 0xe2]; // #29ABE2 — the chevron

/**
 * The mark, in the 192-unit space favicon.svg uses, so the two cannot drift.
 * Rectangles are [x, y, w, h]; the chevron is a triangle.
 */
const RECTS = [
  { box: [44, 44, 104, 104], colour: PAPER },
  { box: [58, 44, 23, 104], colour: INK },
  { box: [111, 44, 23, 104], colour: INK },
  { box: [58, 85, 76, 23], colour: INK },
];
const TRIANGLE = { points: [[50, 128], [152, 71], [110, 122]], colour: ACCENT };

/** Whether a point lies inside the triangle, by the sign of three cross products. */
function inTriangle(px, py, [[ax, ay], [bx, by], [cx, cy]]) {
  const side = (x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Renders at `scale`× and averages each block down.
 *
 * Without it the chevron's diagonal and the mark's edges alias into a stepped
 * line that is plainly visible at 192px on a phone. Supersampling is the whole
 * reason this looks like a rendered icon rather than a screenshot of one.
 */
const SUPERSAMPLE = 4;

/**
 * @param size   output edge length in pixels
 * @param inset  fraction of the canvas the mark occupies. Android masks a
 *               home-screen icon to the launcher's own shape and guarantees
 *               only the middle 80%, so the maskable icon shrinks the mark and
 *               lets the field run to the edge.
 */
function render(size, inset) {
  const hi = size * SUPERSAMPLE;
  const samples = new Uint8Array(hi * hi * 3);

  for (let y = 0; y < hi; y += 1) {
    for (let x = 0; x < hi; x += 1) {
      // Back to the 192-unit design space, through the inset.
      const u = ((x + 0.5) / hi - 0.5) / inset + 0.5;
      const v = ((y + 0.5) / hi - 0.5) / inset + 0.5;
      const dx = u * 192;
      const dy = v * 192;

      let colour = INK;
      for (const { box, colour: fill } of RECTS) {
        const [bx, by, bw, bh] = box;
        if (dx >= bx && dx < bx + bw && dy >= by && dy < by + bh) colour = fill;
      }
      if (inTriangle(dx, dy, TRIANGLE.points)) colour = TRIANGLE.colour;

      const at = (y * hi + x) * 3;
      samples[at] = colour[0];
      samples[at + 1] = colour[1];
      samples[at + 2] = colour[2];
    }
  }

  // Average each SUPERSAMPLE×SUPERSAMPLE block, and prepend PNG's per-row
  // filter byte (0 = none) while we are walking the rows anyway.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let out = 0;
  for (let y = 0; y < size; y += 1) {
    raw[out] = 0;
    out += 1;
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const at = ((y * SUPERSAMPLE + sy) * hi + (x * SUPERSAMPLE + sx)) * 3;
          totals[0] += samples[at];
          totals[1] += samples[at + 1];
          totals[2] += samples[at + 2];
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      raw[out] = Math.round(totals[0] / n);
      raw[out + 1] = Math.round(totals[1] / n);
      raw[out + 2] = Math.round(totals[2] / n);
      out += 3;
    }
  }

  return encodePng(size, raw);
}

/** PNG: signature, IHDR, IDAT, IEND. Each chunk is length, type, data, CRC. */
function encodePng(size, raw) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  // 10-12 are compression, filter and interlace methods: 0, 0, 0 by default.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(PUBLIC_DIR, { recursive: true });

const ICONS = [
  // `any`: shown as drawn, so the mark fills the tile.
  { file: 'icon-192.png', size: 192, inset: 1 },
  { file: 'icon-512.png', size: 512, inset: 1 },
  // `maskable`: the launcher crops it, so the mark sits in the safe circle.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.78 },
  // iOS ignores the manifest and reads this link instead. It also applies its
  // own rounded-rectangle mask, so this one is drawn full-bleed too.
  { file: 'apple-touch-icon.png', size: 180, inset: 1 },
];

for (const { file, size, inset } of ICONS) {
  const png = render(size, inset);
  writeFileSync(join(PUBLIC_DIR, file), png);
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 8);
  console.log(`${file.padEnd(26)} ${size}x${size}  ${String(png.length).padStart(6)} bytes  ${digest}`);
}
