import { el, clear, iconLink, iconButton } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { sortRecipes, SORT_MODES, totalTime } from '../lib/recipe.js';
import { createPagedSpread } from '../lib/paginate.js';
import { mountSpreadControls } from './spread.js';
import { mountDecorations, decorationTray } from './customise.js';
import { buildRecipeBody } from './recipe.js';
import { bookMenu } from './desk.js';
import { shareRecipe, shareBook } from './share.js';

/* The cookbook, as one book.

   Cover, then the index, then every recipe in order — a single flow you turn
   through from the front to the back, rather than a set of screens you jump
   between. The first recipe therefore lands on page three, on the left-hand
   leaf, which is where a cookbook you had made yourself would put it.

   The order of the pages IS the order of the index: change the sort and the
   book is rebound, because a cookbook's contents page is not a filter over
   some other order — it is the order. */

export function renderBook(host, bookId, query) {
  const book = store.bookById(bookId);
  if (!book) {
    location.hash = '#/';
    return;
  }

  const sortMode = book.sortMode || 'added';
  const recipes = sortRecipes(store.recipesInBook(book.id), sortMode);
  const decorating = query?.get('deco') === '1';

  const head = el('div', { class: 'scene-head' }, [
    el('h1', { class: 'wordmark' }, [
      book.title,
      el('small', { text: book.subtitle || 'Open on the desk' }),
    ]),
  ]);
  host.append(head);

  const trayHost = el('div', { class: 'tray-host' });
  if (decorating) host.append(trayHost);

  const stage = el('div', { class: 'book-stage' });
  const spread = el('div', {
    class: 'spread',
    dataset: { paper: book.paperStock || 'plain' },
  });
  stage.append(spread);
  host.append(stage);

  const actions = el('div', { class: 'scene-actions' });
  host.append(actions);

  // createPagedSpread measures — and therefore calls onChange — before it
  // returns, so the controls it talks to cannot be a const declared after it.
  let controls;
  const paged = createPagedSpread({
    host: spread,
    onChange: (api) => {
      controls?.update(api);
      api.onSpreadChange?.();
    },
  });
  controls = mountSpreadControls({ spread, paged });

  buildBookFlow(paged.flow, book, recipes);
  paged.refresh();

  /* Where each recipe begins, in absolute page numbers. Read from the laid-out
     flow rather than counted, because only the browser knows how many pages a
     recipe turned into. */
  function recipeStarts() {
    const flowBox = paged.flow.getBoundingClientRect();
    const stride = paged.pageSize.width + Number.parseFloat(
      getComputedStyle(paged.flow).columnGap || 0,
    );
    if (!stride) return [];
    return [...paged.flow.querySelectorAll('[data-recipe]')].map((node) => ({
      id: node.dataset.recipe,
      page: Math.round((node.getBoundingClientRect().left - flowBox.left) / stride),
    }));
  }

  /* Decoration is shown here but not edited here: elements store their page
     relative to their own recipe, so that a recipe growing — or the book being
     re-sorted — never drags anybody's photographs onto a different page. They
     are offset into the book's page numbering only for display. */
  const deco = mountDecorations({
    host: paged.viewport,
    paged,
    active: decorating,
    toolStyles: store.state.settings.toolStyles,
    read: () => {
      const out = (book.cover?.elements || []).map((e) => ({ ...e, page: 0 }));
      if (decorating) return out;

      const starts = new Map(recipeStarts().map((r) => [r.id, r.page]));
      for (const recipe of recipes) {
        const start = starts.get(recipe.id);
        if (start == null) continue;
        for (const element of recipe.elements || []) {
          out.push({ ...element, page: start + (element.page || 0), locked: true });
        }
      }
      return out;
    },
    write: (elements) => {
      // Only the cover is editable from here, so only the cover is written.
      store.updateBook(book.id, {
        cover: { ...book.cover, elements: elements.filter((e) => !e.locked) },
      });
      deco.refresh();
    },
  });

  paged.onSpreadChange = () => {
    deco.refresh();
    paintActions();
  };
  deco.refresh();

  if (decorating) {
    document.body.dataset.editing = '1';
    trayHost.append(decorationTray({ deco }));
    deco.setTool('move');
  }

  // Turning to a recipe from the index.
  paged.flow.addEventListener('click', (event) => {
    const link = event.target.closest('[data-goto]');
    if (!link) return;
    event.preventDefault();
    const start = recipeStarts().find((r) => r.id === link.dataset.goto);
    if (start != null) paged.goToSpread(paged.spreadOfPage(start.page));
  });

  /* --- what you can do with the page you are on --------------------------- */

  /* The actions follow the book: on the cover they are about the cookbook, and
     on a recipe they are about that recipe. Nothing has to be selected first —
     whatever is open is what you act on. */
  function currentRecipe() {
    const starts = recipeStarts();
    if (!starts.length) return null;
    // The recipe covering the LEFT-hand leaf, not the right. With two recipes
    // open at once the left one is what you turned to; taking the last would
    // hand you the actions for whatever happens to have started opposite it.
    const first = paged.spread * paged.perView;
    let found = null;
    for (const start of starts) if (start.page <= first) found = start;
    return found ? recipes.find((r) => r.id === found.id) : null;
  }

  function paintActions() {
    clear(actions);
    if (decorating) {
      actions.append(iconButton('check', 'Done', {
        primary: true,
        onClick: () => {
          delete document.body.dataset.editing;
          location.hash = `#/book/${book.id}`;
        },
      }));
      return;
    }

    const recipe = currentRecipe();
    actions.append(iconLink('desk', 'Back to the desk', '#/'));

    if (recipe) {
      actions.append(
        el('span', { class: 'action-label', text: recipe.title }),
        iconButton('edit', `Edit ${recipe.title}`, {
          onClick: () => { location.hash = `#/recipe/${recipe.id}?edit=1`; },
        }),
        iconButton('brush', `Customise ${recipe.title}`, {
          onClick: () => { location.hash = `#/recipe/${recipe.id}?deco=1`; },
        }),
        iconButton('share', `Share ${recipe.title}`, {
          onClick: () => shareRecipe(recipe),
        }),
        iconButton('flame', `Cook ${recipe.title}`, {
          primary: true,
          onClick: () => { location.hash = `#/cook/${recipe.id}`; },
        }),
      );
      return;
    }

    actions.append(
      iconButton('sliders', 'Cookbook settings', { onClick: () => bookMenu(book) }),
      iconButton('brush', 'Customise the cover', {
        onClick: () => { location.hash = `#/book/${book.id}?deco=1`; },
      }),
      iconButton('share', 'Share this cookbook', { onClick: () => shareBook(book) }),
      iconButton('plus', 'Add a recipe', {
        primary: true,
        onClick: () => {
          const recipe = store.addRecipe({ bookId: book.id });
          location.hash = `#/recipe/${recipe.id}?edit=1`;
        },
      }),
    );
  }
  paintActions();
}

/* --- the flow ---------------------------------------------------------------- */

/* The cover and the index are fixed pages: exactly one leaf each, no more and
   no less, which `break-after: column` on a full-height block gives us. Every
   recipe then starts on a fresh page of its own. */
function buildBookFlow(flow, book, recipes) {
  clear(flow);
  flow.append(coverPage(book), indexPage(book, recipes));

  for (const recipe of recipes) {
    const block = el('section', {
      class: 'recipe-block',
      dataset: { recipe: recipe.id },
    });
    buildRecipeBody(block, recipe, false);
    flow.append(block);
  }

  if (!recipes.length) {
    flow.append(el('div', { class: 'fixed-page page-empty' }, [
      el('p', { class: 'empty', text: 'Nothing written down yet. Add the first recipe.' }),
    ]));
  }
}

function coverPage(book) {
  const decorated = (book.cover?.elements || []).length > 0;
  return el('div', { class: 'fixed-page page-cover' }, [
    el('div', { class: 'cover-plate' }, [
      el('div', { class: 'label', text: 'Cookbook' }),
      el('h2', { class: 'cover-title', text: book.title }),
      book.subtitle && el('p', { class: 'cover-sub', text: book.subtitle }),
    ]),
    // The prompt is there until the page has something on it, then gets out of
    // the way — it is scaffolding, not part of the design.
    !decorated && el('p', {
      class: 'cover-hint',
      text: 'Yours to fill — photographs, stickers, doodles.',
    }),
  ]);
}

function indexPage(book, recipes) {
  const page = el('div', { class: 'fixed-page page-index' });

  page.append(
    el('div', { class: 'index-head' }, [
      el('h2', { class: 'page-heading', text: 'Recipes' }),
      el('div', { class: 'seg seg-wrap' },
        SORT_MODES.map((mode) =>
          el('button', {
            class: 'seg-item',
            type: 'button',
            text: mode.label,
            'aria-pressed': String((book.sortMode || 'added') === mode.id),
            // Re-sorting rebinds the book, so the whole view is rebuilt.
            onClick: () => store.updateBook(book.id, { sortMode: mode.id }),
          }),
        ),
      ),
    ]),
  );

  if (!recipes.length) {
    page.append(el('p', { class: 'empty', text: 'Nothing written down yet.' }));
    return page;
  }

  const list = el('ol', { class: 'index-list' });
  for (const recipe of recipes) {
    const minutes = totalTime(recipe);
    list.append(
      el('li', {}, [
        el('a', { class: 'index-row', href: '#', dataset: { goto: recipe.id } }, [
          el('span', { class: 'index-name', text: recipe.title }),
          el('span', { class: 'index-dots', 'aria-hidden': 'true' }),
          el('span', { class: 'index-time', text: minutes ? `${minutes} min` : '—' }),
        ]),
      ]),
    );
  }
  page.append(list);
  return page;
}
