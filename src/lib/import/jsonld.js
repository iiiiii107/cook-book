/* Reading a recipe straight out of a web page.

   Most recipe sites are built on WordPress plugins that publish a schema.org
   Recipe block in the page's own markup. Where that block exists the recipe is
   already structured — the ingredients are a list, the steps are a list — so
   there is nothing for a language model to infer and nothing for it to get
   wrong. It is exact, instant, free, and works on every device.

   Only when the block is missing does the text go to the AI. */

import { parseIngredient, newRecipe } from '../recipe.js';

/** Walk whatever shape the page used and find the Recipe object. */
function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => String(t).toLowerCase() === 'recipe')) return node;

  // Sites commonly wrap everything in an @graph, and some nest the recipe
  // inside mainEntity or itemListElement.
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const found = findRecipe(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** "PT1H30M" → 90. Durations in schema.org are ISO 8601. */
export function minutesFrom(duration) {
  const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?)?/.exec(String(duration || ''));
  if (!match) return 0;
  const [, days, hours, minutes] = match;
  return Math.round((Number(days || 0) * 1440) + (Number(hours || 0) * 60) + Number(minutes || 0));
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  return String(value.text || value.name || '').trim();
}

/** Instructions come as strings, as HowToStep objects, or as sections of them. */
function stepsFrom(value, out = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) stepsFrom(item, out);
    return out;
  }
  if (typeof value === 'string') {
    // A single blob of prose: split on line breaks, or on sentences if it has
    // none, rather than making the whole method one step.
    const parts = value.includes('\n')
      ? value.split(/\n+/)
      : value.split(/(?<=\.)\s+(?=[A-Z])/);
    for (const part of parts) {
      const text = stripTags(part).trim();
      if (text) out.push(text);
    }
    return out;
  }
  if (value['@type'] === 'HowToSection' || value.itemListElement) {
    return stepsFrom(value.itemListElement, out);
  }
  const text = stripTags(textOf(value));
  if (text) out.push(text);
  return out;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    // Tags become spaces, so "the <b>water</b>." would otherwise come out as
    // "the water ." — a space before punctuation in every imported step.
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .trim();
}

/** How many the recipe serves, out of the several ways sites write it. */
function servingsFrom(value) {
  const text = Array.isArray(value) ? value[0] : value;
  const number = Number.parseInt(String(text ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(number) && number > 0 && number < 100 ? number : 4;
}

/**
 * Pull every JSON-LD block out of a page and turn the first Recipe into ours.
 * @param {string} html the page as served
 * @param {string} [url] where it came from, kept as the source link
 * @returns {object|null} a recipe, or null if the page has no Recipe block
 */
export function recipeFromHtml(html, url = '') {
  const blocks = String(html || '')
    .matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block[1].trim());
    } catch {
      continue;   // one malformed block should not stop the others being read
    }

    const found = findRecipe(data);
    if (!found) continue;

    const recipe = newRecipe({ title: stripTags(textOf(found.name)) || 'Untitled recipe' });
    recipe.servings = servingsFrom(found.recipeYield);
    recipe.time = {
      prep: minutesFrom(found.prepTime),
      cook: minutesFrom(found.cookTime) || Math.max(0, minutesFrom(found.totalTime) - minutesFrom(found.prepTime)),
    };
    recipe.sourceUrl = url || textOf(found.url) || '';
    recipe.sourceLabel = stripTags(textOf(found.author)) || hostOf(recipe.sourceUrl);

    for (const line of [].concat(found.recipeIngredient || found.ingredients || [])) {
      const parsed = parseIngredient(stripTags(line));
      if (parsed) recipe.ingredients.push(parsed);
    }

    stepsFrom(found.recipeInstructions).forEach((text, i) => {
      recipe.steps.push({ id: `s${i}${Date.now().toString(36)}`, text });
    });

    const description = stripTags(textOf(found.description));
    if (description) recipe.notes = description;

    // A "recipe" with nothing to cook is not one; let the AI have a go instead.
    if (!recipe.ingredients.length && !recipe.steps.length) continue;
    return recipe;
  }

  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The readable text of a page, for when there is no JSON-LD to read. */
export function textFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|br)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
