import { el, modal, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { sortRecipes } from '../lib/recipe.js';
import { recipeToMarkdown, bookToMarkdown, parseMarkdown, shareFilename } from '../lib/md.js';

/* Sending a recipe to somebody, and taking one in.

   A markdown file, because the person receiving it should be able to read it
   without installing anything. What it cannot carry is the decoration — the
   dialog says so plainly rather than letting it be discovered on the other
   end. */

const DECORATION_NOTE =
  'Markdown carries the words. Photographs, doodles and stickers stay here — '
  + 'use a backup if you want everything.';

export function shareRecipe(recipe) {
  const markdown = recipeToMarkdown(recipe);
  const decorated = (recipe.elements || []).length > 0;

  modal({
    title: `Share “${recipe.title}”`,
    body: el('div', {}, [
      el('p', { class: 'settings-sub', text: decorated ? DECORATION_NOTE : 'A markdown file anyone can read.' }),
      preview(markdown),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Copy',
        onClick: () => {
          copy(markdown);
          return false;    // stay open, so the file can be saved as well
        },
      },
      {
        label: 'Save the file',
        class: 'btn',
        onClick: () => {
          download(markdown, shareFilename(recipe.title));
          toast('Recipe saved.');
        },
      },
    ],
  });
}

export function shareBook(book) {
  const recipes = sortRecipes(store.recipesInBook(book.id), book.sortMode || 'added');
  if (!recipes.length) {
    toast('Nothing in this cookbook to share yet.');
    return;
  }

  const markdown = bookToMarkdown(book, recipes);
  const decorated = recipes.some((r) => (r.elements || []).length)
    || (book.cover?.elements || []).length;

  modal({
    title: `Share “${book.title}”`,
    body: el('div', {}, [
      el('p', {
        class: 'settings-sub',
        text: `${recipes.length} recipes. ${decorated ? DECORATION_NOTE : 'A markdown file anyone can read.'}`,
      }),
      preview(markdown),
    ]),
    actions: [
      { label: 'Cancel' },
      { label: 'Copy', onClick: () => { copy(markdown); return false; } },
      {
        label: 'Save the file',
        class: 'btn',
        onClick: () => {
          download(markdown, shareFilename(book.title));
          toast('Cookbook saved.');
        },
      },
    ],
  });
}

/* --- taking one in ----------------------------------------------------------- */

/**
 * Import a shared file into a cookbook.
 * @param {string} [bookId] where to put it; a new cookbook is made without one
 */
export function importMarkdown(bookId) {
  const input = el('input', { type: 'file', accept: '.md,.markdown,text/markdown,text/plain' });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    let parsed;
    try {
      parsed = parseMarkdown(await file.text(), {
        bookId,
        fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (error) {
      console.warn('Could not read that file.', error);
      toast('That file could not be read.');
      return;
    }

    if (!parsed.recipes.length) {
      toast('Nothing recipe-shaped in that file — no ingredients or steps found.');
      return;
    }

    const thin = parsed.recipes.filter((r) => !r.ingredients.length || !r.steps.length);
    if (thin.length) {
      // Half an import is the thing worth noticing, and it used to happen
      // silently: the title came in and nothing else.
      console.warn('Some recipes came in incomplete:', thin.map((r) => r.title));
    }

    // A file that names a cookbook makes one, unless we were told where to put
    // it — importing into an open cookbook should not spawn a second.
    let target = bookId;
    if (!target) {
      const made = store.addBook({
        title: parsed.book?.title || file.name.replace(/\.[^.]+$/, ''),
        subtitle: parsed.book?.subtitle || '',
      });
      target = made.id;
    }

    for (const recipe of parsed.recipes) {
      store.addRecipe({ ...recipe, bookId: target });
    }

    toast(`Brought in ${parsed.recipes.length} ${parsed.recipes.length === 1 ? 'recipe' : 'recipes'}.`);
    location.hash = `#/book/${target}`;
  });

  input.click();
}

/* --- helpers ------------------------------------------------------------------ */

function preview(markdown) {
  return el('pre', { class: 'share-preview', text: markdown });
}

function copy(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast('Copied.'))
    .catch(() => toast('Could not copy — save the file instead.'));
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
