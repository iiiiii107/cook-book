import { el, clear, toast, chefName, iconLink } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { makeBackup, restoreBackup, backupFilename } from '../lib/backup.js';
import {
  syncConfigured, currentAccount, syncError, signIn, signOutOfSync, onAccountChange,
  photoSyncState, PHOTO_SYNC,
} from '../lib/sync.js';
import { ollamaModels } from '../lib/import/ollama.js';
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

  // --- syncing between devices ---------------------------------------------
  sheet.append(syncCard());

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

  // --- reading recipes with a model ----------------------------------------
  sheet.append(ollamaCard(set, settings));

  // --- backup --------------------------------------------------------------
  sheet.append(
    card('Backup', 'Everything on the desk in one file, photographs included. Restoring replaces what is here.', [
      el('div', { class: 'field-row' }, [
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Save a backup', onClick: exportBackup }),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Restore', onClick: importBackup }),
      ]),
    ]),
  );
}

/* --- signing in -------------------------------------------------------------- */

/* Everything lands under your own user id, and the rules make that the only
   place you can read or write. Signing in is also what fills in your name, so
   the app can stop calling you "Chef" and nothing else. */
function syncCard() {
  const body = el('div', { class: 'sync-body' });

  function paint() {
    clear(body);

    if (!syncConfigured()) {
      body.append(
        el('p', {
          class: 'settings-sub',
          text: 'This copy of the app was built without a Firebase project, so everything stays in this browser. Add VITE_FIREBASE_CONFIG as a repository secret to turn syncing on.',
        }),
      );
      return;
    }

    const account = currentAccount();
    const error = syncError();

    if (account) {
      body.append(
        el('div', { class: 'sync-account' }, [
          account.photo && el('img', { class: 'sync-avatar', src: account.photo, alt: '' }),
          el('div', {}, [
            el('strong', { text: account.name || 'Signed in' }),
            el('div', { class: 'settings-sub', text: account.email || '' }),
          ]),
          el('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: 'Sign out',
            onClick: () => signOutOfSync().catch(() => toast('Could not sign out.')),
          }),
        ]),
      );
      const photos = photoSyncState();
      body.append(el('p', {
        class: 'settings-sub',
        text: error || (photos === PHOTO_SYNC.UNAVAILABLE
          ? 'Your cookbooks, recipes and plan follow you to every device. Photographs stay on the device that added them — that needs Firebase Storage, which is on the paid plan. They still travel in a backup.'
          : 'Your cookbooks, recipes and plan follow you to every device you sign in on.'),
      }));
      return;
    }

    body.append(
      el('p', {
        class: 'settings-sub',
        text: 'Sign in to keep your cookbooks on every device. Everything stays private to your account.',
      }),
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Sign in with Google',
        onClick: () => signIn().catch((err) => {
          console.warn('Sign-in failed.', err);
          toast('Sign-in did not go through.');
        }),
      }),
    );

    // Native append stringifies null into the page as the word "null" — el()
    // guards against that for its children, but append() does not.
    if (error) {
      body.append(el('p', { class: 'settings-sub sync-error', text: error }));
    }
  }

  paint();
  const off = onAccountChange(paint);
  // The settings screen is rebuilt on every route change; let go with it.
  new MutationObserver((records, observer) => {
    if (document.contains(body)) return;
    off();
    observer.disconnect();
  }).observe(document.body, { childList: true, subtree: true });

  return card('Your account', null, [body]);
}

/* --- Ollama -------------------------------------------------------------------- */

/* A model on your own Mac: free, private, offline, no key. It cannot reach the
   iPad — an HTTPS page may not call http://localhost from another device, and
   Safari blocks it even locally — so this is Chrome on the Mac. Everything
   else works everywhere. */
function ollamaCard(set, settings) {
  const body = el('div', {});
  const ollama = settings.ollama || {};

  const url = el('input', {
    type: 'text',
    value: ollama.url || 'http://localhost:11434',
    onChange: (event) => set({ ollama: { ...store.state.settings.ollama, url: event.target.value.trim() } }),
  });

  const model = el('input', {
    type: 'text',
    value: ollama.model || 'qwen2.5vl:7b',
    onChange: (event) => set({ ollama: { ...store.state.settings.ollama, model: event.target.value.trim() } }),
  });

  const state = el('p', { class: 'settings-sub' });

  async function check() {
    state.textContent = 'Looking for Ollama…';
    const models = await ollamaModels(store.state.settings.ollama?.url);
    if (!models.length) {
      state.className = 'settings-sub sync-error';
      state.textContent = 'No answer. Start Ollama, and launch it with OLLAMA_ORIGINS set to this site — the README has the command.';
      return;
    }
    state.className = 'settings-sub is-ready';
    state.textContent = `Answering. Installed: ${models.join(', ')}`;
  }

  body.append(
    row('Use a local model', segmented(
      [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }],
      ollama.enabled ? 'on' : 'off',
      (id) => set({ ollama: { ...store.state.settings.ollama, enabled: id === 'on' } }),
    )),
    el('div', { class: 'field' }, [el('span', { class: 'label', text: 'Address' }), url]),
    el('div', { class: 'field' }, [el('span', { class: 'label', text: 'Model' }), model]),
    el('div', { class: 'field-row' }, [
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Check the connection', onClick: check }),
      // Settings sync, so an address set on one device follows to the others.
      // A one-tap way back to this machine saves retyping it.
      el('button', {
        class: 'btn btn-quiet btn-sm',
        type: 'button',
        text: 'Use this Mac',
        onClick: () => {
          url.value = 'http://localhost:11434';
          set({ ollama: { ...store.state.settings.ollama, url: url.value } });
          check();
        },
      }),
    ]),
    state,
  );

  return card(
    'Reading recipes with a model',
    'Ollama runs on this Mac: free, private, and offline. It cannot be reached from the iPad, so screenshots and pasted text are read here; links to sites that publish their recipe as data work on every device without it.',
    [body],
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
  toast('Packing everything up…');
  try {
    const blob = await makeBackup();
    download(blob, backupFilename());
    toast('Backup saved.');
  } catch (error) {
    console.warn('Could not build the backup.', error);
    toast('The backup could not be made.');
  }
}

function importBackup() {
  const input = el('input', { type: 'file', accept: '.zip,.json,application/zip,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    // eslint-disable-next-line no-alert
    if (!confirm('Replace everything on the desk with this backup?')) return;
    try {
      const counts = await restoreBackup(file);
      applyTheme(store.state.settings);
      toast(`Restored ${counts.recipes} recipes and ${counts.photos} photographs.`);
    } catch (error) {
      console.warn('Could not read that backup.', error);
      toast('That file could not be read.');
    }
  });
  input.click();
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
