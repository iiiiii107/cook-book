/* Cropping a photograph before it goes on the page.

   Two things happen here, and the second matters more than the first. You
   choose the part of the picture you want; then it is re-encoded to WebP with
   its long edge capped, which turns a 4 MB phone photo into something around
   150 KB. A scrapbook of full-resolution photos would fill IndexedDB and be
   painful to sync, and nothing on a page is ever shown large enough to tell
   the difference. */

import { el, modal, capturePointer } from './dom.js';

const MAX_EDGE = 1600;
const QUALITY = 0.85;

/**
 * Show the crop dialog and resolve with the finished image.
 * @param {File} file
 * @returns {Promise<{blob: Blob|null, width: number, height: number}>}
 *          blob is null if the dialog was dismissed.
 */
export async function cropPhoto(file) {
  const bitmap = await loadBitmap(file);

  return new Promise((resolve) => {
    // The crop rectangle is held in fractions of the image, so the maths does
    // not care what size the preview happens to be rendered at.
    const crop = { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };
    let settled = false;
    // What the dialog will resolve with once it closes. Cancelling, Escape and
    // the backdrop all leave this null, which is what "no photo" looks like.
    let result = { blob: null, width: 0, height: 0 };

    const frame = el('div', { class: 'crop-frame' });
    const img = el('img', { class: 'crop-image', alt: '', draggable: 'false' });
    img.src = URL.createObjectURL(file);

    const shade = el('div', { class: 'crop-shade' });
    const window_ = el('div', { class: 'crop-window' }, [
      el('span', { class: 'crop-grip', dataset: { role: 'resize' } }),
    ]);
    frame.append(img, shade, window_);

    const ratios = [
      { id: 'free', label: 'Free', value: null },
      { id: 'square', label: 'Square', value: 1 },
      { id: 'landscape', label: '4:3', value: 4 / 3 },
      { id: 'portrait', label: '3:4', value: 3 / 4 },
    ];
    let ratio = null;

    const ratioRow = el('div', { class: 'seg crop-ratios' },
      ratios.map((r) =>
        el('button', {
          class: 'seg-item',
          type: 'button',
          text: r.label,
          'aria-pressed': String(r.value === ratio),
          onClick: (event) => {
            ratio = r.value;
            for (const b of ratioRow.children) b.setAttribute('aria-pressed', 'false');
            event.currentTarget.setAttribute('aria-pressed', 'true');
            applyRatio();
            place();
          },
        }),
      ),
    );

    /** Image aspect in the preview, needed to turn a pixel ratio into fractions. */
    const imageAspect = () => bitmap.width / bitmap.height;

    function applyRatio() {
      if (!ratio) return;
      // crop.w and crop.h are fractions of different axes, so a visual ratio
      // of 1:1 is not w === h — it has to be corrected by the image's aspect.
      crop.h = (crop.w * imageAspect()) / ratio;
      if (crop.h > 1) {
        crop.h = 1;
        crop.w = (crop.h * ratio) / imageAspect();
      }
      crop.y = Math.min(crop.y, 1 - crop.h);
      crop.x = Math.min(crop.x, 1 - crop.w);
    }

    function place() {
      Object.assign(window_.style, {
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.w * 100}%`,
        height: `${crop.h * 100}%`,
      });
      // The shade is the whole frame with the crop punched out of it.
      shade.style.clipPath =
        `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,` +
        ` ${crop.x * 100}% ${crop.y * 100}%,` +
        ` ${crop.x * 100}% ${(crop.y + crop.h) * 100}%,` +
        ` ${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%,` +
        ` ${(crop.x + crop.w) * 100}% ${crop.y * 100}%,` +
        ` ${crop.x * 100}% ${crop.y * 100}%)`;
    }

    frame.addEventListener('pointerdown', (event) => {
      const role = event.target.dataset?.role;
      const box = frame.getBoundingClientRect();
      // px/py, not x/y — `crop` has its own x and y, and spreading it over
      // those keys would replace the pointer position with the crop origin.
      const start = { px: event.clientX, py: event.clientY, ...crop };
      event.preventDefault();
      capturePointer(frame, event.pointerId);

      const onMove = (move) => {
        const dx = (move.clientX - start.px) / box.width;
        const dy = (move.clientY - start.py) / box.height;

        if (role === 'resize') {
          crop.w = Math.min(Math.max(0.08, start.w + dx), 1 - crop.x);
          if (ratio) applyRatio();
          else crop.h = Math.min(Math.max(0.08, start.h + dy), 1 - crop.y);
        } else {
          crop.x = Math.min(Math.max(0, start.x + dx), 1 - crop.w);
          crop.y = Math.min(Math.max(0, start.y + dy), 1 - crop.h);
        }
        place();
      };
      const onUp = () => {
        frame.removeEventListener('pointermove', onMove);
        frame.removeEventListener('pointerup', onUp);
      };
      frame.addEventListener('pointermove', onMove);
      frame.addEventListener('pointerup', onUp);
    });

    const body = el('div', {}, [
      frame,
      ratioRow,
      el('p', { class: 'settings-sub', text: 'Drag to move, pull the corner to resize.' }),
    ]);

    const finish = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(img.src);
      resolve(result);
    };

    const dialog = modal({
      title: 'Crop the photograph',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Use it',
          class: 'btn',
          // Returning false holds the dialog open. Encoding is asynchronous,
          // and letting the modal close on its own would tear the panel down
          // first — the dismiss observer below would then resolve the promise
          // with "cancelled" before the image had finished rendering.
          onClick: ({ close }) => {
            render(bitmap, crop)
              .then((rendered) => {
                result = rendered;
              })
              .catch((error) => {
                console.warn('Could not render the crop.', error);
              })
              .finally(close);
            return false;
          },
        },
      ],
    });

    // Escape and the backdrop close the dialog without going through an
    // action, so the promise has to be settled from the panel leaving the DOM
    // rather than from any one button.
    const observer = new MutationObserver(() => {
      if (document.contains(dialog.panel)) return;
      observer.disconnect();
      finish();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    place();
  });
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  // Safari without createImageBitmap for some types; fall back to an element.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Draw the chosen region, capped and re-encoded. */
async function render(bitmap, crop) {
  const sx = Math.round(crop.x * bitmap.width);
  const sy = Math.round(crop.y * bitmap.height);
  const sw = Math.max(1, Math.round(crop.w * bitmap.width));
  const sh = Math.max(1, Math.round(crop.h * bitmap.height));

  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    // WebP everywhere that matters; a browser without it falls back to JPEG
    // and the only cost is a slightly larger file.
    canvas.toBlob((out) => resolve(out), 'image/webp', QUALITY);
  });

  if (blob) return { blob, width, height };
  const jpeg = await new Promise((resolve) =>
    canvas.toBlob((out) => resolve(out), 'image/jpeg', QUALITY));
  return { blob: jpeg, width, height };
}
