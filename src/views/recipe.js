import { el, clear, iconLink, iconButton, claimBodyFlag } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { createPagedSpread } from '../lib/paginate.js';
import { formatIngredient, totalTime } from '../lib/recipe.js';
import { attachEditor } from './recipe-edit.js';
import { mountDecorations, decorationTray } from './customise.js';
import { mountSpreadControls } from './spread.js';
import { shareRecipe } from './share.js';

/* A recipe, on paper.

   The whole recipe is one flow: heading, the details line, ingredients,
   method, notes. It is handed to the pagination engine, which fragments it
   into page-sized columns and shows two at a time. Nothing here decides where
   a page break falls — that is the point. */

export function renderRecipe(host, recipeId, query) {
  const recipe = store.recipeById(recipeId);
  if (!recipe) {
    location.hash = '#/';
    return;
  }
  const book = store.bookById(recipe.bookId);
  const editing = query?.get('edit') === '1';
  const decorating = query?.get('deco') === '1';

  host.append(header(recipe, book, editing, decorating));

  // The tray is only mounted while customising; the decoration layer itself
  // is always there, because photographs have to be visible when reading.
  const trayHost = el('div', { class: 'tray-host' });
  if (decorating) host.append(trayHost);

  const stage = el('div', { class: 'book-stage' });
  const spread = el('div', {
    class: 'spread',
    dataset: { paper: book?.paperStock || 'plain' },
  });
  stage.append(spread);
  host.append(stage);

  let controls;
  const paged = createPagedSpread({
    host: spread,
    onChange: (api) => {
      controls?.update(api);
      api.onSpreadChange?.();
    },
  });
  controls = mountSpreadControls({ spread, paged });

  buildFlow(paged.flow, recipe, editing);
  paged.refresh();

  let releaseDecoFlag;
  const deco = mountDecorations({
    host: paged.viewport,
    paged,
    active: decorating,
    toolStyles: store.state.settings.toolStyles,
    read: () => structuredClone(store.recipeById(recipe.id)?.elements || []),
    write: (elements) => {
      // Customising holds the re-render the same way editing does, so a
      // sticker being dragged is not yanked out from under the pointer.
      store.updateRecipe(recipe.id, { elements });
      deco.refresh();
    },
  });
  deco.refresh();
  paged.onSpreadChange = () => deco.refresh();

  if (decorating) {
    releaseDecoFlag = claimBodyFlag('editing', paged.viewport);
    trayHost.append(decorationTray({
      deco,
      toolStyles: store.state.settings.toolStyles,
      onStyle: (toolStyles) => store.updateSettings({ toolStyles }),
    }));
    deco.setTool('move');
  }

  if (editing) attachEditor({ recipe, flow: paged.flow, paged });

  // Turning the page with the arrow keys, as long as you aren't typing.
  const onKey = (event) => {
    if (event.target.isContentEditable || event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowRight') paged.next();
    if (event.key === 'ArrowLeft') paged.back();
  };
  document.addEventListener('keydown', onKey);
  // The scene is cleared on every route change, so clean up with it.
  new MutationObserver((records, observer) => {
    if (!document.contains(spread)) {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
    }
  }).observe(host.parentNode || document.body, { childList: true, subtree: true });
}

/* --- the header bar -------------------------------------------------------- */

function header(recipe, book, editing, decorating) {
  const actions = el('div', { class: 'scene-actions' });
  // Just navigate. The hold on the background re-render lifts by itself when
  // this view is torn down — whoever claimed it is watching its own node, and
  // reaching for that variable from here was a scope error that threw and
  // stopped the navigation ever happening.
  const leave = () => {
    location.hash = `#/recipe/${recipe.id}`;
  };

  if (editing || decorating) {
    actions.append(iconButton('check', 'Done', { primary: true, onClick: leave }));
  } else {
    actions.append(
      iconLink('book', book ? `Back to ${book.title}` : 'Back to the desk',
        book ? `#/book/${book.id}` : '#/'),
      iconButton('edit', 'Edit the words', {
        onClick: () => {
          location.hash = `#/recipe/${recipe.id}?edit=1`;
        },
      }),
      iconButton('brush', 'Customise the page', {
        onClick: () => {
          location.hash = `#/recipe/${recipe.id}?deco=1`;
        },
      }),
      iconButton('share', 'Share this recipe', { onClick: () => shareRecipe(recipe) }),
      iconButton('flame', 'Cook this', {
        primary: true,
        onClick: () => {
          location.hash = `#/cook/${recipe.id}`;
        },
      }),
    );
  }

  const title = editing ? 'Editing' : decorating ? 'Customising' : recipe.title;
  const sub = editing
    ? 'Type straight onto the page'
    : decorating
      ? 'Stick things on, draw, move them about'
      : book?.title || '';

  return el('div', { class: 'scene-head' }, [
    el('h1', { class: 'wordmark' }, [title, el('small', { text: sub })]),
    actions,
  ]);
}

/* --- the flow --------------------------------------------------------------- */

/**
 * Build the recipe as one continuous run of blocks. `editing` only decides
 * which parts are contenteditable — the structure is identical either way, so
 * text sits in exactly the same place whether you are reading or writing.
 */
export function buildFlow(flow, recipe, editing) {
  clear(flow);
  buildRecipeBody(flow, recipe, editing);
}

/**
 * The recipe itself, appended to whatever it is given. Kept separate from
 * buildFlow so the cookbook can lay several recipes into one continuous flow
 * without each of them clearing the ones before it.
 */
export function buildRecipeBody(flow, recipe, editing) {
  flow.append(
    el('h2', {
      class: 'recipe-title',
      contenteditable: editing ? 'plaintext-only' : null,
      'data-field': 'title',
      'data-placeholder': 'Name the recipe',
      text: recipe.title,
    }),
  );

  flow.append(editing ? metaFields(recipe) : metaLine(recipe));

  flow.append(el('h3', { class: 'recipe-heading', text: 'Ingredients' }));
  // The lists are plain `true`, not `plaintext-only`. In plaintext-only mode
  // the browser treats the subtree as a flat string and quietly normalises
  // away any <li> inserted into it, so Enter can never make a new item. The
  // paste handler in recipe-edit.js is what keeps pasted markup out instead.
  const ingredients = el('ul', {
    class: 'recipe-ingredients allow-break',
    contenteditable: editing ? 'true' : null,
    'data-field': 'ingredients',
  });
  if (recipe.ingredients.length) {
    for (const ing of recipe.ingredients) {
      ingredients.append(el('li', { text: formatIngredient(ing) }));
    }
  } else {
    ingredients.append(
      el('li', { class: editing ? '' : 'empty', text: editing ? '' : 'Nothing listed yet' }),
    );
  }
  flow.append(ingredients);

  flow.append(el('h3', { class: 'recipe-heading', text: 'Method' }));
  const steps = el('ol', {
    class: 'recipe-steps allow-break',
    contenteditable: editing ? 'true' : null,
    'data-field': 'steps',
  });
  if (recipe.steps.length) {
    for (const step of recipe.steps) steps.append(el('li', { text: step.text }));
  } else {
    steps.append(el('li', { class: editing ? '' : 'empty', text: editing ? '' : 'No method yet' }));
  }
  flow.append(steps);

  flow.append(el('h3', { class: 'recipe-heading', text: 'Notes' }));
  flow.append(
    el('div', {
      class: 'recipe-notes allow-break',
      contenteditable: editing ? 'plaintext-only' : null,
      'data-field': 'notes',
      'data-placeholder': 'Anything worth remembering next time',
      text: recipe.notes || (editing ? '' : '—'),
    }),
  );
}

/**
 * The details line while editing. Real inputs rather than contenteditable
 * spans: portions and times are numbers and the source is a URL, and a number
 * field that refuses letters is worth more here than the purity of having the
 * whole page be one editing surface. The block never spans a page break, so
 * nothing is lost by it not being part of the flowing text.
 *
 * Values are written straight to the store on change. There is no caret to
 * protect in a one-line input, so these do not need the editing hold.
 */
function metaFields(recipe) {
  const num = (value, label, onCommit) => {
    const input = el('input', {
      class: 'meta-num',
      type: 'number',
      min: '0',
      max: '999',
      value: String(value ?? 0),
      'aria-label': label,
      onChange: (event) => onCommit(Math.max(0, Number(event.target.value) || 0)),
    });
    return input;
  };

  const servings = num(recipe.servings, 'Portions', (v) =>
    store.updateRecipe(recipe.id, { servings: v || 1 }));
  const prep = num(recipe.time?.prep, 'Preparation time in minutes', (v) =>
    store.updateRecipe(recipe.id, { time: { ...recipe.time, prep: v } }));
  const cook = num(recipe.time?.cook, 'Cooking time in minutes', (v) =>
    store.updateRecipe(recipe.id, { time: { ...recipe.time, cook: v } }));

  const url = el('input', {
    class: 'meta-url',
    type: 'url',
    value: recipe.sourceUrl || '',
    placeholder: 'where it came from (optional)',
    'aria-label': 'Source link',
    onChange: (event) => {
      const link = event.target.value.trim();
      if (link && !/^https?:\/\//i.test(link)) {
        event.target.value = `https://${link}`;
      }
      store.updateRecipe(recipe.id, { sourceUrl: event.target.value.trim() });
    },
  });

  const label = el('input', {
    class: 'meta-url',
    type: 'text',
    value: recipe.sourceLabel || '',
    placeholder: 'called (optional)',
    'aria-label': 'What to call the source',
    onChange: (event) =>
      store.updateRecipe(recipe.id, { sourceLabel: event.target.value.trim() }),
  });

  return el('div', { class: 'meta-edit' }, [
    el('span', { class: 'meta-field' }, [servings, el('span', { text: 'portions' })]),
    el('span', { class: 'meta-field' }, [prep, el('span', { text: 'min prep' })]),
    el('span', { class: 'meta-field' }, [cook, el('span', { text: 'min cooking' })]),
    el('span', { class: 'meta-field is-wide' }, [url, label]),
  ]);
}

function metaLine(recipe) {
  const minutes = totalTime(recipe);
  const bits = [
    el('span', {}, [
      el('strong', { text: String(recipe.servings || '—') }),
      ` ${recipe.servings === 1 ? 'portion' : 'portions'}`,
    ]),
  ];

  if (minutes) {
    const parts = [];
    if (recipe.time?.prep) parts.push(`${recipe.time.prep} prep`);
    if (recipe.time?.cook) parts.push(`${recipe.time.cook} cooking`);
    bits.push(
      el('span', {}, [el('strong', { text: `${minutes} min` }), parts.length ? ` · ${parts.join(', ')}` : '']),
    );
  }

  if (recipe.sourceUrl) {
    bits.push(
      el('a', {
        class: 'recipe-source',
        href: recipe.sourceUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: recipe.sourceLabel || sourceHost(recipe.sourceUrl),
      }),
    );
  }

  return el('p', { class: 'recipe-meta' }, interleave(bits));
}

function interleave(nodes) {
  const out = [];
  nodes.forEach((node, i) => {
    if (i) out.push(el('span', { class: 'meta-sep', 'aria-hidden': 'true', text: '·' }));
    out.push(node);
  });
  return out;
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}
