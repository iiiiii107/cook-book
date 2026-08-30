/* @vitest-environment jsdom */

/* Every button on every screen, clicked.
 *
 * The unit tests cover the logic well and caught none of the bugs that
 * actually reached the kitchen: a Done button that threw a ReferenceError and
 * did nothing, an import that saved a recipe with no ingredients. Both were one
 * click away from being obvious.
 *
 * So this renders each screen for real and clicks everything on it, failing on
 * any exception. It is deliberately not fussy about what a click *does* — that
 * is what the other tests are for. It only insists that nothing is dead. */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

/* --- the handful of browser things the views expect ----------------------- */

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });

  // jsdom lays nothing out, so the pagination engine would divide by zero.
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 };
  };
  Object.defineProperty(Element.prototype, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(Element.prototype, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(Element.prototype, 'scrollWidth', { value: 1600, configurable: true });

  Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, pause() {}, play() {} });
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  document.fonts = { ready: Promise.resolve() };

  global.indexedDB = { open: () => ({ addEventListener() {}, result: null }) };
  window.confirm = () => false;
  window.alert = () => {};
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  navigator.clipboard = { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') };
  // Never open a real file dialog.
  HTMLInputElement.prototype.click = function click() {};
});

/* --- a desk with something on it ------------------------------------------ */

async function seed() {
  const { store } = await import('../lib/store.js');
  const { parseIngredient } = await import('../lib/recipe.js');

  await store.init();
  store.state.books = [];
  store.state.recipes = [];
  store.state.plan = {};

  const book = store.addBook({ title: 'Pasta', subtitle: 'The good ones' });
  const make = (title, ings, steps) => store.addRecipe({
    bookId: book.id,
    title,
    servings: 4,
    time: { prep: 10, cook: 20 },
    ingredients: ings.map(parseIngredient),
    steps: steps.map((text, i) => ({ id: `s${i}`, text })),
    notes: 'A note.',
  });

  const one = make('Carbonara', ['400 g spaghetti', '4 eggs'],
    ['Boil the water for 10 minutes.', 'Toss off the heat.']);
  make('Amatriciana', ['400 g bucatini', '1 can tomatoes'], ['Render.', 'Simmer.']);

  const today = new Date().toISOString().slice(0, 10);
  store.addToPlan(today, 'dinner', { recipeId: one.id });

  return { store, book, recipe: one };
}

/* An exception inside a click handler does not come back out of .click() —
   the browser reports it to window.onerror and carries on. Catching around
   the call therefore catches nothing, which is exactly how a Done button that
   threw every time still looked fine to an earlier version of this test. */
let handlerErrors = [];

beforeAll(() => {
  window.addEventListener('error', (event) => {
    handlerErrors.push(event.error?.message || event.message);
  });
});

/** Click everything clickable, re-querying after each one. */
async function clickEverything(host) {
  const seen = new Set();
  let clicks = 0;

  for (let pass = 0; pass < 60; pass += 1) {
    const next = [...host.querySelectorAll('button')].find((b) => {
      const key = b.title || b.getAttribute('aria-label') || b.textContent.trim();
      // Nothing that tears the whole thing down mid-sweep.
      if (!key || seen.has(key) || b.disabled) return false;
      return !/Delete|Restore|Sign out/i.test(key);
    });
    if (!next) break;

    seen.add(next.title || next.getAttribute('aria-label') || next.textContent.trim());
    // jsdom rethrows listener exceptions as window error events, caught above.
    next.click();
    clicks += 1;
    await Promise.resolve();
    // A dialog opened by one click must not swallow the next.
    document.querySelector('.modal-backdrop')?.remove();
  }
  return clicks;
}

let host;

/* Views watch for their own node leaving the page and clean up when it does.
   Emptying the body here lets that happen while there is still a document to
   do it in — otherwise the callbacks fire during teardown and jsdom has gone. */
afterEach(async () => {
  document.body.replaceChildren();
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  handlerErrors = [];
  document.body.replaceChildren();
  delete document.body.dataset.editing;
  delete document.body.dataset.cooking;
  host = document.createElement('main');
  document.body.append(host);
});

describe('every screen renders and every button survives a click', () => {
  const screens = [
    ['the desk', async () => (await import('./desk.js')).renderDesk],
    ['a cookbook', async () => (await import('./book.js')).renderBook],
    ['a recipe', async () => (await import('./recipe.js')).renderRecipe],
    ['cook mode', async () => (await import('./cook.js')).renderCook],
    ['the planner', async () => (await import('./plan.js')).renderPlan],
    ['import', async () => (await import('./import.js')).renderImport],
    ['settings', async () => (await import('./settings.js')).renderSettings],
  ];

  for (const [name, load] of screens) {
    it(`${name}: renders, and nothing on it is dead`, async () => {
      const { book, recipe } = await seed();
      const render = await load();

      const args = {
        'the desk': [host],
        'a cookbook': [host, book.id, new URLSearchParams()],
        'a recipe': [host, recipe.id, new URLSearchParams()],
        'cook mode': [host, recipe.id],
        'the planner': [host, new URLSearchParams()],
        import: [host, new URLSearchParams()],
        settings: [host],
      }[name];

      expect(() => render(...args)).not.toThrow();
      expect(host.childElementCount).toBeGreaterThan(0);

      const clicks = await clickEverything(host);
      expect(clicks).toBeGreaterThan(0);
      expect(handlerErrors).toEqual([]);
    });
  }

  it('editing and customising a recipe both render', async () => {
    const { recipe } = await seed();
    const { renderRecipe } = await import('./recipe.js');

    for (const mode of ['edit', 'deco']) {
      document.body.replaceChildren();
      delete document.body.dataset.editing;
      host = document.createElement('main');
      document.body.append(host);

      expect(() => renderRecipe(host, recipe.id, new URLSearchParams(`${mode}=1`))).not.toThrow();
      expect(await clickEverything(host)).toBeGreaterThan(0);
      expect(handlerErrors, `a button on the ${mode} screen threw`).toEqual([]);
    }
  });
});
