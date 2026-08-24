/*
 * The extension's icon, drawn rather than pasted — so it can be re-tuned by
 * changing a number instead of by finding whoever has the source file.
 *
 * Several candidate marks live here at once. 16px is the size that decides
 * whether an icon works, so every candidate is rendered there too and the
 * grid is dropped below 32px, where it turns to mud.
 *
 *   node tools/make-icons.mjs [mark] [--out DIR]
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const SIZES = [16, 32, 48, 128];
const SS = 4;                       // supersampling factor, for the antialiasing

// Straight from the blueprint theme: base surface, drawn lines, and the ink
// the mark is written in — light enough to survive a dark browser toolbar.
const BG   = [0x11, 0x2c, 0x49];
const GRID = [0x2a, 0x4f, 0x74];
const INK  = [0xa9, 0xe9, 0xf7];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed distance to a rounded box. Negative inside. */
function sdBox(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance from a point to a line segment. */
function sdSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const sdPath = (x, y, pts) => {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++)
    d = Math.min(d, sdSeg(x, y, ...pts[i], ...pts[i + 1]));
  return d;
};

/** Distance to a filled triangle, approximated by its three edges + inside test. */
function sdTri(x, y, a, b, c) {
  const side = (p, q) => (x - p[0]) * (q[1] - p[1]) - (y - p[1]) * (q[0] - p[0]);
  const s1 = side(a, b), s2 = side(b, c), s3 = side(c, a);
  const inside = (s1 <= 0 && s2 <= 0 && s3 <= 0) || (s1 >= 0 && s2 >= 0 && s3 >= 0);
  const d = Math.min(sdSeg(x, y, ...a, ...b), sdSeg(x, y, ...b, ...c), sdSeg(x, y, ...c, ...a));
  return inside ? -d : d;
}

/*
 * Each mark returns signed distance: negative is ink. Kept as distance rather
 * than coverage so one antialiasing rule serves all of them and none of them
 * has to know what size it is being drawn at.
 */
const MARKS = {
  // Verification, plainly. A tick, off-centre — dead centre reads as a bullet.
  tick: (x, y, size) =>
    sdPath(x, y, [[0.255, 0.520], [0.435, 0.700], [0.760, 0.300]]) - (size <= 16 ? 0.078 : 0.066),

  /*
   * The verb: stepping down through the rules, one tread at a time.
   * Every tread is 0.20 wide and every riser 0.20 tall — a staircase with one
   * short step reads as a mistake rather than as a rhythm. The whole flight is
   * 0.60 x 0.40 and centred, so the round caps sit evenly inside the tile.
   */
  steps: (x, y, size) =>
    sdPath(x, y, [[0.20, 0.30], [0.40, 0.30], [0.40, 0.50], [0.60, 0.50], [0.60, 0.70], [0.80, 0.70]])
      - (size <= 16 ? 0.070 : 0.058),

  // The same flight redrawn for small sizes: two treads instead of three, each
  // half again as wide. Scaling a three-step flight to 16px turns it into a
  // diagonal smudge - at that size the mark has to be redrawn, not resized.
  steps2: (x, y, size) =>
    sdPath(x, y, [[0.18, 0.32], [0.48, 0.32], [0.48, 0.62], [0.78, 0.62]]) - 0.082,

  // A plumb line: the drafting instrument for "is this true against a reference".
  plumb: (x, y, size) => Math.min(
    sdPath(x, y, [[0.28, 0.20], [0.72, 0.20]]) - (size <= 16 ? 0.045 : 0.036),
    sdPath(x, y, [[0.50, 0.20], [0.50, 0.54]]) - (size <= 16 ? 0.040 : 0.032),
    sdTri(x, y, [0.50, 0.86], [0.34, 0.50], [0.66, 0.50]),
  ),

  // The wordmark's own letter, its last stroke rising into a tick.
  wtick: (x, y, size) =>
    sdPath(x, y, [[0.16, 0.30], [0.31, 0.72], [0.46, 0.44], [0.61, 0.72], [0.84, 0.22]])
      - (size <= 16 ? 0.068 : 0.056),

  // Design and build, one laid over the other — the comparison itself.
  frames: (x, y, size) => {
    const back = Math.abs(sdBox(x, y, 0.40, 0.40, 0.22, 0.20, 0.05)) - (size <= 16 ? 0.042 : 0.032);
    const front = sdBox(x, y, 0.61, 0.61, 0.22, 0.20, 0.05);
    return Math.min(back, front);
  },
};

/*
 * The off state. Chrome gives an extension button no "inactive" styling of its
 * own, so walkdown draws its own: the same mark drained of colour and sunk into
 * the toolbar, which reads as dormant rather than as a different tool.
 */
function dim(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const grey = Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
    rgba[i] = rgba[i + 1] = rgba[i + 2] = grey;
    rgba[i + 3] = Math.round(rgba[i + 3] * 0.55);
  }
  return rgba;
}

function render(markName, size) {
  const mark = MARKS[markName];
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 0.9 / size;          // one device pixel, in unit space
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / size, uy = (y + (sy + 0.5) / SS) / size;
          const tile = sdBox(ux, uy, 0.5, 0.5, 0.5, 0.5, 0.215);
          if (tile > 0) continue;                       // outside the rounded tile
          let px = BG;
          if (size >= 32) {
            let grid = 0;
            const w = 0.011, step = 0.1667;
            for (let i = 1; i <= 5; i++) {
              grid = Math.max(grid, 1 - clamp01((Math.abs(ux - i * step) - w) / (w * 0.9)));
              grid = Math.max(grid, 1 - clamp01((Math.abs(uy - i * step) - w) / (w * 0.9)));
            }
            if (tile > -0.05) grid *= clamp01(-tile / 0.05);   // keep it off the radius
            px = mix(px, GRID, grid * 0.85);
          }
          px = mix(px, INK, clamp01(-mark(ux, uy, size) / aa));
          const cover = clamp01(-tile / aa);
          r += px[0] * cover; g += px[1] * cover; b += px[2] * cover; a += 255 * cover;
        }
      }
      const n = SS * SS, av = a / n, k = a > 0 ? 255 / a : 0;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r * k);              // un-premultiplied, so edges keep colour
      rgba[i + 1] = Math.round(g * k);
      rgba[i + 2] = Math.round(b * k);
      rgba[i + 3] = Math.round(av);
    }
  }
  return rgba;
}

// --- PNG ---------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                    // 8-bit truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;               // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const CANDIDATES = Object.keys(MARKS);
export const build = (mark, size, off = false) => {
  const rgba = render(mark, size);
  return png(size, off ? dim(rgba) : rgba);
};

// Only act as a CLI when run directly — importing it must not write files.
const args = process.argv.slice(2);
if ((process.argv[1] ?? '').endsWith('make-icons.mjs')) {
  const mark = args.find((a) => !a.startsWith('--')) ?? 'tick';
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : join(HERE, '..', 'extension', 'icons');
  if (!MARKS[mark]) {
    console.error(`unknown mark "${mark}" — try: ${CANDIDATES.join(', ')}`);
    process.exit(1);
  }
  // --size may be repeated. Chrome will downscale a single large icon itself,
  // so shipping only the 128 is a real option — and worth looking at before
  // committing to hand-drawn small sizes.
  const only = args.reduce((acc, a, i) => (a === '--size' ? [...acc, Number(args[i + 1])] : acc), []);
  const sizes = only.length ? only : SIZES;
  mkdirSync(out, { recursive: true });
  for (const size of sizes) {
    writeFileSync(join(out, `icon-${size}.png`), build(mark, size));
    writeFileSync(join(out, `icon-${size}-off.png`), build(mark, size, true));
    console.log(`${mark}  icon-${size}.png  icon-${size}-off.png`);
  }
}
