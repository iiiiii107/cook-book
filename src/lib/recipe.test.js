import { describe, it, expect } from 'vitest';
import {
  parseIngredient,
  formatIngredient,
  formatQty,
  scaleIngredients,
  sortRecipes,
  totalTime,
} from './recipe.js';

describe('parseIngredient', () => {
  it('splits quantity, unit, item and preparation note', () => {
    expect(parseIngredient('200 g plain flour, sifted')).toMatchObject({
      qty: 200, unit: 'g', item: 'plain flour', note: 'sifted',
    });
  });

  it('reads mixed numbers, written and vulgar', () => {
    expect(parseIngredient('1 1/2 cups milk')).toMatchObject({ qty: 1.5, unit: 'cup' });
    expect(parseIngredient('1½ tbsp olive oil')).toMatchObject({ qty: 1.5, unit: 'tbsp' });
    expect(parseIngredient('½ lemon')).toMatchObject({ qty: 0.5, unit: '', item: 'lemon' });
  });

  it('keeps both ends of a range', () => {
    expect(parseIngredient('1-2 tbsp honey')).toMatchObject({ qty: 1, qtyMax: 2, unit: 'tbsp' });
  });

  it('leaves an unquantified line alone rather than inventing a number', () => {
    expect(parseIngredient('salt to taste')).toMatchObject({
      qty: null, unit: '', item: 'salt to taste',
    });
  });

  it('does not need a space between number and unit', () => {
    expect(parseIngredient('100ml double cream')).toMatchObject({ qty: 100, unit: 'ml' });
  });

  it('only treats a word as a unit when a quantity introduced it', () => {
    // "large" is not a unit, so it stays part of the item.
    expect(parseIngredient('3 large eggs')).toMatchObject({ qty: 3, unit: '', item: 'large eggs' });
  });

  it('accepts a decimal comma', () => {
    expect(parseIngredient('0,5 kg potatoes')).toMatchObject({ qty: 0.5, unit: 'kg' });
  });

  it('returns null for an empty line', () => {
    expect(parseIngredient('   ')).toBeNull();
  });

  it('knows the countables European recipes actually use', () => {
    // Found by running a real screenshot through the model: "3 sheets of
    // gelatine" was parsing as a bare 3 with "sheets of gelatine" as the item.
    expect(parseIngredient('3 sheets of gelatine')).toMatchObject({
      qty: 3, unit: 'sheet', item: 'gelatine',
    });
    expect(parseIngredient('2 heads of broccoli')).toMatchObject({ qty: 2, unit: 'head' });
    expect(parseIngredient('4 rashers of bacon')).toMatchObject({ qty: 4, unit: 'rasher' });
    expect(parseIngredient('1 knob of butter')).toMatchObject({ qty: 1, unit: 'knob' });
  });
});

describe('formatQty', () => {
  it('writes fractions for cooking units', () => {
    expect(formatQty(0.5, 'cup')).toBe('½');
    expect(formatQty(1.5, 'cup')).toBe('1½');
    expect(formatQty(2.75, 'tbsp')).toBe('2¾');
  });

  it('writes decimals for metric, because nobody says half a kilo as ½ kg', () => {
    expect(formatQty(0.5, 'kg')).toBe('0.5');
    expect(formatQty(250, 'g')).toBe('250');
  });
});

describe('formatIngredient', () => {
  const round = (line) => formatIngredient(parseIngredient(line));

  it('round-trips a typed line back to something a cook would write', () => {
    expect(round('200 g plain flour, sifted')).toBe('200 g plain flour, sifted');
    expect(round('100ml double cream')).toBe('100 ml double cream');
    expect(round('salt to taste')).toBe('salt to taste');
  });

  it('pluralises counted units', () => {
    expect(round('1 1/2 cups milk')).toBe('1½ cups milk');
    expect(round('2 cloves garlic, finely chopped')).toBe('2 cloves garlic, finely chopped');
    expect(round('1 can chopped tomatoes')).toBe('1 can chopped tomatoes');
  });

  it('shows a range as a range', () => {
    expect(round('1-2 tbsp honey')).toBe('1–2 tbsp honey');
  });
});

describe('scaleIngredients', () => {
  it('scales quantities and leaves unquantified lines untouched', () => {
    const list = [parseIngredient('200 g flour'), parseIngredient('salt to taste')];
    const [flour, salt] = scaleIngredients(list, 2);
    expect(flour.qty).toBe(400);
    expect(salt.qty).toBeNull();
  });

  it('carries the upper end of a range', () => {
    const [honey] = scaleIngredients([parseIngredient('1-2 tbsp honey')], 3);
    expect(honey).toMatchObject({ qty: 3, qtyMax: 6 });
  });
});

describe('sortRecipes', () => {
  const recipes = [
    { title: 'Zabaione', createdAt: '2026-01-01', time: { prep: 5, cook: 10 } },
    { title: 'Amatriciana', createdAt: '2026-03-01', time: { prep: 10, cook: 30 } },
    { title: 'Melanzane', createdAt: '2026-02-01', time: { prep: 20, cook: 40 } },
  ];

  it('defaults to date added, oldest first', () => {
    expect(sortRecipes(recipes).map((r) => r.title)).toEqual(
      ['Zabaione', 'Melanzane', 'Amatriciana'],
    );
  });

  it('sorts alphabetically', () => {
    expect(sortRecipes(recipes, 'alpha').map((r) => r.title)).toEqual(
      ['Amatriciana', 'Melanzane', 'Zabaione'],
    );
  });

  it('sorts by total time, quickest first', () => {
    expect(sortRecipes(recipes, 'time').map((r) => r.title)).toEqual(
      ['Zabaione', 'Amatriciana', 'Melanzane'],
    );
  });

  it('does not mutate the list it was given', () => {
    const before = recipes.map((r) => r.title);
    sortRecipes(recipes, 'alpha');
    expect(recipes.map((r) => r.title)).toEqual(before);
  });
});

describe('totalTime', () => {
  it('adds prep and cook, and copes with a recipe that has neither', () => {
    expect(totalTime({ time: { prep: 10, cook: 25 } })).toBe(35);
    expect(totalTime({})).toBe(0);
  });
});
