/* @vitest-environment jsdom */

/* Which week an edit lands on.

   Everything the planning sheet does goes through the store, and the store has
   to send it either to your own plan or to the one being shared. Getting that
   wrong is quiet and nasty in both directions: a shared Tuesday written only
   to your own device, or — worse — your private week overwritten by a sheet
   you joined. So these tests check the destination, not the result. */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const saved = [];
vi.mock('./share.js', () => ({
  saveShare: async (id, payload) => { saved.push({ id, payload }); },
  createShare: async () => 'new-share',
  joinShare: async () => {},
  leaveShare: async () => {},
  watchShare: () => () => {},
}));

const { store } = await import('./store.js');

const ownPlan = () => ({ '2026-08-31': { lunch: [{ id: 'mine', text: 'My own lunch' }] } });

beforeEach(() => {
  saved.length = 0;
  store.shared = null;
  store.state = {
    books: [], recipes: [], settings: {},
    plan: ownPlan(),
    standbys: [{ id: 's1', name: 'Jam sandwich', ingredients: [], onList: true }],
  };
  store.persist = async () => {};
});

const shareOn = () => {
  store.shared = { id: 'share-1', plan: {}, standbys: [], memberIds: ['a', 'b'] };
};

describe('a week you are sharing', () => {
  it('takes the edits, and leaves your own week alone', async () => {
    shareOn();
    await store.addToPlan('2026-09-01', 'dinner', { text: 'Ragù' });

    expect(store.shared.plan['2026-09-01'].dinner[0].text).toBe('Ragù');
    expect(store.state.plan).toEqual(ownPlan());
    expect(saved.at(-1).id).toBe('share-1');
  });

  it('gives your own week back untouched when you leave', async () => {
    shareOn();
    await store.addToPlan('2026-09-01', 'dinner', { text: 'Ragù' });
    await store.leaveWeekShare();

    expect(store.sharingWeek).toBe(false);
    expect(store.plannedFor('2026-08-31', 'lunch')[0].text).toBe('My own lunch');
    expect(store.plannedFor('2026-09-01', 'dinner')).toEqual([]);
  });

  it('reads from the shared sheet while it is on', () => {
    shareOn();
    store.shared.plan = { '2026-09-02': { lunch: [{ id: 'x', text: 'Theirs' }] } };

    expect(store.plannedFor('2026-09-02', 'lunch')[0].text).toBe('Theirs');
    // Your own Monday is not on this sheet, and must not leak onto it.
    expect(store.plannedFor('2026-08-31', 'lunch')).toEqual([]);
  });

  it('shares the quick meals too, or their Tuesday would say nothing', async () => {
    shareOn();
    await store.addStandby({ name: 'Toastie' });

    expect(store.shared.standbys.map((s) => s.name)).toEqual(['Toastie']);
    // Yours are untouched and still yours.
    expect(store.state.standbys.map((s) => s.name)).toEqual(['Jam sandwich']);
    expect(saved.at(-1).payload.standbys).toHaveLength(1);
  });

  it('writes nothing to the cloud when you are not sharing', async () => {
    await store.addToPlan('2026-09-01', 'dinner', { text: 'Ragù' });
    expect(saved).toEqual([]);
    expect(store.state.plan['2026-09-01'].dinner[0].text).toBe('Ragù');
  });
});

describe('a recipe planned onto a shared week', () => {
  it('carries its name, for people who do not have the cookbook', async () => {
    store.state.recipes = [{ id: 'r1', title: 'Ragù', ingredients: [] }];
    shareOn();
    await store.addToPlan('2026-09-01', 'dinner', { recipeId: 'r1' });

    const entry = store.shared.plan['2026-09-01'].dinner[0];
    expect(entry.recipeId).toBe('r1');
    // The id still does the work for anyone who has it; the name is only
    // there to be read when it cannot.
    expect(entry.title).toBe('Ragù');
  });
});
