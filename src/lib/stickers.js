/* The sticker drawer.

   Drawn here as inline SVG rather than shipped as images: they inherit the
   page's colours, stay sharp at any size, and cost nothing to load. Each one
   is a small still life from the same kitchen — the point is that they look
   like things someone stuck on a page, not like an icon set. */

import { svg } from './dom.js';

const S = (children, props = {}) =>
  ({ viewBox: '0 0 100 100', children, ...props });

export const STICKERS = {
  lemon: S([
    ['path', { d: 'M22 58c0-16 14-30 31-30 12 0 24 7 26 17 2 9-6 16-8 24-3 10-13 17-25 17-14 0-24-12-24-28Z', fill: '#E3C25C', stroke: '#B99A3C' }],
    ['path', { d: 'M79 45c4-2 8-1 10 1-3 3-7 4-10 3Z', fill: '#E3C25C', stroke: '#B99A3C' }],
    ['path', { d: 'M35 48c4-4 10-6 15-5', stroke: '#F0DA9A', fill: 'none' }],
  ]),
  olive: S([
    ['path', { d: 'M14 78C30 62 52 44 84 26', stroke: '#5F6B4A', fill: 'none', 'stroke-width': '3' }],
    ['ellipse', { cx: '38', cy: '52', rx: '11', ry: '7', fill: '#6E7A52', stroke: '#4B5539', transform: 'rotate(-38 38 52)' }],
    ['ellipse', { cx: '58', cy: '38', rx: '11', ry: '7', fill: '#7E8A60', stroke: '#4B5539', transform: 'rotate(-38 58 38)' }],
    ['circle', { cx: '25', cy: '66', r: '6', fill: '#3F4A32', stroke: '#2C3423' }],
    ['circle', { cx: '72', cy: '30', r: '6', fill: '#3F4A32', stroke: '#2C3423' }],
  ]),
  tomato: S([
    ['circle', { cx: '50', cy: '58', r: '28', fill: '#B4503F', stroke: '#8A3A2C' }],
    ['path', { d: 'M50 30c-6-6-14-8-20-6 3 6 9 10 14 11M50 30c6-6 14-8 20-6-3 6-9 10-14 11', fill: '#5F6B4A', stroke: '#48533A' }],
    ['path', { d: 'M38 48c3-4 7-6 11-6', stroke: '#D4826F', fill: 'none' }],
  ]),
  espresso: S([
    ['path', { d: 'M24 40h44v18c0 11-9 20-22 20s-22-9-22-20Z', fill: '#FBF8F3', stroke: '#5A5348' }],
    ['path', { d: 'M68 46h8a7 7 0 0 1 0 14h-8', fill: 'none', stroke: '#5A5348' }],
    ['path', { d: 'M28 44h36v9c0 3-8 5-18 5s-18-2-18-5Z', fill: '#5A3E2B', stroke: 'none' }],
    ['path', { d: 'M20 84h56', stroke: '#5A5348', fill: 'none' }],
    ['path', { d: 'M40 30c0-5 4-6 4-11M52 30c0-5 4-6 4-11', stroke: '#A8A196', fill: 'none' }],
  ]),
  wine: S([
    ['path', { d: 'M34 20h32c0 18-6 28-16 30-10-2-16-12-16-30Z', fill: '#7A3E4A', stroke: '#572C35' }],
    ['path', { d: 'M50 50v24M38 78h24', stroke: '#5A5348', fill: 'none' }],
  ]),
  garlic: S([
    ['path', { d: 'M50 24c8 8 20 20 20 34 0 13-9 22-20 22s-20-9-20-22c0-14 12-26 20-34Z', fill: '#F2EDE2', stroke: '#9A9184' }],
    ['path', { d: 'M50 30v48M38 44c-2 12-1 24 4 32M62 44c2 12 1 24-4 32', stroke: '#C4BAA9', fill: 'none' }],
    ['path', { d: 'M50 24c1-6 3-9 6-11', stroke: '#9A9184', fill: 'none' }],
  ]),
  fish: S([
    ['path', { d: 'M18 52c12-14 34-20 48-14 8 4 14 9 18 14-4 5-10 10-18 14-14 6-36 0-48-14Z', fill: '#8FA3B4', stroke: '#5F7385' }],
    ['path', { d: 'M84 52c4-6 9-10 12-11-1 8-1 14 0 22-3-1-8-5-12-11Z', fill: '#8FA3B4', stroke: '#5F7385' }],
    ['circle', { cx: '34', cy: '48', r: '3', fill: '#2B2825', stroke: 'none' }],
    ['path', { d: 'M46 40c6 8 6 16 0 24', stroke: '#5F7385', fill: 'none' }],
  ]),
  leaf: S([
    ['path', { d: 'M78 22C52 22 28 40 28 62c0 8 3 14 7 18 22-2 44-24 43-58Z', fill: '#6E7A52', stroke: '#4B5539' }],
    ['path', { d: 'M35 80C46 62 60 44 78 22', stroke: '#4B5539', fill: 'none' }],
  ]),
  star: S([
    ['path', { d: 'M50 20l8 20 22 2-16 15 5 21-19-11-19 11 5-21-16-15 22-2Z', fill: '#C4A45C', stroke: '#9A7F3F' }],
  ]),
  heart: S([
    ['path', { d: 'M50 80C26 64 18 52 18 42a16 16 0 0 1 32-5 16 16 0 0 1 32 5c0 10-8 22-32 38Z', fill: '#8A5A66', stroke: '#66404A' }],
  ]),
  tape: S([
    ['path', { d: 'M8 36h84v28H8Z', fill: 'rgba(214,203,178,.72)', stroke: 'rgba(150,140,116,.5)' }],
    ['path', { d: 'M8 36l6 6-6 6 6 6-6 6 6 4M92 36l-6 6 6 6-6 6 6 6-6 4', stroke: 'rgba(150,140,116,.6)', fill: 'none' }],
  ]),
  pin: S([
    ['circle', { cx: '50', cy: '38', r: '18', fill: '#7A3E4A', stroke: '#572C35' }],
    ['circle', { cx: '44', cy: '32', r: '5', fill: 'rgba(255,255,255,.4)', stroke: 'none' }],
    ['path', { d: 'M50 56v28', stroke: '#5A5348', fill: 'none', 'stroke-width': '3' }],
  ]),
};

export const STICKER_IDS = Object.keys(STICKERS);

/** Build one sticker as an SVG node. */
export function stickerSvg(id) {
  const spec = STICKERS[id] || STICKERS.star;
  return svg(
    'svg',
    {
      viewBox: spec.viewBox,
      class: 'sticker-art',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'aria-hidden': 'true',
    },
    spec.children.map(([tag, props]) => svg(tag, props)),
  );
}
