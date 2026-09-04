import { el, modal, toast, iconLink, iconButton, chefName } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { todayISO, startOfWeek, addDays, formatShort, weekLabel, DAY_FULL, dayOfWeek } from '../lib/dates.js';
import { MEALS, buildList, toMarkdown, listFilename } from '../lib/shopping.js';
import { weekStarts } from '../lib/plan.js';
import { formatAmount } from '../lib/units.js';
import { sortRecipes, parseIngredient, formatIngredient } from '../lib/recipe.js';
import { shareButton } from './share-week.js';

/* The planning sheet.

   A loose sheet on the desk rather than a page in any one book, because a
   week's meals are drawn from whichever cookbooks you like. Recipes are
   dragged onto it from a drawer of everything you own; anything that is not a
   recipe can be written straight in ("leftovers", "out"), and the ones that
   come round every week — a jam sandwich, the Tuesday takeaway — can be kept
   in the drawer beside the recipes rather than retyped.

   The list that comes off it is a file, not another screen — see shopping.js
   for why. */

export function renderPlan(host, query) {
  const asked = query?.get('week') || startOfWeek(todayISO(), 1);
  // A link to a week the sheet no longer covers lands on this week rather
  // than on a blank grid that cannot be navigated out of.
  const start = weekStarts().includes(asked) ? asked : startOfWeek(todayISO(), 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const thisWeek = startOfWeek(todayISO(), 1);
  const weeks = weekStarts();
  const label = weekLabel(start);

  // The heading has to say which week this actually is. Always writing "This
  // week" while you are looking at November is worse than saying nothing.
  const actions = el('div', { class: 'scene-actions' }, [
    iconLink('desk', 'Back to the desk', '#/'),
    // The sheet covers three weeks and stops. There is nothing behind last
    // week and nothing beyond next, so the arrows say so rather than paging
    // into empty weeks that would only be forgotten again.
    iconButton('chevronLeft', 'The week before', {
      disabled: start <= weeks[0],
      onClick: () => { location.hash = `#/plan?week=${addDays(start, -7)}`; },
    }),
    iconButton('chevronRight', 'The week after', {
      disabled: start >= weeks[weeks.length - 1],
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

  actions.append(shareButton());
  actions.append(iconButton('cart', 'Make a shopping list', {
    primary: true,
    onClick: () => shoppingList(dates),
  }));

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        label,
        el('small', {
          // Who the sheet belongs to. On a shared week that is not one person,
          // and it matters: anything written here is written for everybody.
          text: store.sharingWeek
            ? `${formatShort(dates[0])} – ${formatShort(dates[6])} · shared with `
              + `${Math.max(0, (store.shared.memberIds || []).length - 1)} other`
              + `${(store.shared.memberIds || []).length === 2 ? '' : 's'}`
            : `${formatShort(dates[0])} – ${formatShort(dates[6])} · ${chefName(store.state.settings.profile)}`,
        }),
      ]),
      actions,
    ]),
  );

  const sheet = el('div', { class: 'sheet' });
  const grid = el('div', { class: 'plan-grid' });

  /* Each cell carries its own day and meal as custom properties, and the
     stylesheet works out where to put it from those. That is what lets the
     whole grid transpose on a narrow screen — days down the side rather than
     across the top — without building the DOM twice. */
  grid.append(el('div', { class: 'plan-corner' }));

  dates.forEach((date, day) => {
    grid.append(
      el('div', {
        class: `plan-day${date === todayISO() ? ' is-today' : ''}`,
        style: `--day:${day}`,
      }, [
        el('span', { class: 'plan-dow', text: DAY_FULL[dayOfWeek(date)].slice(0, 3) }),
        el('span', { class: 'plan-date', text: formatShort(date) }),
      ]),
    );
  });

  MEALS.forEach((meal, mealIndex) => {
    grid.append(el('div', { class: 'plan-meal', style: `--meal:${mealIndex}`, text: meal.label }));
    dates.forEach((date, day) => {
      grid.append(slot(date, meal.id, day, mealIndex));
    });
  });

  sheet.append(grid);
  host.append(sheet);
  host.append(recipeDrawer());
}

/* --- a slot ---------------------------------------------------------------- */

function slot(date, meal, day, mealIndex) {
  const cell = el('div', {
    class: 'plan-slot',
    dataset: { date, meal },
    style: `--day:${day}; --meal:${mealIndex}`,
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
    else if (payload.standbyId) store.addToPlan(date, meal, { standbyId: payload.standbyId });
    else store.addToPlan(date, meal, { recipeId: payload.recipeId });
  });

  return cell;
}

function planned(entry, date, meal) {
  const recipe = entry.recipeId && store.recipeById(entry.recipeId);
  const standby = entry.standbyId && store.standbyById(entry.standbyId);
  const label = recipe ? recipe.title
    : standby ? standby.name
    : entry.text || entry.title || 'Something';

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
  const standbys = store.week.standbys || [];
  const note = el('input', { type: 'text', placeholder: 'Jam sandwich, or eating out' });
  const keep = el('input', { type: 'checkbox' });
  const onList = el('input', { type: 'checkbox', checked: true });

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
      standbys.length ? el('div', { class: 'pick-list pick-standbys' },
        standbys.map((standby) =>
          el('button', {
            class: 'pick-row',
            type: 'button',
            onClick: () => {
              store.addToPlan(date, meal, { standbyId: standby.id });
              document.querySelector('.modal-backdrop')?.remove();
            },
          }, [
            el('span', { class: 'pick-name', text: standby.name }),
            el('span', { class: 'pick-book', text: 'quick meal' }),
          ]),
        ),
      ) : null,
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'Or write a meal in' }),
        note,
        el('label', { class: 'check-line' }, [
          onList,
          el('span', { text: 'Put it on the shopping list' }),
        ]),
        el('label', { class: 'check-line' }, [
          keep,
          el('span', { text: 'Keep it for next time' }),
        ]),
        el('span', {
          class: 'settings-sub',
          text: 'Kept meals wait in the drawer to drop on any day, and can be '
            + 'given their ingredients later.',
        }),
      ]),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add',
        class: 'btn',
        onClick: async () => {
          const text = note.value.trim();
          if (!text) {
            toast('Write something first, or pick a recipe.');
            return false;
          }
          if (keep.checked) {
            const standby = await store.addStandby({ name: text, onList: onList.checked });
            store.addToPlan(date, meal, { standbyId: standby.id });
          } else {
            // Written in for one day only, so the choice rides on the entry
            // rather than on a meal in the drawer that will not exist.
            store.addToPlan(date, meal, { text, onList: onList.checked });
          }
          return true;
        },
      },
    ],
  });
}

/* --- quick meals ------------------------------------------------------------ */

/* Writing one down, or correcting one already written.

   Ingredients are optional and usually left empty — the point of a jam
   sandwich is that there is nothing to plan about it. Fill them in and it
   behaves like a recipe on the shopping list; leave them and the meal still
   reaches the foot of the list as a reminder. */
function quickMealDialog(existing) {
  const name = el('input', {
    type: 'text',
    placeholder: 'Jam sandwich',
    value: existing?.name || '',
  });
  const lines = el('textarea', {
    rows: '4',
    placeholder: '2 slices bread\n1 tbsp jam',
    text: (existing?.ingredients || []).map(formatIngredient).join('\n'),
  });
  const onList = el('input', {
    type: 'checkbox',
    checked: existing ? existing.onList !== false : true,
  });

  modal({
    title: existing ? 'Edit a quick meal' : 'A meal of your own',
    body: el('div', {}, [
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'What it is' }),
        name,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'Ingredients, if it needs any' }),
        lines,
        el('span', {
          class: 'settings-sub',
          text: 'One per line. Leave it empty and the meal still reaches the '
            + 'foot of the shopping list, so you remember to check.',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'check-line' }, [
          onList,
          el('span', { text: 'Put it on the shopping list' }),
        ]),
        el('span', {
          class: 'settings-sub',
          text: 'Untick for a meal there is nothing to buy for — eating out, '
            + 'or a takeaway. It still goes on the week; it just stays off '
            + 'the list.',
        }),
      ]),
    ]),
    actions: [
      { label: 'Cancel' },
      existing && {
        label: 'Remove',
        onClick: () => {
          store.removeStandby(existing.id);
          toast('Taken out of the drawer.');
        },
      },
      {
        label: existing ? 'Save' : 'Keep it',
        class: 'btn',
        onClick: () => {
          const title = name.value.trim();
          if (!title) {
            toast('Give it a name first.');
            return false;
          }
          const ingredients = lines.value
            .split('\n')
            .map((line) => parseIngredient(line))
            .filter(Boolean);

          const patch = { name: title, ingredients, onList: onList.checked };
          if (existing) store.updateStandby(existing.id, patch);
          else store.addStandby(patch);
          return true;
        },
      },
    ].filter(Boolean),
  });
}

/* --- the drawer of recipes -------------------------------------------------- */

function recipeDrawer() {
  const recipes = store.state.recipes;
  const standbys = store.week.standbys || [];

  /* Both rails hold the same kind of thing — something to drop on a day — so
     they drag identically. Only the payload differs. */
  const chip = (label, payload, extra = {}) => {
    const node = el('div', {
      class: 'drawer-chip',
      draggable: 'true',
      title: label,
      text: label,
      ...extra,
    });
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/json', JSON.stringify(payload));
      event.dataTransfer.effectAllowed = 'copy';
    });
    return node;
  };

  return el('div', { class: 'plan-drawer' }, [
    el('span', { class: 'label', text: 'Drag onto the week' }),
    recipes.length
      ? el('div', { class: 'drawer-rail' },
        sortRecipes(recipes, 'alpha').map((recipe) =>
          chip(recipe.title, { recipeId: recipe.id })),
      )
      : el('p', { class: 'empty on-desk', text: 'Write a recipe and it will appear here to plan with.' }),

    el('div', { class: 'drawer-rail drawer-quick' }, [
      ...standbys.map((standby) =>
        // Dragging plans it; clicking opens it, which is the only way to give
        // it ingredients after the fact. A plain click never starts a native
        // drag, so the two gestures do not fight.
        chip(standby.name, { standbyId: standby.id }, {
          class: 'drawer-chip is-quick',
          title: `${standby.name} — drag onto a day, or click to change it`,
          onClick: () => quickMealDialog(standby),
        }),
      ),
      el('button', {
        class: 'drawer-new',
        type: 'button',
        text: '+ A meal of your own',
        title: 'Something that is not in a cookbook',
        onClick: () => quickMealDialog(),
      }),
    ]),
  ]);
}

/* --- the shopping list ------------------------------------------------------ */

/* One screen before the file: the grouped list with everything ticked, so the
   cupboard can be taken into account before anything is downloaded. */
function shoppingList(dates) {
  const { groups, extras } = buildList({
    plan: store.week.plan,
    recipes: store.state.recipes,
    standbys: store.week.standbys,
    dates,
  });

  if (!groups.length && !extras.length) {
    modal({
      title: 'Nothing to buy',
      body: el('p', { class: 'empty', text: 'Put some meals on the week first.' }),
      actions: [{ label: 'Right' }],
    });
    return;
  }

  const skipped = new Set();
  const skippedExtras = new Set();
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

  /* The meals with nothing to buy for them. They are not shopping, so they sit
     apart at the foot — but they are tickable like everything else, because
     "we are eating out on Thursday" is exactly the sort of thing you want to
     take off the list you carry to the shop. */
  if (extras.length) {
    body.append(
      el('section', { class: 'list-extras' }, [
        el('h4', { class: 'label', text: 'Also on the week' }),
        ...extras.map((extra) =>
          el('label', { class: 'list-row' }, [
            el('input', {
              type: 'checkbox',
              checked: true,
              onChange: (event) => {
                if (event.target.checked) skippedExtras.delete(extra.name);
                else skippedExtras.add(extra.name);
              },
            }),
            el('span', { class: 'list-amount', text: extra.count > 1 ? `+ ${extra.count}` : '+' }),
            el('span', { class: 'list-item', text: extra.name }),
          ]),
        ),
      ]),
    );
  }

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
          download(
            toMarkdown(groups, { dates, skipped, extras, skippedExtras }),
            listFilename(dates),
          );
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
