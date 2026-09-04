/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';

/* Deleting a quick meal is a tidy-up of the drawer, not an edit to the weeks
   it is already sitting on. The trap is the obvious implementation: drop the
   standby, and every day that referred to it silently empties. */
describe('taking a quick meal out of the drawer', () => {
  it('leaves the days it was planned on holding its name', async () => {
    const { store } = await import('./store.js');

    store.state = {
      books: [], recipes: [], settings: {},
      standbys: [{ id: 's1', name: 'Jam sandwich', ingredients: [] }],
      plan: {
        '2026-08-31': { lunch: [{ id: 'a', standbyId: 's1' }] },
        '2026-09-01': { lunch: [{ id: 'b', text: 'Eating out' }] },
      },
    };
    store.persist = async () => {};

    await store.removeStandby('s1');

    expect(store.state.standbys).toEqual([]);
    const monday = store.state.plan['2026-08-31'].lunch[0];
    expect(monday.standbyId).toBeUndefined();
    expect(monday.text).toBe('Jam sandwich');
    // Everything else is left exactly alone.
    expect(store.state.plan['2026-09-01'].lunch[0].text).toBe('Eating out');
  });

  it('keeps the ingredients it had, so the list does not quietly change', async () => {
    const { store } = await import('./store.js');
    const ingredients = [{ qty: 2, unit: 'slices', item: 'bread' }];

    store.state = {
      books: [], recipes: [], settings: {},
      standbys: [{ id: 's2', name: 'Toastie', ingredients }],
      plan: { '2026-08-31': { lunch: [{ id: 'a', standbyId: 's2' }] } },
    };
    store.persist = async () => {};

    await store.removeStandby('s2');
    expect(store.state.plan['2026-08-31'].lunch[0].ingredients).toEqual(ingredients);
  });
});
