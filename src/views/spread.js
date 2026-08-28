import { el, icon } from '../lib/dom.js';

/* The furniture every open book has: an arrow at each outer edge, the folio
   along the bottom, arrow keys, and a swipe. Shared so the cookbook and a
   single recipe turn pages identically — they are the same book. */

export function mountSpreadControls({ spread, paged, label = 'page' }) {
  const folio = el('span', { class: 'folio' });

  const back = el('button', {
    class: 'turn turn-back', type: 'button',
    title: 'Previous page', 'aria-label': 'Previous page',
  }, [icon('chevronLeft')]);

  const next = el('button', {
    class: 'turn turn-next', type: 'button',
    title: 'Next page', 'aria-label': 'Next page',
  }, [icon('chevronRight')]);

  back.addEventListener('click', () => paged.back());
  next.addEventListener('click', () => paged.next());
  spread.append(back, next, el('div', { class: 'page-nav' }, [folio]));

  function update(api) {
    const left = api.spread * api.perView + 1;
    const right = Math.min(left + api.perView - 1, api.pageCount);
    folio.textContent =
      api.pageCount <= 1
        ? `one ${label}`
        : left === right
          ? `${label} ${left} of ${api.pageCount}`
          : `${label}s ${left}–${right} of ${api.pageCount}`;
    back.disabled = api.spread === 0;
    next.disabled = api.spread >= api.spreadCount - 1;
  }

  // Swiping turns the page — on a tablet that is the natural gesture, and the
  // arrows are deliberately small.
  let from = null;
  spread.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.target.isContentEditable) return;
    from = { x: event.clientX, y: event.clientY };
  });
  spread.addEventListener('pointerup', (event) => {
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    from = null;
    // Horizontal, decisive, and not just a slow drag down the page.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) paged.next();
    else paged.back();
  });

  const onKey = (event) => {
    if (event.target.isContentEditable || event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowRight') paged.next();
    if (event.key === 'ArrowLeft') paged.back();
  };
  document.addEventListener('keydown', onKey);

  // The scene is emptied on every route change; go with it.
  const observer = new MutationObserver(() => {
    if (document.contains(spread)) return;
    document.removeEventListener('keydown', onKey);
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return { update, folio, back, next };
}
