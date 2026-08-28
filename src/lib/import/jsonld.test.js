import { describe, it, expect } from 'vitest';
import { recipeFromHtml, textFromHtml, minutesFrom } from './jsonld.js';

const page = (data) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>x</body></html>`;

const RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Carbonara',
  author: { '@type': 'Person', name: 'Nonna' },
  recipeYield: '4 servings',
  prepTime: 'PT10M',
  cookTime: 'PT15M',
  recipeIngredient: ['400 g spaghetti', '150 g guanciale', 'salt to taste'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Boil the water.' },
    { '@type': 'HowToStep', text: 'Render the guanciale.' },
  ],
  description: 'The pan must be off the heat.',
};

describe('recipeFromHtml', () => {
  it('reads a recipe that the page already published', () => {
    const recipe = recipeFromHtml(page(RECIPE), 'https://example.com/carbonara');
    expect(recipe).toMatchObject({
      title: 'Carbonara',
      servings: 4,
      sourceUrl: 'https://example.com/carbonara',
      sourceLabel: 'Nonna',
      notes: 'The pan must be off the heat.',
    });
    expect(recipe.time).toEqual({ prep: 10, cook: 15 });
  });

  it('keeps the ingredients parsed rather than as text', () => {
    const { ingredients } = recipeFromHtml(page(RECIPE));
    expect(ingredients.map((i) => [i.qty, i.unit, i.item])).toEqual([
      [400, 'g', 'spaghetti'],
      [150, 'g', 'guanciale'],
      [null, '', 'salt to taste'],
    ]);
  });

  it('finds the recipe inside an @graph, which is how most sites wrap it', () => {
    const recipe = recipeFromHtml(page({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebSite', name: 'A blog' }, RECIPE],
    }));
    expect(recipe.title).toBe('Carbonara');
  });

  it('copes with @type given as an array', () => {
    const recipe = recipeFromHtml(page({ ...RECIPE, '@type': ['Recipe', 'NewsArticle'] }));
    expect(recipe.title).toBe('Carbonara');
  });

  it('reads instructions given as sections', () => {
    const recipe = recipeFromHtml(page({
      ...RECIPE,
      recipeInstructions: [{
        '@type': 'HowToSection',
        name: 'The sauce',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Beat the eggs.' },
          { '@type': 'HowToStep', text: 'Add the cheese.' },
        ],
      }],
    }));
    expect(recipe.steps.map((s) => s.text)).toEqual(['Beat the eggs.', 'Add the cheese.']);
  });

  it('splits a single blob of prose rather than making it one step', () => {
    const recipe = recipeFromHtml(page({
      ...RECIPE,
      recipeInstructions: 'Boil the water. Cook the pasta. Serve at once.',
    }));
    expect(recipe.steps).toHaveLength(3);
  });

  it('strips the markup sites leave inside instructions', () => {
    const recipe = recipeFromHtml(page({
      ...RECIPE,
      recipeInstructions: [{ '@type': 'HowToStep', text: '<p>Boil the <b>water</b>.</p>' }],
    }));
    expect(recipe.steps[0].text).toBe('Boil the water.');
  });

  it('works out cooking time from the total when only that is given', () => {
    const recipe = recipeFromHtml(page({
      ...RECIPE, cookTime: undefined, totalTime: 'PT1H',
    }));
    expect(recipe.time).toEqual({ prep: 10, cook: 50 });
  });

  it('ignores a block that is not a recipe', () => {
    expect(recipeFromHtml(page({ '@type': 'Article', name: 'Not a recipe' }))).toBeNull();
  });

  it('ignores a Recipe block with nothing to cook in it', () => {
    expect(recipeFromHtml(page({ '@type': 'Recipe', name: 'Empty' }))).toBeNull();
  });

  it('survives a malformed block, and reads a good one after it', () => {
    const html = `<script type="application/ld+json">{ broken</script>${page(RECIPE)}`;
    expect(recipeFromHtml(html).title).toBe('Carbonara');
  });

  it('returns null for a page with no structured data at all', () => {
    expect(recipeFromHtml('<html><body><h1>Just a page</h1></body></html>')).toBeNull();
    expect(recipeFromHtml('')).toBeNull();
  });
});

describe('minutesFrom', () => {
  it('reads ISO 8601 durations', () => {
    expect(minutesFrom('PT30M')).toBe(30);
    expect(minutesFrom('PT1H30M')).toBe(90);
    expect(minutesFrom('PT2H')).toBe(120);
    expect(minutesFrom('P1D')).toBe(1440);
    expect(minutesFrom(undefined)).toBe(0);
  });
});

describe('textFromHtml', () => {
  it('gives the readable text, for when there is no structured data', () => {
    const text = textFromHtml('<div><script>ignore()</script><p>Boil water</p><p>Add pasta</p></div>');
    expect(text).toContain('Boil water');
    expect(text).toContain('Add pasta');
    expect(text).not.toContain('ignore');
  });
});
