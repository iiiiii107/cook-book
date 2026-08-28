/* Recipes as markdown, for sending to somebody.

   Markdown because it is readable as it stands, in any editor, on any device,
   by someone who has never heard of this app — which is the whole point of
   sharing a recipe. It round-trips: what comes back out of `parseMarkdown` is
   what went into `recipeToMarkdown`.

   What it cannot carry is the decoration. Photographs, doodles and stickers
   are not text and there is nowhere honest to put them, so sharing a recipe
   shares its words. Full fidelity travels in the .zip backup instead, and the
   share dialog says so rather than letting it be discovered later. */

import { parseIngredient, formatIngredient, newRecipe } from './recipe.js';

/* --- writing ---------------------------------------------------------------- */

function metaLines(recipe) {
  const lines = [`- Portions: ${recipe.servings || 1}`];
  if (recipe.time?.prep) lines.push(`- Prep: ${recipe.time.prep} min`);
  if (recipe.time?.cook) lines.push(`- Cooking: ${recipe.time.cook} min`);
  if (recipe.sourceUrl) lines.push(`- Source: ${recipe.sourceUrl}`);
  if (recipe.sourceLabel) lines.push(`- Called: ${recipe.sourceLabel}`);
  return lines;
}

/** One recipe, as a section. Used alone and inside a cookbook. */
export function recipeSection(recipe) {
  const out = [`# ${recipe.title || 'Untitled recipe'}`, '', ...metaLines(recipe), ''];

  out.push('## Ingredients', '');
  for (const ingredient of recipe.ingredients || []) {
    out.push(`- ${formatIngredient(ingredient)}`);
  }
  if (!recipe.ingredients?.length) out.push('- ');
  out.push('');

  out.push('## Method', '');
  (recipe.steps || []).forEach((step, i) => out.push(`${i + 1}. ${step.text}`));
  if (!recipe.steps?.length) out.push('1. ');
  out.push('');

  if (recipe.notes?.trim()) out.push('## Notes', '', recipe.notes.trim(), '');
  return out.join('\n');
}

export function recipeToMarkdown(recipe) {
  return `${recipeSection(recipe).trimEnd()}\n`;
}

export function bookToMarkdown(book, recipes) {
  const head = ['---', `cookbook: ${book.title}`];
  if (book.subtitle) head.push(`subtitle: ${book.subtitle}`);
  head.push('---', '');

  const body = recipes.map((recipe) => recipeSection(recipe).trimEnd());
  return `${head.join('\n')}\n${body.join('\n\n')}\n`;
}

/* --- reading ----------------------------------------------------------------- */

/** Pull the leading `---` block off the front, if there is one. */
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

const NUMBER = /^(\d+)\s*min/i;

function readMeta(recipe, key, value) {
  switch (key) {
    case 'portions':
    case 'serves':
    case 'servings':
      recipe.servings = Number.parseInt(value, 10) || recipe.servings;
      break;
    case 'prep':
      recipe.time.prep = Number.parseInt(NUMBER.exec(value)?.[1] ?? value, 10) || 0;
      break;
    case 'cooking':
    case 'cook':
      recipe.time.cook = Number.parseInt(NUMBER.exec(value)?.[1] ?? value, 10) || 0;
      break;
    case 'source':
      recipe.sourceUrl = value;
      break;
    case 'called':
      recipe.sourceLabel = value;
      break;
    default:
      break;
  }
}

/**
 * Read a shared file back.
 * @returns {{book: {title: string, subtitle: string}|null, recipes: object[]}}
 */
export function parseMarkdown(text, { bookId } = {}) {
  const { meta, body } = frontmatter(String(text || '').replace(/\r\n/g, '\n'));
  const book = meta.cookbook
    ? { title: meta.cookbook, subtitle: meta.subtitle || '' }
    : null;

  // A recipe begins at every top-level heading. Splitting on the heading
  // rather than on a separator means a file someone has hand-edited, or one
  // exported by something else entirely, still comes in.
  const chunks = body.split(/^#[ \t]+/m).slice(1);
  const recipes = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const recipe = newRecipe({ bookId, title: lines.shift().trim() || 'Untitled recipe' });
    let section = 'meta';

    for (const raw of lines) {
      const line = raw.trim();

      const heading = /^##[ \t]+(.*)$/.exec(line);
      if (heading) {
        const name = heading[1].toLowerCase();
        section = name.startsWith('ingredient') ? 'ingredients'
          : name.startsWith('method') || name.startsWith('step') || name.startsWith('instruction') ? 'steps'
            : name.startsWith('note') ? 'notes'
              : 'skip';
        continue;
      }

      if (section === 'meta') {
        const bullet = /^[-*]\s+([^:]+):\s*(.*)$/.exec(line);
        if (bullet) readMeta(recipe, bullet[1].trim().toLowerCase(), bullet[2].trim());
        continue;
      }

      if (section === 'ingredients') {
        const bullet = /^[-*]\s+(.*)$/.exec(line);
        const parsed = bullet && parseIngredient(bullet[1]);
        if (parsed) recipe.ingredients.push(parsed);
        continue;
      }

      if (section === 'steps') {
        const numbered = /^(?:\d+[.)]|[-*])\s+(.*)$/.exec(line);
        if (numbered?.[1]) {
          recipe.steps.push({ id: `s${recipe.steps.length}${Date.now().toString(36)}`, text: numbered[1] });
        }
        continue;
      }

      if (section === 'notes' && line) {
        recipe.notes = recipe.notes ? `${recipe.notes}\n\n${line}` : line;
      }
    }

    recipes.push(recipe);
  }

  return { book, recipes };
}

/** A filename that says what it is. */
export function shareFilename(name) {
  const slug = String(name || 'recipe')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'recipe';
  return `${slug}.md`;
}
