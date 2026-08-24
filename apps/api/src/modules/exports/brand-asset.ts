import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The brand mark, for embedding in exports.
 *
 * Exports used to print the organisation's name as text. A management pack that
 * leaves the building should carry the logo instead, and it has to be embedded —
 * neither pdfmake nor ExcelJS will fetch a URL, and a report emailed as an
 * attachment has no origin to fetch from anyway.
 *
 * Read once and cached: a portfolio PDF and a project workbook are generated on
 * the same request path often enough that re-reading the file per export is
 * waste.
 *
 * The copy under `src/assets/brand` is deliberately a downscaled 900px version
 * of the artwork in `apps/web/public/brand`, not the same file. pdfmake embeds
 * an image once per *reference*, not once per document, and the logo sits in
 * the running header — so the full 2943px original went in three times and took
 * a two-page report from 8KB to 629KB. At 900px the mark still resolves at
 * ~490dpi in the header and ~311dpi on the cover, which is past what any
 * printer renders.
 */

const FILE = 'logo.jpeg';

/**
 * Where the file might be, in order.
 *
 * `dist` first because that is production. The compiled tree only contains it
 * because `nest-cli.json` copies `src/assets` on build — without that entry the
 * lookup falls through to the source tree, which exists in dev and in a
 * ts-node run but not in a slim container.
 */
const CANDIDATES = [
  join(__dirname, '..', '..', 'assets', 'brand', FILE),
  join(process.cwd(), 'dist', 'assets', 'brand', FILE),
  join(process.cwd(), 'src', 'assets', 'brand', FILE),
  join(process.cwd(), 'apps', 'api', 'src', 'assets', 'brand', FILE),
];

export interface BrandAsset {
  buffer: Buffer;
  /** A `data:` URI — the form pdfmake wants for an inline image. */
  dataUri: string;
  extension: 'jpeg';
  /** Intrinsic size, so callers can scale by width and keep the proportions. */
  width: number;
  height: number;
  aspect: number;
}

let cached: BrandAsset | null | undefined;

/**
 * Reads the JPEG's intrinsic size from its SOF marker.
 *
 * Cheaper than adding an image library for one file. JPEG is a chain of
 * segments; the frame header (SOF0/1/2/…, but not the DHT/DAC/RST markers that
 * share the C4/CC/D0-D7 range) carries height then width as big-endian 16-bit
 * values. Returns null on anything it does not recognise, and the caller then
 * falls back to a declared ratio rather than throwing during an export.
 */
function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * The logo, or null when it is not on disk.
 *
 * Null is a supported outcome, not an error: a deployment without the asset
 * should still produce a report. Every caller falls back to the organisation
 * name, which is what exports printed before.
 */
export function brandAsset(): BrandAsset | null {
  if (cached !== undefined) return cached;

  const path = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) {
    cached = null;
    return cached;
  }

  const buffer = readFileSync(path);
  const size = readJpegSize(buffer) ?? { width: 900, height: 225 };

  cached = {
    buffer,
    dataUri: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    extension: 'jpeg',
    width: size.width,
    height: size.height,
    aspect: size.width / size.height,
  };
  return cached;
}
