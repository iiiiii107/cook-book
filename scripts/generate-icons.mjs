/* Icon generator.

   There is no image library in this project and no rasteriser on the machine,
   so the PNGs are drawn and encoded here directly: a few shape tests per
   pixel, 3x supersampled for smooth edges, then deflated into a PNG by hand.
   Node's zlib does the only hard part.

   Run with `npm run icons` after changing the mark or the palette. */

import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const PAPER = [0xfa, 0xf8, 0xf3];   // --paper, the cream ground
const LEFT = [0x46, 0x60, 0x7a];    // --accent, slate blue
const RIGHT = [0x5f, 0x6b, 0x4a];   // olive, the second spine colour
const SPINE = [0x2b, 0x28, 0x25];   // --ink

const SS = 3;                        // supersampling factor

/** Is this point inside a rounded rectangle? Icon-space (64 units). */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  // How far outside the inner (un-rounded) rectangle the point lies, per axis.
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

/** The mark, sampled at one point. Returns [r,g,b,a], transparent as a=0. */
function sample(x, y, maskable) {
  // A maskable icon gets cropped to a circle by the launcher, so the mark is
  // drawn smaller and the ground runs right to the edge with no corners.
  const scale = maskable ? 0.66 : 1;
  const sx = (x - 32) / scale + 32;
  const sy = (y - 32) / scale + 32;

  if (!maskable && !inRoundRect(x, y, 0, 0, 64, 64, 12)) return [0, 0, 0, 0];

  // Two leaves meeting at the spine, the outer edges lifting slightly the way
  // an open book sits.
  const top = 16 + Math.abs(sx - 32) * 0.10;
  const bottom = 48 - Math.abs(sx - 32) * 0.06;

  if (sx >= 9 && sx <= 55 && sy >= top && sy <= bottom) {
    if (Math.abs(sx - 32) < 1.2) return [...SPINE, 255];
    return sx < 32 ? [...LEFT, 255] : [...RIGHT, 255];
  }
  return [...PAPER, 255];
}

function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const n = SS * SS;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 64;
          const uy = ((y + (sy + 0.5) / SS) / size) * 64;
          const [cr, cg, cb, ca] = sample(ux, uy, maskable);
          if (ca) { r += cr; g += cg; b += cb; a += ca; }
        }
      }

      // `a / 255` is how many of the samples actually carried colour. Dividing
      // the colour sums by that — not by the sample count — is what keeps a
      // half-covered edge pixel the same hue as the solid interior instead of
      // fading it towards black.
      const covered = a / 255;
      const at = (y * size + x) * 4;
      px[at] = covered ? Math.round(r / covered) : 0;
      px[at + 1] = covered ? Math.round(g / covered) : 0;
      px[at + 2] = covered ? Math.round(b / covered) : 0;
      px[at + 3] = Math.round(a / n);
    }
  }
  return px;
}

/* --- PNG encoding ---------------------------------------------------------- */

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
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  // Every scanline is prefixed with its filter byte; 0 means "none", which
  // deflate handles perfectly well for flat colour like this.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(`public/icons/${name}`, encodePng(size, draw(size, maskable)));
  console.log(`public/icons/${name}  ${size}x${size}`);
}
