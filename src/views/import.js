import { el, clear, toast, iconLink, chefName } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { formatIngredient } from '../lib/recipe.js';
import {
  importFromUrl, importFromText, importFromImage, importCapabilities, proxyConfigured,
} from '../lib/import/index.js';
import { importMarkdown } from './share.js';

/* Bringing a recipe in from somewhere else.

   Three ways in, and a review before anything is saved. Nothing lands in a
   cookbook unseen: a model that has misread a quantity should be caught while
   the source is still in front of you. */

export function renderImport(host, query) {
  const bookId = query?.get('book') || store.state.books[0]?.id || null;
  const prefill = query?.get('text') || '';

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        'Bring in a recipe',
        el('small', { text: `From a link, some words, or a screenshot, ${chefName(store.state.settings.profile)}.` }),
      ]),
      el('div', { class: 'scene-actions' }, [iconLink('desk', 'Back to the desk', '#/')]),
    ]),
  );

  const panel = el('div', { class: 'import-panel' });
  host.append(panel);

  const status = el('div', { class: 'import-status' });
  const result = el('div', { class: 'import-result' });

  const url = el('input', { type: 'url', placeholder: 'https://a-recipe-blog.com/…' });
  const text = el('textarea', {
    rows: '7',
    placeholder: 'Paste a recipe, or a caption from a post…',
  });
  text.value = prefill;

  const photo = el('input', { type: 'file', accept: 'image/*', class: 'sr-only' });

  panel.append(
    section('From a link', [
      el('div', { class: 'import-row' }, [
        url,
        el('button', {
          class: 'btn btn-sm', type: 'button', text: 'Read it',
          onClick: () => run(() => importFromUrl(url.value.trim(), store.state.settings)),
        }),
      ]),
      el('p', {
        class: 'settings-sub',
        text: proxyConfigured()
          ? 'Recipe blogs usually publish their recipe as data — those come in exactly, with no AI involved. Instagram and TikTok cannot be read from a link; use a screenshot.'
          : 'Not set up yet — the fetch helper has not been deployed. Paste the text instead, which always works.',
      }),
    ]),

    section('From a screenshot', [
      el('div', { class: 'import-row' }, [
        el('button', {
          class: 'btn btn-sm', type: 'button', text: 'Choose a picture',
          onClick: () => photo.click(),
        }),
        photo,
      ]),
      el('p', {
        class: 'settings-sub',
        text: 'The way to get a recipe off Instagram or TikTok: screenshot the post, and the model reads it.',
      }),
    ]),

    section('From a shared file', [
      el('div', { class: 'import-row' }, [
        el('button', {
          class: 'btn btn-sm', type: 'button', text: 'Choose a .md file',
          onClick: () => importMarkdown(bookId),
        }),
      ]),
      el('p', {
        class: 'settings-sub',
        text: 'A recipe or a whole cookbook someone shared with you. No model involved.',
      }),
    ]),

    section('From words', [
      text,
      el('div', { class: 'import-row' }, [
        el('button', {
          class: 'btn btn-sm', type: 'button', text: 'Read it',
          onClick: () => run(() => importFromText(text.value, store.state.settings)),
        }),
      ]),
    ]),
  );

  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    photo.value = '';
    if (file) run(() => importFromImage(file, store.state.settings));
  });

  panel.append(status, result);
  paintCapabilities();

  async function paintCapabilities() {
    const can = await importCapabilities(store.state.settings);
    clear(status);

    if (can.ollama) {
      status.append(el('p', {
        class: 'settings-sub is-ready',
        text: `Ollama is answering, using ${can.model}.`,
      }));
      return;
    }

    // The commonest reason, and the one nothing on this page can fix: an
    // HTTPS page is not allowed to reach a program on your own machine. Say
    // that outright rather than letting it look like Ollama is broken.
    if (can.blockedByOrigin) {
      // Not a fault to fix — browsers will not let a page from the internet
      // reach a program on your own machine, and nothing here can change that.
      // Reading happens on the Mac; the recipe syncs back to this device.
      status.append(
        el('p', {
          class: 'settings-sub',
          text: 'Reading a screenshot or pasted text happens on your Mac. Open “Cook Book (local)” from the project folder, import there, and the recipe will be here within seconds.',
        }),
        el('p', {
          class: 'settings-sub',
          text: 'A shared .md file works here, and so will links once the fetch helper is deployed.',
        }),
      );
      return;
    }

    // On the local copy, but pointing somewhere that is not answering.
    const url = store.state.settings.ollama?.url || '';
    if (store.state.settings.ollama?.enabled && !/localhost|127\./.test(url)) {
      status.append(el('p', {
        class: 'settings-sub sync-error',
        text: `The model is set to ${url}, which is not answering. If that was a temporary address, set it back to this Mac in Settings.`,
      }));
      return;
    }

    status.append(el('p', {
      class: 'settings-sub',
      text: store.state.settings.ollama?.enabled
        ? 'Ollama is not answering. Start it, or check the address in settings.'
        : 'Ollama is off. Turn it on in settings to read screenshots and pasted text.',
    }));
  }

  /* --- running one --------------------------------------------------------- */

  async function run(job) {
    clear(result);
    clear(status);
    status.append(el('p', { class: 'settings-sub', text: 'Reading…' }));

    try {
      const { recipe, how } = await job();
      clear(status);
      review(recipe, how);
    } catch (error) {
      clear(status);
      status.append(el('p', { class: 'settings-sub sync-error', text: String(error.message || error) }));
    }
  }

  /* --- the review ----------------------------------------------------------- */

  /* Nothing is saved until it has been looked at. The source is still on
     screen, so a wrong quantity is obvious now and invisible later. */
  function review(recipe, how) {
    clear(result);

    const books = store.state.books;
    const chooser = el('select', { class: 'import-book' },
      books.map((book) => el('option', { value: book.id, selected: book.id === bookId }, [book.title])));

    result.append(
      el('div', { class: 'import-review' }, [
        el('h3', { text: recipe.title }),
        el('p', {
          class: 'settings-sub',
          text: how === 'structured'
            ? 'Read straight from the page, exactly as published.'
            : 'Read by the model — check the quantities before you keep it.',
        }),
        el('p', { class: 'import-meta', text: metaLine(recipe) }),

        el('h4', { class: 'label', text: 'Ingredients' }),
        el('ul', { class: 'import-list' },
          recipe.ingredients.map((i) => el('li', { text: formatIngredient(i) }))),

        el('h4', { class: 'label', text: 'Method' }),
        el('ol', { class: 'import-list' },
          recipe.steps.map((s) => el('li', { text: s.text }))),

        recipe.notes && el('p', { class: 'import-notes', text: recipe.notes }),

        el('div', { class: 'import-actions' }, [
          books.length > 1 && el('span', { class: 'label', text: 'Into' }),
          books.length ? chooser : null,
          el('button', {
            class: 'btn',
            type: 'button',
            text: 'Keep it',
            onClick: () => {
              const target = books.length ? chooser.value : store.addBook({ title: 'Imported' }).id;
              const saved = store.addRecipe({ ...recipe, bookId: target });
              toast('Recipe saved.');
              location.hash = `#/recipe/${saved.id}?edit=1`;
            },
          }),
        ]),
      ]),
    );
  }
}

function metaLine(recipe) {
  const bits = [`${recipe.servings} portions`];
  const time = (recipe.time?.prep || 0) + (recipe.time?.cook || 0);
  if (time) bits.push(`${time} min`);
  if (recipe.sourceLabel) bits.push(recipe.sourceLabel);
  return bits.join(' · ');
}

function section(title, children) {
  return el('section', { class: 'import-section' }, [
    el('h3', { text: title }),
    ...children,
  ]);
}
