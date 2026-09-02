/* @vitest-environment jsdom */

/* The decoration layer's input handlers are attached while a page box is
   built, not bound to a CSS class. Cook mode mounts the layer switched off and
   turns it on when you pick up the pen, so "is it switched on" has to be
   state the layer can re-read — it was captured once at mount, which left the
   pen in cook mode looking armed and silently ignoring every stroke.

   These tests draw a real stroke, because that is the only thing that tells
   the two situations apart. */

import { describe, it, expect, beforeAll } from 'vitest';
import { mountDecorations, decorationTray } from './customise.js';

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

/** The tray, wired to the same layer, with a note of what it asked to save. */
function trayOn(deco, toolStyles) {
  let saved = null;
  const tray = decorationTray({
    deco,
    toolStyles,
    onStyle: (next) => { saved = next; },
  });
  const pick = (title) => tray.querySelector(`.tray-ink[title="${title}"]`).click();
  const wells = () => [...tray.querySelectorAll('.tray-ink')].map((b) => b.title);
  const tool = (id) => tray.querySelector(`.tray-tool[data-tool="${id}"]`).click();
  return { tray, pick, wells, tool, saved: () => saved, row: () => tray.querySelector('.tray-inks') };
}

describe('the pen pot', () => {
  it('draws the next stroke in the colour just picked, and remembers it', () => {
    const { deco, host, drawn } = layerOn({ active: true });
    const tray = trayOn(deco, { pencil: { ink: '#6B6660', width: 2 } });

    tray.tool('pencil');
    tray.pick('Brick');
    drawOn(host);

    expect(drawn()[0].color).toBe('#8B4A52');
    // Handed back to be stored, so the pen is still this colour tomorrow.
    expect(tray.saved().pencil.ink).toBe('#8B4A52');
    // And the pot shows which one is in hand.
    expect(tray.row().querySelector('[aria-pressed="true"]').title).toBe('Brick');
  });

  it('keeps a colour per tool, so highlighting does not recolour the pencil', () => {
    const { deco, host, drawn } = layerOn({ active: true });
    const tray = trayOn(deco, {
      pencil: { ink: '#6B6660', width: 2 },
      highlighter: { ink: '#E8C84E', width: 15 },
    });

    tray.tool('pencil');
    tray.pick('Sea');
    tray.tool('highlighter');
    tray.pick('Rose');
    drawOn(host);

    expect(drawn()[0].color).toBe('#E4919E');
    expect(tray.saved().pencil.ink).toBe('#47726A');

    tray.tool('pencil');
    drawOn(host);
    expect(drawn()[1].color).toBe('#47726A');
  });

  it('offers pale colours to the highlighter and none at all to the eraser', () => {
    const { deco } = layerOn({ active: true });
    const tray = trayOn(deco, {});

    tray.tool('pencil');
    expect(tray.wells()).toContain('Graphite');
    expect(tray.row().hidden).toBe(false);

    // A highlighter lays down at 0.4 opacity, so it wants its own pot.
    tray.tool('highlighter');
    expect(tray.wells()).toContain('Lemon');
    expect(tray.wells()).not.toContain('Graphite');

    for (const id of ['eraser', 'move']) {
      tray.tool(id);
      expect(tray.row().hidden).toBe(true);
    }
  });
});

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
