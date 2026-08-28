import { el, modal, chefName, toast, iconLink, iconButton, hashUnit } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { importMarkdown } from './share.js';
import { todayISO, startOfWeek, addDays, formatShort, weekLabel } from '../lib/dates.js';
import { toHex, COVER_STYLES, PAPER_STOCKS } from '../lib/theme.js';
import { stickerSvg, STICKER_IDS } from '../lib/stickers.js';

/* The desk: every cookbook you own, lying out, with the week's planning sheet
   beside them. The planner is deliberately here rather than inside a book —
   a week's meals are drawn from whichever books you like, so it belongs to
   the desk, not to any one of them. */

export function renderDesk(host) {
  const { books } = store.state;

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        'Cook Book',
        el('small', { text: `Good to see you, ${chefName(store.state.settings.profile)}.` }),
      ]),
      el('div', { class: 'scene-actions' }, [
        iconButton('inbox', 'Bring in a shared recipe', { onClick: () => importMarkdown() }),
        iconLink('settings', 'Settings', '#/settings'),
      ]),
    ]),
  );

  const row = el('div', { class: 'book-row' });

  for (const book of books) {
    row.append(bookCard(book));
  }

  row.append(
    el(
      'button',
      {
        class: 'book-card book-new',
        type: 'button',
        style: scatter('new-cookbook-slot'),
        onClick: () => promptNewBook(),
      },
      [
        el('div', { class: 'book-cover' }, [
          el('div', {}, [
            el('div', { class: 'book-title', text: 'A new cookbook' }),
            el('div', { class: 'book-sub', text: 'Pasta, Sunday lunches, whatever you like' }),
          ]),
        ]),
      ],
    ),
  );

  const thisWeek = startOfWeek(todayISO(), 1);
  row.append(planSheet(addDays(thisWeek, -7), { past: true }));
  row.append(planSheet(thisWeek));
  host.append(row);

  if (!books.length) {
    host.append(
      el('p', {
        class: 'empty on-desk',
        text: 'The desk is clear. Start a cookbook and it will lie here waiting.',
      }),
    );
  }
}

/* Books are laid out scattered rather than filed: each gets a small tilt and
   offset derived from its own id, so the desk looks used without the
   arrangement ever reshuffling itself between visits. */
function scatter(id) {
  const tilt = (hashUnit(id, 1) - 0.5) * 13;       // ±6.5°
  const shiftX = (hashUnit(id, 2) - 0.5) * 40;     // ±20px
  const shiftY = (hashUnit(id, 3) - 0.5) * 76;     // ±38px
  return `--tilt:${tilt.toFixed(2)}deg; --shift-x:${shiftX.toFixed(1)}px; --shift-y:${shiftY.toFixed(1)}px`;
}

function bookCard(book) {
  const count = store.recipesInBook(book.id).length;

  const card = el(
    'button',
    {
      class: 'book-card',
      type: 'button',
      style: scatter(book.id),
      onClick: () => {
        location.hash = `#/book/${book.id}`;
      },
      onContextmenu: (event) => {
        event.preventDefault();
        bookMenu(book);
      },
    },
    [
      el(
        'div',
        {
          class: 'book-cover',
          dataset: { style: book.coverStyle || 'plain' },
          style: `--spine:${book.spine}`,
        },
        [
          book.coverSticker && el('span', { class: 'book-sticker' }, [
            stickerSvg(book.coverSticker),
          ]),
          el('div', { class: 'book-title', text: book.title }),
          book.subtitle && el('div', { class: 'book-sub', text: book.subtitle }),
          el('div', {
            class: 'book-count',
            text: count === 1 ? '1 recipe' : `${count} recipes`,
          }),
        ],
      ),
    ],
  );
  return card;
}

/* Two sheets of paper, and no more: this week, and the one just gone.

   A week rolls over on its own — the plan is keyed by the actual date, so next
   Monday is simply a different key and starts blank. Last week's sheet stays
   on the desk until it in turn becomes the week before that, and is then
   forgotten (see store.prunePlan). */
function weekDates(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function planSheet(start, { past = false } = {}) {
  const dates = weekDates(start);
  const count = store.plannedCount(dates);
  const label = weekLabel(start);

  const summary = count
    ? `${count} ${count === 1 ? 'meal' : 'meals'} ${past ? 'cooked' : 'planned'}`
    : past
      ? 'Nothing was written down'
      : 'Plan the meals, then take the shopping list with you.';

  return el(
    'button',
    {
      class: `plan-sheet${past ? ' is-past' : ''}`,
      type: 'button',
      style: scatter(past ? 'last-week-sheet' : 'the-planning-sheet'),
      onClick: () => { location.hash = `#/plan?week=${start}`; },
    },
    [
      el('h3', { text: label }),
      el('p', { text: summary }),
      el('span', { class: 'sheet-dates', text: `${formatShort(dates[0])} – ${formatShort(dates[6])}` }),
    ],
  );
}

/* --- creating and editing a book ----------------------------------------- */

const SPINES = ['--tag-1', '--tag-2', '--tag-3', '--tag-4', '--tag-5', '--tag-6'];

function bookForm(initial = {}) {
  const title = el('input', {
    type: 'text',
    value: initial.title || '',
    placeholder: 'Pasta, or Sunday lunches',
  });
  const subtitle = el('input', {
    type: 'text',
    value: initial.subtitle || '',
    placeholder: 'A line for the cover, if you like',
  });

  let spine = toHex(initial.spine || 'var(--tag-1)');
  let coverStyle = initial.coverStyle || 'plain';
  let coverSticker = initial.coverSticker || '';
  let paperStock = initial.paperStock || 'plain';

  // A live cover, so every choice is seen rather than imagined.
  const preview = el('div', { class: 'book-card cover-preview' });
  function drawPreview() {
    preview.replaceChildren(
      el('div', { class: 'book-cover', dataset: { style: coverStyle }, style: `--spine:${spine}` }, [
        coverSticker && el('span', { class: 'book-sticker' }, [stickerSvg(coverSticker)]),
        el('div', { class: 'book-title', text: title.value || 'Untitled' }),
        subtitle.value && el('div', { class: 'book-sub', text: subtitle.value }),
      ]),
    );
  }
  title.addEventListener('input', drawPreview);
  subtitle.addEventListener('input', drawPreview);

  const picker = el('input', {
    type: 'color',
    value: spine,
    'aria-label': 'Spine colour',
    onInput: (event) => {
      spine = event.target.value;
      drawPreview();
    },
  });

  // The presets are a starting point; the picker is the real control.
  const swatches = el('div', { class: 'swatch-row' },
    SPINES.map((token) =>
      el('button', {
        type: 'button',
        class: 'swatch',
        style: `background: var(${token})`,
        'aria-label': `Spine colour ${token.replace('--tag-', '')}`,
        onClick: () => {
          spine = toHex(`var(${token})`);
          picker.value = spine;
          drawPreview();
        },
      }),
    ),
  );

  const chooser = (options, current, onPick) => {
    const row = el('div', { class: 'seg seg-wrap' },
      options.map((option) =>
        el('button', {
          class: 'seg-item',
          type: 'button',
          text: option.label,
          'aria-pressed': String(option.id === current),
          onClick: (event) => {
            for (const b of row.children) b.setAttribute('aria-pressed', 'false');
            event.currentTarget.setAttribute('aria-pressed', 'true');
            onPick(option.id);
          },
        }),
      ),
    );
    return row;
  };

  // "None" first, so a plain cover stays one click away.
  const stickerRow = el('div', { class: 'tray-row tray-stickers' }, [
    el('button', {
      class: 'tray-sticker is-none',
      type: 'button',
      text: 'None',
      'aria-label': 'No sticker',
      onClick: () => {
        coverSticker = '';
        drawPreview();
      },
    }),
    ...STICKER_IDS.map((id) =>
      el('button', {
        class: 'tray-sticker',
        type: 'button',
        title: id,
        'aria-label': `Cover sticker: ${id}`,
        onClick: () => {
          coverSticker = id;
          drawPreview();
        },
      }, [stickerSvg(id)]),
    ),
  ]);

  const body = el('div', { class: 'book-form' }, [
    el('div', { class: 'book-form-main' }, [
      el('div', { class: 'field' }, [el('span', { class: 'label', text: 'Title' }), title]),
      el('div', { class: 'field' }, [el('span', { class: 'label', text: 'Subtitle' }), subtitle]),
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'Spine' }),
        el('div', { class: 'spine-row' }, [picker, swatches]),
      ]),
    ]),
    el('div', { class: 'book-form-preview' }, [preview]),
    el('div', { class: 'field is-wide' }, [
      el('span', { class: 'label', text: 'Binding' }),
      chooser(COVER_STYLES, coverStyle, (id) => {
        coverStyle = id;
        drawPreview();
      }),
    ]),
    el('div', { class: 'field is-wide' }, [
      el('span', { class: 'label', text: 'Cover sticker' }),
      stickerRow,
    ]),
    el('div', { class: 'field is-wide' }, [
      el('span', { class: 'label', text: 'Paper inside' }),
      chooser(PAPER_STOCKS, paperStock, (id) => {
        paperStock = id;
      }),
    ]),
  ]);

  drawPreview();

  return {
    body,
    read: () => ({
      title: title.value.trim(),
      subtitle: subtitle.value.trim(),
      spine,
      coverStyle,
      coverSticker,
      paperStock,
    }),
  };
}

function promptNewBook() {
  const form = bookForm();
  modal({
    title: 'A new cookbook',
    body: form.body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Make it',
        class: 'btn',
        onClick: () => {
          const fields = form.read();
          if (!fields.title) {
            toast('It needs a name.');
            return false;
          }
          const book = store.addBook(fields);
          location.hash = `#/book/${book.id}`;
        },
      },
    ],
  });
}

export function bookMenu(book) {
  const form = bookForm(book);
  modal({
    title: 'Cookbook',
    body: form.body,
    actions: [
      {
        label: 'Delete',
        class: 'btn btn-danger btn-sm',
        onClick: () => {
          const count = store.recipesInBook(book.id).length;
          const warning = count
            ? `Delete “${book.title}” and its ${count === 1 ? 'recipe' : `${count} recipes`}?`
            : `Delete “${book.title}”?`;
          // eslint-disable-next-line no-alert
          if (confirm(warning)) {
            store.deleteBook(book.id);
            location.hash = '#/';
          }
        },
      },
      { label: 'Cancel' },
      {
        label: 'Save',
        class: 'btn',
        onClick: () => store.updateBook(book.id, form.read()),
      },
    ],
  });
}
