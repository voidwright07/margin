// Generates the extension icons from the Margin mark (an orange tile with a margin rule and three text
// lines), the same geometry as <Logo /> in src/ui/icons.tsx. No dependencies: shapes are rasterised with
// 4x4 supersampling and written as PNG with node:zlib.
//
//   node scripts/icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = resolve(import.meta.dirname, '..', 'public', 'icon');
const SIZES = [16, 32, 48, 96, 128];
const ORANGE = [255, 102, 0];
const WHITE = [255, 255, 255];

// Geometry in the 32-unit design grid.
const tile = { x0: 1, y0: 1, x1: 31, y1: 31, r: 8 };
const strokes = [
  { ax: 11, ay: 7, bx: 11, by: 25, w: 2.6, alpha: 1 },
  { ax: 16, ay: 11, bx: 24, by: 11, w: 2.6, alpha: 0.9 },
  { ax: 16, ay: 16, bx: 24, by: 16, w: 2.6, alpha: 0.9 },
  { ax: 16, ay: 21, bx: 21, by: 21, w: 2.6, alpha: 0.9 },
];

const insideRoundRect = (x, y, { x0, y0, x1, y1, r }) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const insideCapsule = (x, y, { ax, ay, bx, by, w }) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= (w / 2) ** 2;
};

const render = (size) => {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((pxi + (sx + 0.5) / ss) / size) * 32;
          const y = ((py + (sy + 0.5) / ss) / size) * 32;
          if (!insideRoundRect(x, y, tile)) continue;
          const stroke = strokes.find((s) => insideCapsule(x, y, s));
          const k = stroke ? stroke.alpha : 0;
          const c = ORANGE.map((o, i) => o * (1 - k) + WHITE[i] * k);
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const n = ss * ss;
      const o = (py * size + pxi) * 4;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT, `${size}.png`);
  writeFileSync(file, png(size, render(size)));
  console.log(file);
}
