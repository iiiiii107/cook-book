/* @vitest-environment jsdom */

/* The decoration layer's input handlers are attached while a page box is
   built, not bound to a CSS class. Cook mode mounts the layer switched off and
   turns it on when you pick up the pen, so "is it switched on" has to be
   state the layer can re-read — it was captured once at mount, which left the
   pen in cook mode looking armed and silently ignoring every stroke.

   These tests draw a real stroke, because that is the only thing that tells
   the two situations apart. */

import { describe, it, expect, beforeAll } from 'vitest';
import { mountDecorations } from './customise.js';

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 600, width: 400, height: 600 };
  };
});

/** A layer over one page, wired to an array we can inspect. */
function layerOn({ active, origin }) {
  const host = document.createElement('div');
  document.body.append(host);
  let stored = [];
  const deco = mountDecorations({
    host,
    paged: { pageRects: () => [{ page: 0, left: 0, top: 0, width: 400, height: 600 }] },
    read: () => structuredClone(stored),
    write: (elements) => { stored = elements; },
    active,
    origin,
    toolStyles: { pencil: { ink: '#333', width: 3 } },
  });
  deco.refresh();
  return { deco, host, drawn: () => stored };
}

/** Drag across the page the way a pointer does: down, some moves, up. */
function drawOn(host) {
  const box = host.querySelector('.deco-page');
  const send = (type, x, y) => box.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), {
      pointerId: 1, pointerType: 'mouse', pressure: 0.5, clientX: x, clientY: y,
    }),
  );
  send('pointerdown', 20, 20);
  for (let i = 1; i <= 8; i += 1) send('pointermove', 20 + i * 20, 20 + i * 15);
  send('pointerup', 180, 140);
}

describe('the decoration layer', () => {
  it('draws once the pen is picked up, on a layer that mounted switched off', () => {
    const { deco, host, drawn } = layerOn({ active: false, origin: 'cook' });

    // Switched off, the page ignores the pointer entirely.
    drawOn(host);
    expect(drawn()).toHaveLength(0);

    deco.setTool('pencil');
    deco.setActive(true);
    drawOn(host);

    expect(drawn()).toHaveLength(1);
    expect(drawn()[0].kind).toBe('doodle');
  });

  it('records where a mark was made, so cooking splatters are tellable apart', () => {
    const cooking = layerOn({ active: true, origin: 'cook' });
    cooking.deco.setTool('pencil');
    drawOn(cooking.host);
    expect(cooking.drawn()[0].origin).toBe('cook');

    // 'edit' is newElement's own default, which is why stamping the origin
    // after the fact never worked — there was never a blank left to fill.
    const customising = layerOn({ active: true });
    customising.deco.setTool('pencil');
    drawOn(customising.host);
    expect(customising.drawn()[0].origin).toBe('edit');
  });

  it('stops taking marks when the pen is put down again', () => {
    const { deco, host, drawn } = layerOn({ active: true, origin: 'cook' });
    deco.setTool('pencil');
    drawOn(host);
    expect(drawn()).toHaveLength(1);

    deco.setTool('move');
    deco.setActive(false);
    drawOn(host);
    expect(drawn()).toHaveLength(1);
  });
});
