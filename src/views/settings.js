import { el, toast, chefName, iconLink } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { storage } from '../lib/storage.js';
import { applyTheme, PALETTE_KEYS, SPINE_KEYS, PRESETS, WOODS, FACES, FACE_LABELS } from '../lib/theme.js';

/* Settings.

   Everything here writes a custom property or a data attribute onto <html>
   and nothing else — see theme.js. That is what lets the palette be genuinely
   yours rather than a choice between two moods someone else picked. */

export function renderSettings(host) {
  const { settings } = store.state;

  const set = async (patch) => {
    await store.updateSettings(patch);
    applyTheme(store.state.settings);
  };

  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, [
        'Settings',
        el('small', { text: `Make it yours, ${chefName(settings.profile)}.` }),
      ]),
      iconLink('desk', 'Back to the desk', '#/'),
    ]),
  );

  const sheet = el('div', { class: 'settings-sheet' });
  host.append(sheet);

  // --- who you are ---------------------------------------------------------
  const name = el('input', {
    type: 'text',
    value: settings.profile?.name || '',
    placeholder: 'Isabel',
    onChange: (event) =>
      set({ profile: { ...store.state.settings.profile, name: event.target.value.trim() } }),
  });
  sheet.append(
    card('Your name', 'Used only to say hello. Signing in with Google fills this in for you; leave it empty and the app just says “Chef”.', [
      el('div', { class: 'field' }, [el('span', { class: 'label', text: 'Name' }), name]),
    ]),
  );

  // --- light ---------------------------------------------------------------
  sheet.append(
    card('Light', 'Day is sun through the window; night is moonlight. The cord and the lamp on the desk do the same thing.', [
      row('Time of day', segmented(
        [
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Day' },
          { id: 'dark', label: 'Night' },
        ],
        settings.theme,
        (id) => set({ theme: id }),
      )),
      row('The light itself', segmented(
        [
          { id: 'on', label: 'Window' },
          { id: 'off', label: 'Shutters closed' },
          { id: 'bulb', label: 'Bulb' },
        ],
        settings.light,
        (id) => set({ light: id }),
      )),
    ]),
  );

  // --- the desk ------------------------------------------------------------
  sheet.append(
    card('The desk', 'What the book is lying on.', [
      el(
        'div',
        { class: 'wood-row' },
        WOODS.map((wood) =>
          el('button', {
            class: 'wood-chip',
            type: 'button',
            'data-wood-sample': wood,
            'aria-pressed': String(settings.wood === wood),
            title: wood,
            text: wood,
            onClick: () => set({ wood }),
          }),
        ),
      ),
    ]),
  );

  // --- colours -------------------------------------------------------------
  const swatches = (keys) =>
    el(
      'div',
      { class: 'palette-grid' },
      keys.map(({ id, label, hint }) =>
        el('label', { class: 'palette-cell' }, [
          el('input', {
            type: 'color',
            value: settings.palette?.[id] || currentColour(id),
            'aria-label': label,
            onInput: (event) =>
              set({ palette: { ...store.state.settings.palette, [id]: event.target.value } }),
          }),
          el('span', {}, [label, hint && el('small', { text: hint })]),
        ]),
      ),
    );

  sheet.append(
    card('Colours', 'The interface runs on four colours. Buttons and links follow the accent, so changing that changes them too.', [
      el(
        'div',
        { class: 'preset-row' },
        Object.entries(PRESETS).map(([, preset]) =>
          el('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: preset.label,
            onClick: () => set({ palette: { ...preset.vars } }),
          }),
        ),
      ),
      swatches(PALETTE_KEYS),
      el('p', { class: 'settings-sub', text: 'The colours a cookbook spine can be given.' }),
      swatches(SPINE_KEYS),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        type: 'button',
        text: 'Back to the originals',
        onClick: () => set({ palette: {} }),
      }),
    ]),
  );

  // --- type ----------------------------------------------------------------
  const faces = Object.keys(FACES).map((id) => ({ id, label: FACE_LABELS[id] }));
  sheet.append(
    card('Type', null, [
      row('Headings', segmented(faces, settings.fontDisplay, (id) => set({ fontDisplay: id }))),
      row('Body', segmented(faces, settings.fontBody, (id) => set({ fontBody: id }))),
      row('Size', segmented(
        [
          { id: 0.9, label: 'Small' },
          { id: 1, label: 'Normal' },
          { id: 1.15, label: 'Large' },
          { id: 1.3, label: 'Largest' },
        ],
        settings.textScale ?? 1,
        (id) => set({ textScale: Number(id) }),
      )),
    ]),
  );

  // --- backup --------------------------------------------------------------
  sheet.append(
    card('Backup', 'A plain JSON copy of everything except photographs. Photographs join the backup when they arrive.', [
      el('div', { class: 'field-row' }, [
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Export', onClick: exportBackup }),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Import', onClick: importBackup }),
      ]),
    ]),
  );
}

/* --- the settings kit ------------------------------------------------------ */
/* Same small vocabulary as 10minutestospare's settings screen. */

function card(title, sub, children) {
  return el('section', { class: 'settings-card' }, [
    el('h2', { text: title }),
    sub && el('p', { class: 'settings-sub', text: sub }),
    ...children,
  ]);
}

function row(label, control) {
  return el('div', { class: 'settings-row' }, [
    el('span', { class: 'label', text: label }),
    control,
  ]);
}

function segmented(options, value, onPick) {
  const buttons = options.map((option) =>
    el('button', {
      class: 'seg-item',
      type: 'button',
      text: option.label,
      'aria-pressed': String(String(option.id) === String(value)),
      onClick: () => onPick(option.id),
    }),
  );
  return el('div', { class: 'seg' }, buttons);
}

/** The colour a token currently resolves to, so the picker opens on it. */
function currentColour(id) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${id}`).trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  // Anything that isn't already a plain hex has to be resolved through canvas.
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = raw || '#000000';
  return probe.fillStyle;
}

/* --- backup ----------------------------------------------------------------- */

async function exportBackup() {
  const json = await storage.exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = el('a', { href: url, download: `cook-book-${stamp}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup saved.');
}

function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    // eslint-disable-next-line no-alert
    if (!confirm('Replace everything on the desk with this backup?')) return;
    try {
      await storage.importAll(await file.text());
      applyTheme(store.state.settings);
      toast('Backup restored.');
    } catch {
      toast('That file could not be read.');
    }
  });
  input.click();
}
