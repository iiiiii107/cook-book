import { el, iconLink, iconButton } from '../lib/dom.js';
import { mountDecorations, decorationTray } from './customise.js';
import { store } from '../lib/store.js';
import { sortRecipes, SORT_MODES, totalTime } from '../lib/recipe.js';
import { bookMenu } from './desk.js';

/* The book, open at the front.

   Left leaf is the cover page — yours to fill with photographs, stickers and
   whatever you want to say about cooking (Phase 2 hangs the decoration layer
   here). Right leaf is the index: every recipe in the book, newest addition
   last, with the sort you asked for. */

export function renderBook(host, bookId, query) {
  const book = store.bookById(bookId);
  if (!book) {
    location.hash = '#/';
    return;
  }
  const decorating = query?.get('deco') === '1';

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        book.title,
        el('small', { text: book.subtitle || 'Open on the desk' }),
      ]),
      el('div', { class: 'scene-actions' }, decorating
        ? [
            iconButton('check', 'Done', {
              primary: true,
              onClick: () => {
                delete document.body.dataset.editing;
                location.hash = `#/book/${book.id}`;
              },
            }),
          ]
        : [
            iconLink('desk', 'Back to the desk', '#/'),
            iconButton('sliders', 'Cookbook settings', { onClick: () => bookMenu(book) }),
            iconButton('brush', 'Customise the cover', {
              onClick: () => {
                location.hash = `#/book/${book.id}?deco=1`;
              },
            }),
            iconButton('plus', 'Add a recipe', {
              primary: true,
              onClick: () => {
                const recipe = store.addRecipe({ bookId: book.id });
                location.hash = `#/recipe/${recipe.id}?edit=1`;
              },
            }),
          ]),
    ]),
  );

  const trayHost = el('div', { class: 'tray-host' });
  if (decorating) host.append(trayHost);

  const stage = el('div', { class: 'book-stage' });
  const spread = el('div', { class: 'spread', dataset: { paper: book.paperStock || 'plain' } });
  const cover = coverPage(book);
  spread.append(cover, indexPage(book));
  stage.append(spread);
  host.append(stage);

  // The cover is the one page you fill yourself. It is not part of a text
  // flow, so it stands in for the pagination engine with a single fixed page.
  const decoHost = el('div', { class: 'deco-host' });
  cover.append(decoHost);

  const asOnePage = {
    pageRects: () => [{
      page: 0,
      left: 0,
      top: 0,
      width: decoHost.clientWidth,
      height: decoHost.clientHeight,
    }],
  };

  const deco = mountDecorations({
    host: decoHost,
    paged: asOnePage,
    active: decorating,
    toolStyles: store.state.settings.toolStyles,
    read: () => structuredClone(store.bookById(book.id)?.cover?.elements || []),
    write: (elements) => {
      store.updateBook(book.id, { cover: { ...book.cover, elements } });
      deco.refresh();
    },
  });

  // The layer has to be measured after the spread has taken its size.
  requestAnimationFrame(() => deco.refresh());
  new ResizeObserver(() => deco.refresh()).observe(decoHost);

  if (decorating) {
    document.body.dataset.editing = '1';
    trayHost.append(decorationTray({ deco }));
    deco.setTool('move');
  }
}

/* --- the cover page ------------------------------------------------------- */

function coverPage(book) {
  const decorated = (book.cover?.elements || []).length > 0;

  return el('div', { class: 'page page-cover' }, [
    el('div', { class: 'cover-plate' }, [
      el('div', { class: 'label', text: 'Cookbook' }),
      el('h2', { class: 'cover-title', text: book.title }),
      book.subtitle && el('p', { class: 'cover-sub', text: book.subtitle }),
    ]),
    // The prompt is there until the page has something on it, then gets out
    // of the way — it is scaffolding, not part of the design.
    !decorated && el('p', {
      class: 'cover-hint',
      text: 'Yours to fill — photographs, stickers, doodles.',
    }),
  ]);
}

/* --- the index page -------------------------------------------------------- */

function indexPage(book) {
  const page = el('div', { class: 'page page-index' });
  const recipes = store.recipesInBook(book.id);

  page.append(
    el('div', { class: 'index-head' }, [
      el('h2', { class: 'page-heading', text: 'Recipes' }),
      el(
        'div',
        { class: 'seg' },
        SORT_MODES.map((mode) =>
          el('button', {
            class: 'seg-item',
            type: 'button',
            text: mode.label,
            'aria-pressed': String((book.sortMode || 'added') === mode.id),
            onClick: () => store.updateBook(book.id, { sortMode: mode.id }),
          }),
        ),
      ),
    ]),
  );

  if (!recipes.length) {
    page.append(
      el('p', { class: 'empty', text: 'Nothing written down yet. Add the first recipe.' }),
    );
    return page;
  }

  const list = el('ol', { class: 'index-list' });
  for (const recipe of sortRecipes(recipes, book.sortMode || 'added')) {
    const minutes = totalTime(recipe);
    list.append(
      el('li', {}, [
        el(
          'a',
          {
            class: 'index-row',
            href: `#/recipe/${recipe.id}`,
          },
          [
            el('span', { class: 'index-name', text: recipe.title }),
            el('span', { class: 'index-dots', 'aria-hidden': 'true' }),
            el('span', {
              class: 'index-time',
              text: minutes ? `${minutes} min` : '—',
            }),
          ],
        ),
      ]),
    );
  }
  page.append(list);
  return page;
}
