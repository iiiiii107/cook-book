import { el, modal, toast, iconLink, iconButton, chefName } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { todayISO, startOfWeek, addDays, formatShort, weekLabel, DAY_FULL, dayOfWeek } from '../lib/dates.js';
import { MEALS, buildList, toMarkdown, listFilename } from '../lib/shopping.js';
import { formatAmount } from '../lib/units.js';
import { sortRecipes } from '../lib/recipe.js';

/* The planning sheet.

   A loose sheet on the desk rather than a page in any one book, because a
   week's meals are drawn from whichever cookbooks you like. Recipes are
   dragged onto it from a drawer of everything you own; anything that is not a
   recipe can be written straight in ("leftovers", "out").

   The list that comes off it is a file, not another screen — see shopping.js
   for why. */

export function renderPlan(host, query) {
  const start = query?.get('week') || startOfWeek(todayISO(), 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const thisWeek = startOfWeek(todayISO(), 1);
  const oldest = store.oldestPlannedWeek();
  const label = weekLabel(start);

  // The heading has to say which week this actually is. Always writing "This
  // week" while you are looking at November is worse than saying nothing.
  const actions = el('div', { class: 'scene-actions' }, [
    iconLink('desk', 'Back to the desk', '#/'),
    iconButton('chevronLeft', 'The week before', {
      // There is nothing behind last week — it has been forgotten by design.
      disabled: start <= oldest,
      onClick: () => { location.hash = `#/plan?week=${addDays(start, -7)}`; },
    }),
    iconButton('chevronRight', 'The week after', {
      onClick: () => { location.hash = `#/plan?week=${addDays(start, 7)}`; },
    }),
  ]);

  if (start !== thisWeek) {
    actions.append(el('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: 'This week',
      onClick: () => { location.hash = '#/plan'; },
    }));
  }

  actions.append(iconButton('cart', 'Make a shopping list', {
    primary: true,
    onClick: () => shoppingList(dates),
  }));

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        label,
        el('small', {
          text: `${formatShort(dates[0])} – ${formatShort(dates[6])} · ${chefName(store.state.settings.profile)}`,
        }),
      ]),
      actions,
    ]),
  );

  const sheet = el('div', { class: 'sheet' });
  const grid = el('div', { class: 'plan-grid' });

  // Corner, then a column head per day.
  grid.append(el('div', { class: 'plan-corner' }));
  for (const date of dates) {
    grid.append(
      el('div', {
        class: `plan-day${date === todayISO() ? ' is-today' : ''}`,
      }, [
        el('span', { class: 'plan-dow', text: DAY_FULL[dayOfWeek(date)].slice(0, 3) }),
        el('span', { class: 'plan-date', text: formatShort(date) }),
      ]),
    );
  }

  for (const meal of MEALS) {
    grid.append(el('div', { class: 'plan-meal', text: meal.label }));
    for (const date of dates) grid.append(slot(date, meal.id));
  }

  sheet.append(grid);
  host.append(sheet);
  host.append(recipeDrawer());
}

/* --- a slot ---------------------------------------------------------------- */

function slot(date, meal) {
  const cell = el('div', {
    class: 'plan-slot',
    dataset: { date, meal },
  });

  for (const entry of store.plannedFor(date, meal)) {
    cell.append(planned(entry, date, meal));
  }

  cell.append(
    el('button', {
      class: 'plan-add',
      type: 'button',
      title: `Add to ${meal} on ${date}`,
      'aria-label': `Add something to ${meal} on ${date}`,
      text: '+',
      onClick: () => addToSlot(date, meal),
    }),
  );

  // Dropping a recipe dragged from the drawer, or moved from another slot.
  cell.addEventListener('dragover', (event) => {
    event.preventDefault();
    cell.classList.add('is-over');
  });
  cell.addEventListener('dragleave', () => cell.classList.remove('is-over'));
  cell.addEventListener('drop', (event) => {
    event.preventDefault();
    cell.classList.remove('is-over');
    const raw = event.dataTransfer?.getData('application/json');
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.from) store.moveInPlan(payload.from, { date, meal }, payload.id);
    else store.addToPlan(date, meal, { recipeId: payload.recipeId });
  });

  return cell;
}

function planned(entry, date, meal) {
  const recipe = entry.recipeId && store.recipeById(entry.recipeId);
  const label = recipe ? recipe.title : entry.text || 'Something';

  const node = el('div', {
    class: `plan-entry${recipe ? '' : ' is-note'}`,
    draggable: 'true',
    title: label,
  }, [
    recipe
      ? el('a', { class: 'plan-entry-name', href: `#/recipe/${recipe.id}`, text: label })
      : el('span', { class: 'plan-entry-name', text: label }),
    el('button', {
      class: 'plan-remove',
      type: 'button',
      text: '×',
      title: 'Take it off the plan',
      'aria-label': `Remove ${label}`,
      onClick: (event) => {
        event.preventDefault();
        store.removeFromPlan(date, meal, entry.id);
      },
    }),
  ]);

  node.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ id: entry.id, from: { date, meal } }),
    );
    event.dataTransfer.effectAllowed = 'move';
  });

  return node;
}

function addToSlot(date, meal) {
  const recipes = store.state.recipes;
  const note = el('input', { type: 'text', placeholder: 'Leftovers, or eating out' });

  const list = el('div', { class: 'pick-list' },
    sortRecipes(recipes, 'alpha').map((recipe) => {
      const book = store.bookById(recipe.bookId);
      return el('button', {
        class: 'pick-row',
        type: 'button',
        onClick: ({ close } = {}) => {
          store.addToPlan(date, meal, { recipeId: recipe.id });
          document.querySelector('.modal-backdrop')?.remove();
        },
      }, [
        el('span', { class: 'pick-name', text: recipe.title }),
        book && el('span', { class: 'pick-book', text: book.title }),
      ]);
    }),
  );

  modal({
    title: `${DAY_FULL[dayOfWeek(date)]} — ${meal}`,
    body: el('div', {}, [
      recipes.length
        ? list
        : el('p', { class: 'empty', text: 'No recipes yet to plan with.' }),
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'Or just write it down' }),
        note,
      ]),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add note',
        class: 'btn',
        onClick: () => {
          const text = note.value.trim();
          if (!text) {
            toast('Write something first, or pick a recipe.');
            return false;
          }
          store.addToPlan(date, meal, { text });
          return true;
        },
      },
    ],
  });
}

/* --- the drawer of recipes -------------------------------------------------- */

function recipeDrawer() {
  const recipes = store.state.recipes;
  if (!recipes.length) return el('p', { class: 'empty on-desk', text: 'Write a recipe first and it will appear here to plan with.' });

  const drawer = el('div', { class: 'plan-drawer' }, [
    el('span', { class: 'label', text: 'Drag onto the week' }),
    el('div', { class: 'drawer-rail' },
      sortRecipes(recipes, 'alpha').map((recipe) => {
        const chip = el('div', {
          class: 'drawer-chip',
          draggable: 'true',
          title: recipe.title,
          text: recipe.title,
        });
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('application/json', JSON.stringify({ recipeId: recipe.id }));
          event.dataTransfer.effectAllowed = 'copy';
        });
        return chip;
      }),
    ),
  ]);
  return drawer;
}

/* --- the shopping list ------------------------------------------------------ */

/* One screen before the file: the grouped list with everything ticked, so the
   cupboard can be taken into account before anything is downloaded. */
function shoppingList(dates) {
  const groups = buildList({ plan: store.state.plan, recipes: store.state.recipes, dates });

  if (!groups.length) {
    modal({
      title: 'Nothing to buy',
      body: el('p', { class: 'empty', text: 'Put some recipes on the week first.' }),
      actions: [{ label: 'Right' }],
    });
    return;
  }

  const skipped = new Set();
  const body = el('div', { class: 'list-review' },
    groups.map((group) =>
      el('section', {}, [
        el('h4', { class: 'label', text: group.label }),
        ...group.items.map((entry) => {
          const box = el('input', {
            type: 'checkbox',
            checked: true,
            onChange: (event) => {
              if (event.target.checked) skipped.delete(entry.item);
              else skipped.add(entry.item);
            },
          });
          const amount = formatAmount(entry);
          return el('label', { class: 'list-row' }, [
            box,
            el('span', { class: 'list-amount', text: amount }),
            el('span', { class: 'list-item', text: entry.label }),
            entry.from.length > 1
              && el('span', { class: 'list-from', text: `${entry.from.length} recipes` }),
          ]);
        }),
      ]),
    ),
  );

  modal({
    title: 'Shopping list',
    body: el('div', {}, [
      el('p', { class: 'settings-sub', text: 'Untick anything you already have. The list saves as a file you can tick off anywhere.' }),
      body,
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save the list',
        class: 'btn',
        onClick: () => {
          download(toMarkdown(groups, { dates, skipped }), listFilename(dates));
          toast('Shopping list saved.');
        },
      },
    ],
  });
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
