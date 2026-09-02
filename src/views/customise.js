import { el, svg, capturePointer, toast } from '../lib/dom.js';
import { assets } from '../lib/assets.js';
import { stickerSvg, STICKER_IDS } from '../lib/stickers.js';
import { pathFromPoints, simplify, TOOL_LIMITS } from '../lib/tools.js';
import {
  newElement, elementsOnPage, raise, fitPhoto, DOODLE_SPACE,
} from '../lib/elements.js';
import { cropPhoto } from '../lib/crop.js';

/* Customising a page.

   The decoration layer sits above the text, one overlay per visible page. It
   is present in every mode — you have to be able to *see* your photos while
   reading — but it only accepts input while customising.

   Everything inside is placed as a fraction of the page box, so a sticker
   lands in the same spot on a monitor and on an iPad. */

const TOOLS = [
  { id: 'move', label: 'Move things', icon: 'hand' },
  { id: 'pencil', label: 'Pencil', icon: 'pencil' },
  { id: 'crayon', label: 'Crayon', icon: 'crayon' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
];

/**
 * Mount the decoration layer.
 *
 * @param {object} options
 * @param {HTMLElement} options.host the .flow-viewport to hang the layer in
 * @param {object} options.paged the pagination api, for page geometry
 * @param {() => object[]} options.read current elements
 * @param {(elements: object[]) => void} options.write persist them
 * @param {boolean} options.active whether input is accepted
 * @param {object} options.toolStyles settings.toolStyles
 */
export function mountDecorations({ host, paged, read, write, active, toolStyles, origin = 'edit' }) {
  // Whether the layer takes input can change after mounting — cook mode starts
  // with it off and turns it on when you pick up the pen — so it is state, not
  // a value read once. The tool is written onto the layer here too, so the CSS
  // that decides what is clickable is correct before anyone calls setTool.
  let interactive = Boolean(active);
  const layer = el('div', {
    class: `deco-layer${interactive ? ' is-active' : ''}`,
    dataset: { tool: 'move' },
  });
  host.append(layer);

  let tool = 'move';
  let selected = null;

  function pageBoxes() {
    layer.replaceChildren();
    const style = getComputedStyle(host);
    Object.assign(layer.style, {
      left: style.paddingLeft,
      top: style.paddingTop,
      width: `${host.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)}px`,
      height: `${host.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)}px`,
    });

    for (const rect of paged.pageRects()) {
      const box = el('div', { class: 'deco-page', dataset: { page: String(rect.page) } });
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      layer.append(box);
      paint(box, rect);
      if (interactive) wireDrawing(box, rect);
    }
  }

  /* --- painting one page --------------------------------------------------- */

  function paint(box, rect) {
    box.replaceChildren();
    const items = elementsOnPage(read(), rect.page);

    // Doodles share a single SVG per page. Storing them in a fixed 0–1000
    // space and stretching it with preserveAspectRatio="none" keeps the marks
    // where they were drawn at any page size; non-scaling-stroke then stops
    // that stretch from squashing the line itself.
    const doodles = items.filter((e) => e.kind === 'doodle');
    if (doodles.length) {
      const sheet = svg('svg', {
        class: 'deco-ink',
        viewBox: `0 0 ${DOODLE_SPACE} ${DOODLE_SPACE}`,
        preserveAspectRatio: 'none',
      }, doodles.map((d) =>
        svg('path', {
          d: d.d,
          stroke: d.color,
          'stroke-width': String((d.width || 0.004) * rect.width),
          'stroke-opacity': String(d.opacity ?? 1),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          fill: 'none',
          'vector-effect': 'non-scaling-stroke',
          dataset: { id: d.id },
        }),
      ));
      box.append(sheet);
    }

    for (const item of items) {
      if (item.kind === 'doodle') continue;
      box.append(placed(item, rect));
    }
  }

  function placed(item, rect) {
    const node = el('div', {
      class: `deco-item kind-${item.kind}${selected === item.id ? ' is-selected' : ''}`,
      dataset: { id: item.id },
      style:
        `left:${item.x * 100}%; top:${item.y * 100}%;` +
        `width:${item.w * 100}%; height:${item.h * 100}%;` +
        `transform: rotate(${item.rot || 0}deg); z-index:${Math.round((item.z || 0) % 100000)}`,
    });

    if (item.kind === 'sticker') {
      node.append(stickerSvg(item.sticker));
    } else if (item.kind === 'text') {
      const body = el('div', { class: 'deco-text', text: item.text || '' });
      if (interactive) {
        // Double-click to write, so a single click can still drag the note
        // around without the caret appearing every time you nudge it.
        body.addEventListener('dblclick', () => {
          body.contentEditable = 'plaintext-only';
          body.focus();
          const range = document.createRange();
          range.selectNodeContents(body);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
        body.addEventListener('blur', () => {
          body.contentEditable = 'false';
          const elements = read();
          const live = elements.find((e) => e.id === item.id);
          if (!live || live.text === body.textContent) return;
          live.text = body.textContent;
          write(elements);
        });
        // While the caret is in it, the note is being written on, not moved.
        body.addEventListener('pointerdown', (event) => {
          if (body.isContentEditable) event.stopPropagation();
        });
      }
      node.append(body);
    } else if (item.kind === 'photo') {
      const img = el('img', { alt: item.alt || '', draggable: 'false' });
      assets.url(item.assetId).then((url) => {
        if (url) img.src = url;
        else img.replaceWith(el('div', { class: 'deco-missing', text: 'photo not on this device' }));
      });
      node.append(img);
    }

    if (interactive) {
      node.append(
        el('button', {
          class: 'deco-handle deco-resize', type: 'button',
          'aria-label': 'Resize', dataset: { role: 'resize' },
        }),
        el('button', {
          class: 'deco-handle deco-rotate', type: 'button',
          'aria-label': 'Rotate', dataset: { role: 'rotate' },
        }),
        el('button', {
          class: 'deco-handle deco-remove', type: 'button',
          'aria-label': 'Remove', dataset: { role: 'remove' }, text: '×',
        }),
      );
      wireItem(node, item, rect);
    }
    return node;
  }

  /* --- moving, resizing, rotating ------------------------------------------ */

  function wireItem(node, item, rect) {
    node.addEventListener('pointerdown', (event) => {
      if (tool !== 'move') return;
      const role = event.target.dataset?.role;
      event.stopPropagation();
      // Deliberately no preventDefault(): it suppresses the click and
      // dblclick that follow, and a note is opened for writing on dblclick.
      // Dragging is kept from scrolling or selecting text by touch-action and
      // user-select in the stylesheet instead.

      const elements = read();
      const live = elements.find((e) => e.id === item.id);
      if (!live) return;

      if (role === 'remove') {
        write(elements.filter((e) => e.id !== item.id));
        selected = null;
        return;
      }

      selected = item.id;
      raise(elements, item.id);

      // px/py, not x/y — an element has its own x and y, and spreading `live`
      // over those keys would replace the pointer position with the element's
      // fractional coordinates.
      const start = { px: event.clientX, py: event.clientY, ...live };
      const centre = {
        x: (live.x + live.w / 2) * rect.width,
        y: (live.y + live.h / 2) * rect.height,
      };
      const boxRect = node.parentElement.getBoundingClientRect();
      let moved = false;

      capturePointer(node, event.pointerId);

      const onMove = (move) => {
        if (move.pointerId !== event.pointerId) return;
        const dx = (move.clientX - start.px) / rect.width;
        const dy = (move.clientY - start.py) / rect.height;

        // A couple of pixels of shake while clicking is not a drag. Below this
        // nothing is written, which is what lets a click stay a click and a
        // double-click reach the note underneath.
        if (!moved && Math.abs(move.clientX - start.px) < 3
                   && Math.abs(move.clientY - start.py) < 3) return;
        moved = true;

        if (role === 'resize') {
          // Corner drag keeps the aspect the item was placed at.
          const scale = Math.max(0.06, start.w + dx);
          live.w = scale;
          live.h = scale * (start.h / start.w);
        } else if (role === 'rotate') {
          const angle = Math.atan2(
            move.clientY - boxRect.top - centre.y,
            move.clientX - boxRect.left - centre.x,
          );
          live.rot = Math.round((angle * 180) / Math.PI + 90);
        } else {
          // A sliver may hang over the edge, the way a photo tucked under the
          // margin would, but an element can never be dragged off and lost.
          live.x = Math.min(Math.max(start.x + dx, -live.w * 0.9), 1 - live.w * 0.1);
          live.y = Math.min(Math.max(start.y + dy, -live.h * 0.9), 1 - live.h * 0.1);
        }

        // Live feedback without touching the store — a save mid-drag would
        // re-render and pull the element out from under the pointer.
        node.style.left = `${live.x * 100}%`;
        node.style.top = `${live.y * 100}%`;
        node.style.width = `${live.w * 100}%`;
        node.style.height = `${live.h * 100}%`;
        node.style.transform = `rotate(${live.rot || 0}deg)`;
      };

      const onUp = (up) => {
        if (up.pointerId !== event.pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        // Saving rebuilds the page, so it must only happen when something
        // actually changed. Writing on every pointerup replaced the node under
        // the pointer on a plain click — which is how a note could never be
        // double-clicked open.
        if (moved) write(elements);
      };

      // On window rather than on the element: a quick drag leaves a small
      // sticker between pointerdown and the first pointermove, and if pointer
      // capture has not engaged the drag would stop dead at the first pixel.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  /* --- drawing -------------------------------------------------------------- */

  /* A stylus and a resting palm arrive as different pointer types, so once a
     pen has been seen the hand it is held in can be ignored. */
  let lastPenAt = 0;

  function wireDrawing(box, rect) {
    box.addEventListener('pointerdown', (event) => {
      if (tool === 'move') {
        selected = null;
        return;
      }
      if (event.pointerType === 'pen') lastPenAt = Date.now();
      if (event.pointerType === 'touch' && Date.now() - lastPenAt < 1500) return;

      event.preventDefault();
      capturePointer(box, event.pointerId);

      if (tool === 'eraser') {
        erase(event, box, rect);
        const onErase = (move) => erase(move, box, rect);
        const stop = () => {
          box.removeEventListener('pointermove', onErase);
          box.removeEventListener('pointerup', stop);
        };
        box.addEventListener('pointermove', onErase);
        box.addEventListener('pointerup', stop);
        return;
      }

      const style = toolStyles[tool] || {};
      const limits = TOOL_LIMITS[tool] || { min: 1, max: 16 };
      const width = Math.min(Math.max(style.width ?? 3, limits.min), limits.max);
      const points = [];
      let pressure = 0;

      // The stroke is drawn into its own live path and only committed on
      // pointerup — writing to the store mid-stroke re-renders the page and
      // takes the canvas away mid-line.
      const live = svg('svg', {
        class: 'deco-ink is-live',
        viewBox: `0 0 ${DOODLE_SPACE} ${DOODLE_SPACE}`,
        preserveAspectRatio: 'none',
      });
      const path = svg('path', {
        stroke: style.ink || 'var(--graphite)',
        'stroke-width': String(width),
        'stroke-opacity': String(tool === 'highlighter' ? 0.4 : tool === 'crayon' ? 0.8 : 0.9),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        fill: 'none',
        'vector-effect': 'non-scaling-stroke',
      });
      live.append(path);
      box.append(live);

      const at = (e) => {
        const b = box.getBoundingClientRect();
        return {
          x: ((e.clientX - b.left) / b.width) * DOODLE_SPACE,
          y: ((e.clientY - b.top) / b.height) * DOODLE_SPACE,
        };
      };

      const add = (e) => {
        // Coalesced events carry every sample the digitiser took between
        // frames, which is the difference between a smooth line and a
        // polygon when the pen moves quickly.
        for (const sample of e.getCoalescedEvents?.() || [e]) points.push(at(sample));
        pressure = Math.max(pressure, e.pressure || 0);
        path.setAttribute('d', pathFromPoints(points));
      };

      add(event);

      const onMove = (move) => {
        if (move.pointerType === 'touch' && Date.now() - lastPenAt < 1500) return;
        add(move);
      };

      const onUp = () => {
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        box.removeEventListener('pointercancel', onUp);
        live.remove();

        const kept = simplify(points, 3);
        if (kept.length < 2) return;

        // Pressure scales the whole stroke rather than varying along it: one
        // path per stroke stays small enough to sync, and a pen pressed harder
        // simply leaves a heavier line.
        const weight = pressure ? 0.75 + pressure * 0.5 : 1;
        const elements = read();
        elements.push(
          newElement({
            kind: 'doodle',
            origin,
            page: rect.page,
            d: pathFromPoints(kept),
            color: style.ink || '#6B6660',
            width: (width * weight) / rect.width,
            opacity: tool === 'highlighter' ? 0.4 : tool === 'crayon' ? 0.8 : 0.9,
            x: 0, y: 0, w: 1, h: 1,
          }),
        );
        write(elements);
      };

      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
      box.addEventListener('pointercancel', onUp);
    });
  }

  /** One pass of the eraser takes whatever it touches. */
  function erase(event, box, rect) {
    const b = box.getBoundingClientRect();
    const x = (event.clientX - b.left) / b.width;
    const y = (event.clientY - b.top) / b.height;

    const elements = read();
    const hit = elements.find((e) => {
      if (e.page !== rect.page) return false;
      if (e.kind === 'doodle') {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        return target?.dataset?.id === e.id;
      }
      return x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h;
    });
    if (!hit) return;
    write(elements.filter((e) => e.id !== hit.id));
  }

  /* --- adding things -------------------------------------------------------- */

  function currentPage() {
    return paged.pageRects()[0]?.page ?? 0;
  }

  function add(fields) {
    const elements = read();
    elements.push(newElement({ origin, page: currentPage(), ...fields }));
    write(elements);
  }

  async function addPhoto(file) {
    try {
      const { blob, width, height } = await cropPhoto(file);
      if (!blob) return;
      const id = `a${Math.random().toString(36).slice(2, 12)}`;
      await assets.put(id, blob);
      const rect = paged.pageRects()[0];
      const aspect = rect ? rect.width / rect.height : 0.75;
      add({ kind: 'photo', assetId: id, ...fitPhoto(width, height, aspect) });
    } catch (error) {
      console.warn('Could not add that photo.', error);
      toast('That photo could not be read.');
    }
  }

  return {
    layer,
    refresh: pageBoxes,
    get tool() {
      return tool;
    },
    setTool(next) {
      tool = next;
      layer.dataset.tool = next;
      pageBoxes();
    },
    /* Turning input on has to rebuild the pages: the drag, draw and note
       handlers are attached while a page box is built, so flipping a class
       alone leaves a layer that looks ready and ignores every stroke. */
    setActive(next) {
      interactive = Boolean(next);
      layer.classList.toggle('is-active', interactive);
      pageBoxes();
    },
    add,
    addPhoto,
    stickerIds: STICKER_IDS,
  };
}

export { TOOLS };

/** The tray of tools and stickers shown while customising. */
export function decorationTray({ deco, onTool }) {
  const tray = el('div', { class: 'deco-tray' });

  const toolRow = el('div', { class: 'tray-row' });
  const buttons = TOOLS.map((t) =>
    el('button', {
      class: 'tray-tool',
      type: 'button',
      title: t.label,
      'aria-label': t.label,
      'aria-pressed': String(t.id === deco.tool),
      onClick: () => {
        deco.setTool(t.id);
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t.id)));
        onTool?.(t.id);
      },
      dataset: { tool: t.id },
    }, [toolIcon(t.icon)]),
  );
  toolRow.append(...buttons);

  const stickerRow = el('div', { class: 'tray-row tray-stickers' },
    deco.stickerIds.map((id) =>
      el('button', {
        class: 'tray-sticker',
        type: 'button',
        title: id,
        'aria-label': `Add ${id}`,
        onClick: () => deco.add({ kind: 'sticker', sticker: id, w: 0.16, h: 0.13 }),
      }, [stickerSvg(id)]),
    ),
  );

  const photoInput = el('input', {
    type: 'file',
    accept: 'image/*',
    class: 'sr-only',
    onChange: (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) deco.addPhoto(file);
    },
  });

  const extras = el('div', { class: 'tray-row' }, [
    el('button', {
      class: 'tray-add', type: 'button', text: 'Photo',
      onClick: () => photoInput.click(),
    }),
    el('button', {
      class: 'tray-add', type: 'button', text: 'Note',
      onClick: () => deco.add({ kind: 'text', text: 'A note', w: 0.26, h: 0.09 }),
    }),
    photoInput,
  ]);

  tray.append(toolRow, stickerRow, extras);
  return tray;
}

/* Tool icons, drawn to sit with the rest of the line art. */
function toolIcon(name) {
  const paths = {
    hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5.2a1.5 1.5 0 0 1 3 0V11m0-.8a1.5 1.5 0 0 1 3 0V11m0-.2a1.5 1.5 0 0 1 3 0v5.3a4.5 4.5 0 0 1-4.5 4.5h-2A5.5 5.5 0 0 1 5 15V13a1.5 1.5 0 0 1 3 0',
    pencil: 'M4 20h4L18.5 9.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20ZM13.5 7 17 10.5',
    crayon: 'M6 20h5l8-8a3 3 0 0 0-4-4l-8 8ZM6 20l-2 1 1-2ZM13 7l4 4',
    highlighter: 'M5 21h6M7 17l3-9 6 3-4 8ZM10 8l2-4 6 3-2 4',
    eraser: 'M8 20h11M5.5 16.5l6-9a2 2 0 0 1 2.8-.6l4 2.7a2 2 0 0 1 .5 2.8l-4.6 6.6H8.7a2 2 0 0 1-1.7-.9l-1.4-2a1.5 1.5 0 0 1-.1-1.6ZM10 9l7 4.7',
  };
  return svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
    svg('path', { d: paths[name] || '' }),
  ]);
}
