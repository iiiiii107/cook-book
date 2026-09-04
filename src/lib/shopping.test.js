/* Three kinds of thing can sit on a day, and the list has to treat them
   differently: a recipe and a quick meal with its ingredients filled in are
   shopping, while a jam sandwich is a reminder. The reminder is the part worth
   testing — it is easy to write a list that silently drops everything it
   cannot price, which is exactly how you get to Tuesday with no bread. */

import { describe, it, expect } from 'vitest';
import { buildList, toMarkdown } from './shopping.js';

const ing = (qty, unit, item) => ({ qty, unit, item });

const recipes = [
  { id: 'r1', title: 'Porridge', servings: 2, ingredients: [ing(80, 'g', 'oats'), ing(300, 'ml', 'milk')] },
  { id: 'r2', title: 'Boiled egg', servings: 1, ingredients: [] },
];

const standbys = [
  { id: 's1', name: 'Jam sandwich', ingredients: [] },
  { id: 's2', name: 'Cheese toastie', ingredients: [ing(2, 'slices', 'bread'), ing(40, 'g', 'cheese')] },
  { id: 's3', name: 'Eating out', ingredients: [], onList: false },
  // Ingredients and off the list at once: the flag has to win, or ticking the
  // box would only ever hide the reminder and still send you shopping.
  { id: 's4', name: 'Chip shop', ingredients: [ing(1, '', 'batter')], onList: false },
];

const dates = ['2026-08-31', '2026-09-01', '2026-09-02'];

const planOf = (...days) =>
  Object.fromEntries(days.map((entries, i) => [dates[i], { lunch: entries }]));

const list = (plan) => buildList({ plan, recipes, standbys, dates });

describe('a week turned into a shopping list', () => {
  it('buys for a quick meal that has its ingredients filled in', () => {
    const { groups, extras } = list(planOf([{ id: 'a', standbyId: 's2' }]));
    const items = groups.flatMap((g) => g.items).map((i) => i.label);
    expect(items).toContain('bread');
    expect(items).toContain('cheese');
    expect(extras).toEqual([]);
  });

  it('carries a meal with nothing to buy to the foot, rather than dropping it', () => {
    const { groups, extras } = list(planOf([{ id: 'a', standbyId: 's1' }]));
    expect(groups).toEqual([]);
    expect(extras).toEqual([{ name: 'Jam sandwich', count: 1 }]);
  });

  it('counts a repeat rather than listing it again', () => {
    const { extras } = list(
      planOf(
        [{ id: 'a', standbyId: 's1' }],
        [{ id: 'b', standbyId: 's1' }],
        [{ id: 'c', standbyId: 's1' }],
      ),
    );
    expect(extras).toEqual([{ name: 'Jam sandwich', count: 3 }]);
  });

  it('treats a meal written straight in the same as a kept one', () => {
    const { extras } = list(planOf([{ id: 'a', text: 'Eating out' }]));
    expect(extras).toEqual([{ name: 'Eating out', count: 1 }]);
  });

  // A recipe with an empty ingredient list is the same situation arriving by a
  // different door, and it would be strange for it to behave differently.
  it('does the same for a recipe nobody wrote ingredients into', () => {
    const { extras } = list(planOf([{ id: 'a', recipeId: 'r2' }]));
    expect(extras).toEqual([{ name: 'Boiled egg', count: 1 }]);
  });

  it('still scales a recipe cooked for a different number of people', () => {
    const { groups } = list(planOf([{ id: 'a', recipeId: 'r1', servings: 4 }]));
    // Merged amounts are kept in the family's base unit, not as typed.
    const oats = groups.flatMap((g) => g.items).find((i) => i.label === 'oats');
    expect(oats.amounts[0].base).toBe(160);
  });

  it('leaves out a meal there is nothing to buy for, entirely', () => {
    const { groups, extras } = list(planOf([{ id: 'a', standbyId: 's3' }]));
    expect(groups).toEqual([]);
    // Not even as a reminder — eating out is planned, not shopped for.
    expect(extras).toEqual([]);
  });

  it('drops its ingredients too, not just its name', () => {
    const { groups, extras } = list(planOf([{ id: 'a', standbyId: 's4' }]));
    expect(groups).toEqual([]);
    expect(extras).toEqual([]);
  });

  it('carries the flag onto a meal written straight into the day', () => {
    // Which is what a deleted quick meal turns into, so it must not reappear
    // on the shopping list on its way out of the drawer.
    const { extras } = list(planOf([{ id: 'a', text: 'Eating out', onList: false }]));
    expect(extras).toEqual([]);
  });

  it('ignores a day outside the week being shopped for', () => {
    const plan = { '2026-07-01': { lunch: [{ id: 'a', standbyId: 's1' }] } };
    expect(buildList({ plan, recipes, standbys, dates }).extras).toEqual([]);
  });
});

describe('the list as a file', () => {
  it('puts the reminders at the end, counted, and named as they were typed', () => {
    const md = toMarkdown([], {
      extras: [{ name: 'Jam sandwich', count: 2 }, { name: 'Eating out', count: 1 }],
    });
    expect(md).toContain('## Also on the week');
    expect(md).toContain('- [ ] + 2 Jam sandwich');
    // No count for a single one, and no pluralising of somebody's own words.
    expect(md).toContain('- [ ] + Eating out');
  });

  it('leaves out a reminder that was unticked in the review', () => {
    const md = toMarkdown([], {
      extras: [{ name: 'Jam sandwich', count: 2 }, { name: 'Eating out', count: 1 }],
      skippedExtras: new Set(['Eating out']),
    });
    expect(md).toContain('Jam sandwich');
    expect(md).not.toContain('Eating out');
  });

  it('keeps the two sets of ticks apart', () => {
    // Unticking a bag of bread must not also untick a meal called Bread.
    const groups = [{ id: 'dry', label: 'Dry goods', items: [{ item: 'bread', label: 'bread', amounts: [] }] }];
    const md = toMarkdown(groups, {
      extras: [{ name: 'bread', count: 1 }],
      skipped: new Set(['bread']),
    });
    expect(md).not.toContain('- [ ] bread');
    expect(md).toContain('- [ ] + bread');
  });

  it('writes no heading at all when there is nothing to remind you of', () => {
    expect(toMarkdown([], { extras: [] })).not.toContain('Also on the week');
  });
});
