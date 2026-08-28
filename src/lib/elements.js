/* What gets stuck onto a page.

   Photographs, stickers, doodles and scraps of text all share one shape, so
   the overlay only has to know how to place a rectangle and how to draw four
   kinds of thing inside it.

   Positions are fractions of the page box — never pixels. A sticker at
   x: 0.25 sits a quarter of the way across whether that page is 300 px wide on
   a phone or 700 px on a monitor, which is the only way the same page can look
   like itself on both. */

import { uid } from './dom.js';

/** Doodle paths are stored in this space, then scaled to whatever the page is. */
export const DOODLE_SPACE = 1000;

export const KINDS = ['photo', 'sticker', 'doodle', 'text'];

/**
 * @param {object} fields
 * @param {'photo'|'sticker'|'doodle'|'text'} fields.kind
 * @param {number} fields.page which page of the flow it belongs to
 * @param {'edit'|'cook'} [fields.origin] where it was added from
 */
export function newElement(fields) {
  return {
    id: uid(),
    x: 0.2,
    y: 0.2,
    w: 0.3,
    h: 0.24,
    rot: 0,
    z: Date.now(),
    origin: 'edit',
    ...fields,
  };
}

/** Elements on one page, in paint order. */
export function elementsOnPage(elements = [], page) {
  return elements.filter((e) => e.page === page).sort((a, b) => (a.z || 0) - (b.z || 0));
}

/** Put an element on top of everything else on its page. */
export function raise(elements, id) {
  const top = elements.reduce((n, e) => Math.max(n, e.z || 0), 0);
  const element = elements.find((e) => e.id === id);
  if (element) element.z = top + 1;
  return elements;
}

/** Aspect-preserving default size for a photo, as a fraction of the page. */
export function fitPhoto(naturalWidth, naturalHeight, pageAspect) {
  const w = 0.42;
  // pageAspect is width/height, so a square photo needs more of the page's
  // height than of its width to stay square.
  const h = (w * (naturalHeight / naturalWidth)) * pageAspect;
  return { w, h: Math.min(h, 0.6) };
}
