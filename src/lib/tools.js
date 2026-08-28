/* The pen pot.

   Adapted from 10minutestospare. The geometry helpers below (pathFromPoints,
   simplify) are unchanged and carry that app's hard-won smoothing; the tool
   set is the cookbook's own.

   Two tools mean something:

     pen     draws across an ingredient or a step in cook mode and crosses it
             off — the one tool that changes state
     eraser  takes marks back off

   The pencil, crayon and highlighter only leave colour. That is the point of
   them: decorating your own page, not another way to tick things.

   Holding the space bar lifts whichever tool is being dragged, so you can
   cross the page to reach somewhere else without a line trailing behind.
   (See calendartospare/src/views/marker.js for where that behaviour was
   worked out.) */

export const TOOLS = {
  pen: {
    id: 'pen',
    label: 'Pen',
    hint: 'Draw across an ingredient or a step to cross it off. Hold space to lift the nib.',
    ink: null, // null means "use the ink colour of whatever is underneath"
    width: 2.2,
    opacity: 1,
    completes: true,
  },
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    hint: 'Sketch on the page. Hold space to lift.',
    ink: '#6B6660',
    width: 1.8,
    opacity: 0.85,
    completes: false,
    adjustable: true,
  },
  crayon: {
    id: 'crayon',
    label: 'Crayon',
    hint: 'Scribble on the page. Hold space to lift.',
    ink: '#46607A',
    width: 5.5,
    opacity: 0.8,
    completes: false,
    adjustable: true,
  },
  highlighter: {
    id: 'highlighter',
    label: 'Highlighter',
    hint: 'Colour over anything. Nothing is ticked. Hold space to lift.',
    ink: '#E8C84E',
    width: 15,
    opacity: 0.4,
    completes: false,
    adjustable: true,
  },
  eraser: {
    id: 'eraser',
    label: 'Eraser',
    hint: 'Rub marks off the page. Hold space to lift.',
    ink: null,
    width: 0,
    opacity: 1,
    completes: false,
    erases: true,
  },
};

export const TOOL_ORDER = ['pen', 'pencil', 'crayon', 'highlighter', 'eraser'];

/** How far the adjustable tools can be taken, per tool. */
export const TOOL_LIMITS = {
  pencil: { min: 1, max: 8 },
  crayon: { min: 2, max: 16 },
  highlighter: { min: 6, max: 30 },
};

/**
 * A tool as it is actually set right now — the adjustable ones can be given a
 * colour and a width of your own.
 * @param {string} id
 * @param {{ink?: string, width?: number}} [overrides]
 */
export function toolWith(id, overrides) {
  const base = TOOLS[id];
  if (!base?.adjustable || !overrides) return base;
  return {
    ...base,
    ink: overrides.ink || base.ink,
    width: Number(overrides.width) || base.width,
  };
}

/**
 * Turn a run of pointer positions into a smooth path.
 * Midpoints between samples become the curve's on-path points, which keeps a
 * fast scribble from looking like a chain of straight segments.
 */
export function pathFromPoints(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

/**
 * Thin the samples so a slow drag doesn't store hundreds of near-identical
 * points. Anything closer than `minGap` to the previous keeper is dropped.
 * This is also what keeps a page of doodles inside a Firestore document.
 */
export function simplify(points, minGap = 3) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (const point of points.slice(1)) {
    const last = out[out.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minGap) out.push(point);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
