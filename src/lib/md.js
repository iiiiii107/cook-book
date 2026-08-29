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
    case 'yield':
    case 'makes':
      recipe.servings = Number.parseInt(value, 10) || recipe.servings;
      break;
    case 'prep':
    case 'prep time':
    case 'preparation':
      recipe.time.prep = Number.parseInt(NUMBER.exec(value)?.[1] ?? value, 10) || 0;
      break;
    case 'cooking':
    case 'cook':
    case 'cook time':
    case 'cooking time':
      recipe.time.cook = Number.parseInt(NUMBER.exec(value)?.[1] ?? value, 10) || 0;
      break;
    case 'source':
    case 'from':
    case 'url':
      recipe.sourceUrl = value;
      break;
    case 'called':
    case 'author':
    case 'by':
      recipe.sourceLabel = value;
      break;
    default:
      return false;
  }
  return true;
}

/* Which section a heading names.

   Recipes in the wild do not agree on any of this. The headings may be h2, h3,
   bold text or a plain label ending in a colon, and "Method" is just as likely
   to be called Directions, Steps, Instructions or Preparation. Accepting only
   one spelling meant a file imported its title and nothing else — which is
   worse than refusing it, because it looks like it worked. */
const SECTIONS = [
  ['ingredients', /^(ingredient|you will need|you need|what you need|shopping)/],
  ['steps', /^(method|direction|step|instruction|preparation|how to|to make|to cook)/],
  ['notes', /^(note|tip|to serve|serving suggestion)/],
];

function sectionOf(text) {
  const name = String(text).toLowerCase().replace(/[:*_#]/g, '').trim();
  for (const [section, pattern] of SECTIONS) {
    if (pattern.test(name)) return section;
  }
  return 'skip';
}

/** Is this line a heading of any of the shapes people actually write? */
function headingText(line) {
  const hash = /^#{2,6}[ \t]+(.+?)#*$/.exec(line);
  if (hash) return hash[1];

  const bold = /^\*\*(.+?)\*\*:?$/.exec(line);
  if (bold) return bold[1];

  const underlined = /^__(.+?)__:?$/.exec(line);
  if (underlined) return underlined[1];

  // "Ingredients:" on a line of its own — a label, not a sentence.
  const label = /^([A-Za-z][A-Za-z ]{2,24}):$/.exec(line);
  if (label) return label[1];

  return null;
}

const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const META_BULLET = /^[-*]\s+([A-Za-z][A-Za-z ]{1,18}):\s*(.+)$/;

/**
 * Read a shared file back.
 * @returns {{book: {title: string, subtitle: string}|null, recipes: object[]}}
 */
export function parseMarkdown(text, { bookId, fallbackTitle } = {}) {
  const { meta, body } = frontmatter(String(text || '').replace(/\r\n/g, '\n'));
  const book = meta.cookbook
    ? { title: meta.cookbook, subtitle: meta.subtitle || '' }
    : null;

  // A recipe begins at every top-level heading. A file with none at all is
  // still one recipe — plenty of people write a recipe as a plain list.
  const hasTop = /^#[ \t]+/m.test(body);
  const chunks = hasTop
    ? body.split(/^#[ \t]+/m).slice(1)
    : (body.trim() ? [`${fallbackTitle || meta.recipe || 'Untitled recipe'}\n${body}`] : []);

  const recipes = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const recipe = newRecipe({ bookId, title: lines.shift().trim() || 'Untitled recipe' });

    // 'auto' means no section heading has been seen yet, so the shape of each
    // line decides: bullets are things you need, numbers are things you do.
    let section = 'auto';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const heading = headingText(line);
      if (heading) {
        section = sectionOf(heading);
        continue;
      }

      const metaBullet = META_BULLET.exec(line);
      if (metaBullet && readMeta(recipe, metaBullet[1].trim().toLowerCase(), metaBullet[2].trim())) {
        continue;
      }

      // A bare "Serves 4" or "Prep 20 min" line, with no bullet and no colon.
      const bare = /^(serves|makes|prep(?:aration)?|cook(?:ing)?)\b[: ]+(.+)$/i.exec(line);
      if (bare && section !== 'steps' && readMeta(recipe, bare[1].toLowerCase(), bare[2].trim())) {
        continue;
      }

      const bullet = BULLET.exec(line);
      const numbered = NUMBERED.exec(line);

      if (section === 'ingredients' || (section === 'auto' && bullet)) {
        const parsed = parseIngredient(bullet ? bullet[1] : line);
        if (parsed) recipe.ingredients.push(parsed);
        continue;
      }

      if (section === 'steps' || (section === 'auto' && numbered)) {
        const body_ = numbered ? numbered[1] : (bullet ? bullet[1] : line);
        if (body_) {
          recipe.steps.push({
            id: `s${recipe.steps.length}${Date.now().toString(36)}`,
            text: body_,
          });
        }
        continue;
      }

      if (section === 'notes') {
        recipe.notes = recipe.notes ? `${recipe.notes}\n\n${line}` : line;
      }
    }

    // A recipe with nothing in it is not one. Without this, any prose with a
    // heading in it would import as an empty page — which looks like the
    // import worked and is worse than being told it found nothing.
    if (recipe.ingredients.length || recipe.steps.length || recipe.notes) {
      recipes.push(recipe);
    }
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
