/* The page-flow engine.

   A recipe has to run across as many pages as it needs, and the text has to
   break across them the way it would in a real book — mid-paragraph, mid-
   sentence, wherever the page runs out.

   The trick is to let the browser do it. The recipe body is one CSS
   multi-column element whose column width IS a page width and whose height IS
   a page height. The browser fragments the content into columns; we clip to
   two of them and turn a leaf to reach the next. There is no measure-render-
   remeasure loop, no manual block splitting, and no reflow jitter, because
   nothing here decides where the text breaks — CSS does, natively.

   Decoration does not live in the flow. Stickers, photos and doodles are
   positioned in per-page overlays keyed by page index (Phase 2), so a doodle
   stays where it was drawn even when the text above it grows and pushes the
   words onto the next page. */

const EPSILON = 2; // px of slack when counting columns, for sub-pixel layout

/* Below this, a two-page spread leaves each page too narrow to read and the
   lines break every three words. A phone gets one leaf at a time instead —
   the flow is identical, only the number of columns on screen changes. */
const SINGLE_PAGE_BELOW = 700;

const TURN_MS = 780;

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPagedSpread({ host, gutter = 64, onChange } = {}) {
  const viewport = document.createElement('div');
  viewport.className = 'flow-viewport';

  const flow = document.createElement('div');
  flow.className = 'flow';

  const leafLayer = document.createElement('div');
  leafLayer.className = 'leaf-layer';
  leafLayer.hidden = true;

  viewport.append(flow, leafLayer);
  host.append(viewport);

  let spread = 0;
  let pageCount = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let perView = 2;
  let turning = false;

  // Writing the column properties re-fragments the flow, and doing that while
  // someone is typing inside it can drop the selection — the caret then lands
  // back in the first editable block and words end up in the title. So the
  // layout is written only when it has actually changed, and the per-keystroke
  // path touches nothing but `transform`, which the selection does not care
  // about. This is the whole reason the two are separated.
  let layoutKey = '';

  const stride = () => pageWidth + gutter;
  const maxSpread = () => Math.max(0, Math.ceil(pageCount / perView) - 1);

  function measure() {
    // The margin of the page is padding on the viewport, so the flow has to
    // be sized to the content box. Measuring the border box instead lays the
    // columns out wider than the space they are clipped to, and the outer
    // edge of every right-hand page is quietly cut off.
    const style = getComputedStyle(viewport);
    const padLeft = Number.parseFloat(style.paddingLeft);
    const padTop = Number.parseFloat(style.paddingTop);
    const width =
      viewport.clientWidth - padLeft - Number.parseFloat(style.paddingRight);
    const height =
      viewport.clientHeight - padTop - Number.parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0) return;

    perView = width < SINGLE_PAGE_BELOW ? 1 : 2;
    pageWidth = perView === 1 ? width : (width - gutter) / 2;
    pageHeight = height;

    const key = `${width}|${height}|${perView}`;
    if (key !== layoutKey) {
      layoutKey = key;
      preservingSelection(() => {
        flow.style.width = `${width}px`;
        flow.style.height = `${pageHeight}px`;
        flow.style.columnGap = `${gutter}px`;
        flow.style.columnWidth = `${pageWidth}px`;
        // Without this the browser is free to fit three narrow columns where
        // we asked for two, and every measurement below would be off a page.
        flow.style.columnCount = String(perView);
      });

      Object.assign(leafLayer.style, {
        left: `${padLeft}px`,
        top: `${padTop}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    }

    // Content past the last visible column overflows to the right as further
    // columns; scrollWidth is therefore the true extent of the flow.
    pageCount = Math.max(1, Math.round((flow.scrollWidth + gutter - EPSILON) / stride()));
    if (spread > maxSpread()) spread = maxSpread();

    flow.style.transform = `translate3d(${-spread * perView * stride()}px, 0, 0)`;
    host.style.setProperty('--page-w', `${pageWidth}px`);
    host.style.setProperty('--page-h', `${pageHeight}px`);
    host.style.setProperty('--gutter', `${gutter}px`);

    onChange?.(api);
  }

  /** Run `fn`, then put the caret back where it was. */
  function preservingSelection(fn) {
    const selection = window.getSelection();
    const saved =
      selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    fn();
    if (!saved) return;
    try {
      selection.removeAllRanges();
      selection.addRange(saved);
    } catch {
      /* the range no longer resolves; leave the caret wherever it landed */
    }
  }

  /* --- turning a leaf ------------------------------------------------------ */

  /** One page's worth of the flow, clipped, for a face of the turning leaf. */
  function snapshot(pageIndex) {
    const page = document.createElement('div');
    page.className = 'leaf-page';
    page.style.left = `${perView === 1 ? 0 : gutter / 2}px`;
    page.style.width = `${pageWidth}px`;
    page.style.height = `${pageHeight}px`;

    const copy = flow.cloneNode(true);
    copy.style.transform = `translate3d(${-pageIndex * stride()}px, 0, 0)`;
    // A clone must never be focusable or the caret can land in a page that is
    // about to be thrown away.
    for (const node of copy.querySelectorAll('[contenteditable]')) {
      node.removeAttribute('contenteditable');
    }
    page.append(copy);
    return page;
  }

  function face(pageIndex, isBack) {
    const node = document.createElement('div');
    node.className = `leaf-face${isBack ? ' is-back' : ''}`;
    node.append(snapshot(pageIndex));
    return node;
  }

  /**
   * Turn one leaf. The sheet's front is the page you are leaving and its back
   * is the page you are turning to — which is what a leaf physically is. The
   * pages either side are already in their new state underneath, and a static
   * copy of the page the leaf will land on top of sits in between, so nothing
   * appears before the paper has covered it.
   */
  function turn(direction) {
    const target = spread + direction;
    if (turning || target < 0 || target > maxSpread()) return;
    if (reducedMotion()) {
      goToSpread(target);
      return;
    }
    turning = true;

    const half = gutter / 2;
    const from = direction > 0 ? 0 : -180;
    const to = direction > 0 ? -180 : 0;

    let frontPage;
    let backPage;
    let under = null;

    if (perView === 2) {
      if (direction > 0) {
        frontPage = spread * 2 + 1;      // the right page you are leaving
        backPage = target * 2;           // the left page you are turning to
        under = { page: spread * 2, side: 'left' };
      } else {
        frontPage = target * 2 + 1;      // the right page the leaf lands on
        backPage = spread * 2;           // the left page you are leaving
        under = { page: spread * 2 + 1, side: 'right' };
      }
    } else if (direction > 0) {
      frontPage = spread;
      backPage = target;
    } else {
      frontPage = target;
      backPage = spread;
      under = { page: spread, side: 'full' };
    }

    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    if (perView === 2) {
      leaf.style.left = `${pageWidth + half}px`;
      leaf.style.width = `${pageWidth + half}px`;
    } else {
      leaf.style.left = '0px';
      leaf.style.width = `${pageWidth}px`;
    }
    leaf.style.transformOrigin = 'left center';
    leaf.style.transform = `rotateY(${from}deg)`;
    leaf.append(face(frontPage, false), face(backPage, true));

    leafLayer.replaceChildren();
    if (under) {
      const box = document.createElement('div');
      box.className = 'leaf-under';
      if (under.side === 'left') {
        box.style.left = '0px';
        box.style.width = `${pageWidth + half}px`;
      } else if (under.side === 'right') {
        box.style.left = `${pageWidth + half}px`;
        box.style.width = `${pageWidth + half}px`;
      } else {
        box.style.left = '0px';
        box.style.width = `${pageWidth}px`;
      }
      const page = snapshot(under.page);
      page.style.left = under.side === 'right' ? `${half}px` : '0px';
      box.append(page);
      leafLayer.append(box);
    }
    leafLayer.append(leaf);
    leafLayer.hidden = false;

    // The pages underneath are put into their new state now, so that the
    // moment the leaf lifts, what is revealed is already correct.
    spread = target;
    measure();

    const animation = leaf.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration: TURN_MS, easing: 'cubic-bezier(.42,.02,.24,1)' },
    );

    animation.finished
      .catch(() => {})
      .finally(() => {
        leafLayer.hidden = true;
        leafLayer.replaceChildren();
        turning = false;
      });
  }

  function goToSpread(next) {
    const clamped = Math.min(Math.max(0, next), maxSpread());
    if (clamped === spread) return;
    spread = clamped;
    measure();
  }

  // EB Garamond changes the metrics once it lands, so a measurement taken
  // before the webfont arrives is measuring the fallback and will be wrong.
  document.fonts?.ready.then(measure).catch(() => {});

  const observer = new ResizeObserver(() => measure());
  observer.observe(viewport);

  const api = {
    flow,
    viewport,
    get pageCount() {
      return pageCount;
    },
    get spreadCount() {
      return maxSpread() + 1;
    },
    get spread() {
      return spread;
    },
    /** How many pages are on screen at once: two on a desk, one on a phone. */
    get perView() {
      return perView;
    },
    get isTurning() {
      return turning;
    },
    get pageSize() {
      return { width: pageWidth, height: pageHeight };
    },

    /** Re-measure after the content changes. Cheap; call it freely. */
    refresh: measure,

    goToSpread,
    next: () => turn(1),
    back: () => turn(-1),

    /**
     * Where each visible page sits inside the viewport's content box. The
     * decoration overlay hangs off this: one overlay per visible page,
     * positioned here, with everything inside it placed as a fraction of the
     * page box so it lands identically at any size.
     */
    pageRects() {
      const out = [];
      for (let i = 0; i < perView; i += 1) {
        const page = spread * perView + i;
        if (page >= pageCount) break;
        out.push({
          page,
          left: i * stride(),
          top: 0,
          width: pageWidth,
          height: pageHeight,
        });
      }
      return out;
    },

    /** Which spread a given page falls on — for jumping to a recipe by index. */
    spreadOfPage(page) {
      return Math.floor(page / perView);
    },

    destroy() {
      observer.disconnect();
      viewport.remove();
    },
  };

  measure();
  return api;
}
