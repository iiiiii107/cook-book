import { describe, it, expect } from 'vitest';
import { recipeToMarkdown, bookToMarkdown, parseMarkdown, shareFilename } from './md.js';
import { parseIngredient, newRecipe } from './recipe.js';

const carbonara = () => ({
  ...newRecipe({ bookId: 'b1', title: 'Carbonara' }),
  servings: 4,
  time: { prep: 10, cook: 15 },
  sourceUrl: 'https://example.com/carbonara',
  sourceLabel: 'Nonna',
  ingredients: ['400 g spaghetti', '150 g guanciale', 'salt to taste'].map(parseIngredient),
  steps: [
    { id: 's1', text: 'Boil the water.' },
    { id: 's2', text: 'Render the guanciale for 8 minutes.' },
  ],
  notes: 'Off the heat.\n\nGuanciale, not pancetta.',
});

describe('recipeToMarkdown', () => {
  it('writes something a person could read without this app', () => {
    const md = recipeToMarkdown(carbonara());
    expect(md).toContain('# Carbonara');
    expect(md).toContain('- Portions: 4');
    expect(md).toContain('## Ingredients');
    expect(md).toContain('- 400 g spaghetti');
    expect(md).toContain('## Method');
    expect(md).toContain('1. Boil the water.');
    expect(md).toContain('## Notes');
  });
});

describe('round trip', () => {
  it('brings a recipe back the way it went in', () => {
    const before = carbonara();
    const { recipes } = parseMarkdown(recipeToMarkdown(before), { bookId: 'b2' });
    expect(recipes).toHaveLength(1);

    const after = recipes[0];
    expect(after.title).toBe('Carbonara');
    expect(after.servings).toBe(4);
    expect(after.time).toEqual({ prep: 10, cook: 15 });
    expect(after.sourceUrl).toBe('https://example.com/carbonara');
    expect(after.sourceLabel).toBe('Nonna');
    expect(after.notes).toBe('Off the heat.\n\nGuanciale, not pancetta.');
    expect(after.bookId).toBe('b2');
  });

  it('keeps ingredients parsed, not as text', () => {
    const { recipes } = parseMarkdown(recipeToMarkdown(carbonara()));
    expect(recipes[0].ingredients.map((i) => [i.qty, i.unit, i.item])).toEqual([
      [400, 'g', 'spaghetti'],
      [150, 'g', 'guanciale'],
      [null, '', 'salt to taste'],
    ]);
  });

  it('keeps the method in order', () => {
    const { recipes } = parseMarkdown(recipeToMarkdown(carbonara()));
    expect(recipes[0].steps.map((s) => s.text)).toEqual([
      'Boil the water.',
      'Render the guanciale for 8 minutes.',
    ]);
  });

  it('carries a whole cookbook, and names it', () => {
    const md = bookToMarkdown(
      { title: 'Pasta', subtitle: 'The ones worth repeating' },
      [carbonara(), { ...carbonara(), title: 'Amatriciana' }],
    );
    const { book, recipes } = parseMarkdown(md);
    expect(book).toEqual({ title: 'Pasta', subtitle: 'The ones worth repeating' });
    expect(recipes.map((r) => r.title)).toEqual(['Carbonara', 'Amatriciana']);
  });
});

describe('parseMarkdown', () => {
  it('reads a file someone wrote by hand', () => {
    const { recipes } = parseMarkdown(`
# Beans on toast

- Serves: 2

## Ingredients

* 1 tin baked beans
* 2 slices bread

## Instructions

1. Toast the bread.
2. Heat the beans.
`);
    expect(recipes[0].title).toBe('Beans on toast');
    expect(recipes[0].servings).toBe(2);
    expect(recipes[0].ingredients).toHaveLength(2);
    expect(recipes[0].steps).toHaveLength(2);
  });

  it('accepts a bare list with no metadata at all', () => {
    const { book, recipes } = parseMarkdown('# Toast\n\n## Ingredients\n\n- bread\n');
    expect(book).toBeNull();
    expect(recipes[0].title).toBe('Toast');
    expect(recipes[0].ingredients[0].item).toBe('bread');
  });

  it('returns nothing rather than throwing on rubbish', () => {
    expect(parseMarkdown('').recipes).toEqual([]);
    expect(parseMarkdown(null).recipes).toEqual([]);
    expect(parseMarkdown('just some prose, no headings').recipes).toEqual([]);
  });

  it('ignores a section it does not recognise', () => {
    const { recipes } = parseMarkdown('# X\n\n## Wine pairing\n\n- Barolo\n\n## Ingredients\n\n- salt\n');
    expect(recipes[0].ingredients.map((i) => i.item)).toEqual(['salt']);
  });
});

describe('the shapes a real .md recipe turns up in', () => {
  /* Every one of these imported its title and nothing else before, because the
     parser only accepted the exact headings this app happens to write. A file
     that half-imports is worse than one that is refused: it looks like it
     worked. */
  const read = (text) => {
    const { recipes } = parseMarkdown(text);
    return { ingredients: recipes[0]?.ingredients.length, steps: recipes[0]?.steps.length };
  };

  it('takes headings at any level', () => {
    expect(read('# X\n\n### Ingredients\n\n- salt\n\n### Method\n\n1. Cook.\n'))
      .toEqual({ ingredients: 1, steps: 1 });
  });

  it('takes bold headings', () => {
    expect(read('# X\n\n**Ingredients**\n\n- salt\n\n**Method**\n\n1. Cook.\n'))
      .toEqual({ ingredients: 1, steps: 1 });
  });

  it('takes a plain label ending in a colon', () => {
    expect(read('# X\n\nIngredients:\n- salt\n\nMethod:\n1. Cook.\n'))
      .toEqual({ ingredients: 1, steps: 1 });
  });

  it('takes the other words people use for the method', () => {
    for (const word of ['Directions', 'Steps', 'Instructions', 'Preparation']) {
      expect(read(`# X\n\n## Ingredients\n\n- salt\n\n## ${word}\n\n1. Cook.\n`))
        .toEqual({ ingredients: 1, steps: 1 });
    }
  });

  it('takes the other words people use for the ingredients', () => {
    for (const phrase of ['You will need', 'What you need', 'Shopping list']) {
      expect(read(`# X\n\n## ${phrase}\n\n- salt\n\n## Method\n\n1. Cook.\n`))
        .toEqual({ ingredients: 1, steps: 1 });
    }
  });

  it('works out a recipe with no headings at all from the shape of the lines', () => {
    // Bullets are things you need; numbers are things you do.
    expect(read('# X\n\n- 400 g spaghetti\n- 150 g guanciale\n\n1. Boil.\n2. Cook.\n'))
      .toEqual({ ingredients: 2, steps: 2 });
  });

  it('reads a file with no title heading either', () => {
    const { recipes } = parseMarkdown('- 400 g spaghetti\n\n1. Boil it.\n', { fallbackTitle: 'Supper' });
    expect(recipes[0]).toMatchObject({ title: 'Supper' });
    expect(recipes[0].ingredients).toHaveLength(1);
    expect(recipes[0].steps).toHaveLength(1);
  });

  it('reads metadata written as a bare line rather than a bullet', () => {
    const { recipes } = parseMarkdown('# X\n\nServes 6\nPrep 20 min\n\n## Ingredients\n\n- salt\n');
    expect(recipes[0].servings).toBe(6);
    expect(recipes[0].time.prep).toBe(20);
  });

  it('does not mistake a numbered step for metadata', () => {
    const { recipes } = parseMarkdown('# X\n\n## Method\n\n1. Cook the pasta for 10 minutes.\n');
    expect(recipes[0].steps[0].text).toBe('Cook the pasta for 10 minutes.');
  });
});

describe('shareFilename', () => {
  it('makes a name a filesystem is happy with', () => {
    expect(shareFilename('Carbonara')).toBe('carbonara.md');
    expect(shareFilename('Nonna’s Ragù (Sunday)')).toBe('nonna-s-rag-sunday.md');
    expect(shareFilename('')).toBe('recipe.md');
  });
});
