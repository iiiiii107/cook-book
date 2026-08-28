/* Turning a planned week into a list you can shop from. */

import { mergeIngredients, formatAmount } from './units.js';
import { groupByAisle } from './aisles.js';
import { scaleIngredients } from './recipe.js';
import { formatLong } from './dates.js';

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
];

/** Every entry planned between two dates, in order. */
export function entriesBetween(plan = {}, dates = []) {
  const out = [];
  for (const date of dates) {
    for (const meal of MEALS) {
      for (const entry of plan[date]?.[meal.id] || []) {
        out.push({ ...entry, date, meal: meal.id });
      }
    }
  }
  return out;
}

/**
 * Gather the ingredients of a planned week, merged and sorted into aisles.
 *
 * Entries that are only a note ("leftovers") contribute nothing, which is
 * correct — there is nothing to buy for them.
 */
export function buildList({ plan, recipes, dates }) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const gathered = [];

  for (const entry of entriesBetween(plan, dates)) {
    const recipe = entry.recipeId && byId.get(entry.recipeId);
    if (!recipe) continue;

    // A planned meal can be cooked for a different number of people than the
    // recipe was written for; the list has to reflect what will be cooked.
    const factor = entry.servings && recipe.servings
      ? entry.servings / recipe.servings
      : 1;

    for (const ingredient of scaleIngredients(recipe.ingredients || [], factor)) {
      gathered.push({ ...ingredient, recipe: recipe.title });
    }
  }

  return groupByAisle(mergeIngredients(gathered));
}

/**
 * The list as markdown, with checkboxes.
 *
 * Markdown because it is readable anywhere and genuinely tickable in Notes,
 * Obsidian or Reminders — a shopping list is more use in the app you already
 * shop with than in a screen you have to keep this one open to see.
 */
export function toMarkdown(groups, { dates = [], skipped = new Set() } = {}) {
  const lines = ['# Shopping list', ''];

  if (dates.length) {
    const span = dates.length === 1
      ? formatLong(dates[0])
      : `${formatLong(dates[0])} – ${formatLong(dates[dates.length - 1])}`;
    lines.push(`_${span}_`, '');
  }

  for (const group of groups) {
    const items = group.items.filter((entry) => !skipped.has(entry.item));
    if (!items.length) continue;

    lines.push(`## ${group.label}`, '');
    for (const entry of items) {
      const amount = formatAmount(entry);
      lines.push(`- [ ] ${[amount, entry.label].filter(Boolean).join(' ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** A filename that sorts sensibly in a downloads folder. */
export function listFilename(dates = []) {
  const stamp = dates[0] || new Date().toISOString().slice(0, 10);
  return `shopping-list-${stamp}.md`;
}
