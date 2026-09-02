import { el, clear, iconLink, iconButton, claimBodyFlag } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { sortRecipes, SORT_MODES, totalTime } from '../lib/recipe.js';
import { createPagedSpread } from '../lib/paginate.js';
import { mountSpreadControls } from './spread.js';
import { mountDecorations, decorationTray } from './customise.js';
import { buildRecipeBody } from './recipe.js';
import { bookMenu } from './desk.js';
import { shareRecipe, shareBook, importMarkdown } from './share.js';
import { modal } from '../lib/dom.js';

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
  let releaseDecoFlag;
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
    if (!visibleRecipes().some((r) => r.id === chosenId)) chosenId = null;
    paintActions();
  };
  deco.refresh();

  if (decorating) {
    releaseDecoFlag = claimBodyFlag('editing', paged.viewport);
    trayHost.append(decorationTray({
      deco,
      toolStyles: store.state.settings.toolStyles,
      onStyle: (toolStyles) => store.updateSettings({ toolStyles }),
    }));
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
  /* Which recipe each visible page belongs to, left to right, with duplicates
     removed. Usually one; two when a recipe ends and the next begins on the
     facing page. */
  function visibleRecipes() {
    const starts = recipeStarts();
    if (!starts.length) return [];

    const first = paged.spread * paged.perView;
    const seen = [];
    for (let i = 0; i < paged.perView; i += 1) {
      const page = first + i;
      if (page >= paged.pageCount) break;
      let owner = null;
      for (const start of starts) if (start.page <= page) owner = start;
      if (owner && !seen.includes(owner.id)) seen.push(owner.id);
    }
    return seen.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
  }

  /* Which one the buttons act on. It follows the page you turned to, but you
     can pick the other when both are open — before this, the right-hand recipe
     could be read but never cooked, edited or shared. */
  let chosenId = null;

  function currentRecipe() {
    const visible = visibleRecipes();
    if (!visible.length) return null;
    return visible.find((r) => r.id === chosenId) || visible[0];
  }

  function paintActions() {
    clear(actions);
    if (decorating) {
      actions.append(iconButton('check', 'Done', {
        primary: true,
        onClick: () => {
          releaseDecoFlag?.();
          location.hash = `#/book/${book.id}`;
        },
      }));
      return;
    }

    const recipe = currentRecipe();
    const visible = visibleRecipes();
    actions.append(iconLink('desk', 'Back to the desk', '#/'));

    if (recipe) {
      // With two recipes open, the names become a choice rather than a label.
      actions.append(visible.length > 1
        ? el('div', { class: 'seg recipe-pick' }, visible.map((r) =>
          el('button', {
            class: 'seg-item',
            type: 'button',
            text: r.title,
            'aria-pressed': String(r.id === recipe.id),
            onClick: () => {
              chosenId = r.id;
              paintActions();
            },
          })))
        : el('span', { class: 'action-label', text: recipe.title }),
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
        onClick: () => addRecipeTo(book),
      }),
    );
  }
  paintActions();
}

/* --- adding a recipe ---------------------------------------------------------- */

/* All three ways in, from the one button inside the cookbook you are standing
   in — which is where a person looks for "add a recipe", rather than an
   unlabelled icon in the corner of the desk. Whichever you pick, it lands in
   this cookbook. */
function addRecipeTo(book) {
  const choose = (label, description, onPick) =>
    el('button', { class: 'pick-row add-choice', type: 'button', onClick: () => {
      document.querySelector('.modal-backdrop')?.remove();
      onPick();
    } }, [
      el('span', { class: 'pick-name', text: label }),
      el('span', { class: 'add-choice-sub', text: description }),
    ]);

  modal({
    title: `Add to “${book.title}”`,
    body: el('div', { class: 'add-choices' }, [
      choose('Write it out', 'A blank page to type onto.', () => {
        const recipe = store.addRecipe({ bookId: book.id });
        location.hash = `#/recipe/${recipe.id}?edit=1`;
      }),
      choose('From a link, screenshot or words', 'Read it in from somewhere else.', () => {
        location.hash = `#/import?book=${book.id}`;
      }),
      choose('From a shared file', 'A .md recipe someone sent you.', () => {
        importMarkdown(book.id);
      }),
    ]),
    actions: [{ label: 'Cancel' }],
  });
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

/* The index is not a fixed page: with more recipes than fit on a leaf it runs
   onto the next one, the way a contents page does. The cover stays exactly one
   page, and recipes still start fresh after it — so with a short index the
   first recipe is on page three as before, and with a long one it simply
   arrives later. */
function indexPage(book, recipes) {
  const page = el('div', { class: 'page-index' });

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
