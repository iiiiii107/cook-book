import './styles/app.css';
import { el, svg, clear } from './lib/dom.js';
import { store } from './lib/store.js';
import { applyTheme, toggleLight } from './lib/theme.js';
import { registerServiceWorker } from './lib/pwa.js';
import { restoreSession, onAccountChange, currentAccount } from './lib/sync.js';

import { renderDesk } from './views/desk.js';
import { renderBook } from './views/book.js';
import { renderRecipe } from './views/recipe.js';
import { renderSettings } from './views/settings.js';
import { renderPlan } from './views/plan.js';
import { renderImport } from './views/import.js';
import { renderCook } from './views/cook.js';

/* Hash routing, as in the other apps: GitHub Pages serves one file, so a
   real path would 404 on refresh. The route also lands on <body data-view>
   so the stylesheet can dress each screen differently. */

const ROUTES = [
  { pattern: /^\/?$/, view: 'desk', render: renderDesk },
  { pattern: /^\/book\/([^/]+)$/, view: 'book', render: renderBook },
  { pattern: /^\/recipe\/([^/]+)$/, view: 'recipe', render: renderRecipe },
  { pattern: /^\/cook\/([^/]+)$/, view: 'cook', render: renderCook },
  { pattern: /^\/plan$/, view: 'plan', render: renderPlan },
  { pattern: /^\/import$/, view: 'import', render: renderImport },
  { pattern: /^\/settings$/, view: 'settings', render: renderSettings },
];

const app = document.querySelector('#app');
let scene;

function chrome() {
  // The desk itself, the light falling on it, and the switch — all outside
  // the routed area, so turning a page never rebuilds them.
  app.append(el('div', { class: 'desk-surface', 'aria-hidden': 'true' }));
  app.append(el('div', { class: 'lighting', 'aria-hidden': 'true' }));
  scene = el('main', { class: 'scene' });
  app.append(scene);
  app.append(lightSwitch());
}

/** A blind pull-cord by day, a lamp by night. Same state, two gestures. */
function lightSwitch() {
  const host = el('button', { class: 'light-switch', type: 'button' });

  function paint() {
    // Built before the store has loaded, and repainted by the change event
    // the moment it has.
    if (!store.state) return;
    const { settings } = store.state;
    const night =
      settings.theme === 'dark' ||
      (settings.theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    const lit = settings.light !== 'off' && settings.light !== 'bulb';

    // Always the cord, in both themes. The lamp sat in the bottom-right
    // corner, which on a phone is exactly where the buttons are — you could
    // not reach Cook without pulling it.
    clear(host);
    host.className = 'light-switch cord';
    host.setAttribute(
      'aria-label',
      night
        ? settings.light === 'bulb' ? 'Turn the lamp off' : 'Turn the lamp on'
        : lit ? 'Close the shutters' : 'Open the shutters',
    );
    host.append(cordSvg(night ? settings.light !== 'bulb' : lit));
  }

  host.addEventListener('click', async () => {
    await store.updateSettings({ light: toggleLight(store.state.settings) });
    applyTheme(store.state.settings);
    paint();
  });

  store.addEventListener('change', paint);
  paint();
  return host;
}

function cordSvg(open) {
  // The cord hangs a little lower when the blinds are open — you have pulled
  // it down to let the light in.
  const length = open ? 150 : 118;
  return svg(
    'svg',
    { viewBox: '0 0 34 190', preserveAspectRatio: 'xMidYMin meet', 'aria-hidden': 'true' },
    [
      svg('path', {
        d: `M17 0 L17 ${length}`,
        stroke: 'rgba(0,0,0,.45)',
        'stroke-width': '2',
        fill: 'none',
      }),
      svg('circle', {
        cx: '17', cy: length + 10, r: '8',
        fill: 'var(--wood-3)', stroke: 'rgba(0,0,0,.35)', 'stroke-width': '1.5',
      }),
      svg('circle', { cx: '14.5', cy: length + 7, r: '2.4', fill: 'rgba(255,255,255,.35)' }),
    ],
  );
}

function go() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const query = new URLSearchParams(search);

  const route =
    ROUTES.map((r) => ({ r, m: path.match(r.pattern) })).find(({ m }) => m) ||
    { r: ROUTES[0], m: [] };

  document.body.dataset.view = route.r.view;
  clear(scene);
  route.r.render(scene, ...route.m.slice(1), query);
  scene.scrollTop = 0;
}

/* Re-render, unless a screen has asked to be left alone.

   Two screens manage their own redrawing: the editor, because a rebuild takes
   the caret with it, and cook mode, because a rebuild loses which step you are
   on. Every path that re-renders in the background has to respect that — an
   unguarded one here meant the auth state resolving a second after load tore
   cook mode down and rebuilt it. */
function maybeGo() {
  if (document.body.dataset.editing || document.body.dataset.cooking) return;
  go();
}

async function boot() {
  chrome();
  await store.init();
  applyTheme(store.state.settings);

  // The lamp and the shaft both depend on whether it is night, and "System"
  // means the OS can change that under us mid-session.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(store.state.settings);
    store.emit();
  });

  // Picking the session back up swaps the storage backend underneath, which
  // the store hears about as an ordinary change. Signing in is once per device.
  restoreSession().catch((err) => console.warn('Could not restore the session.', err));
  onAccountChange(() => {
    const account = currentAccount();
    // The greeting comes from the account once there is one, without
    // overwriting a name that was typed in by hand.
    if (account?.name && !store.state.settings.profile?.name) {
      store.updateSettings({
        profile: { name: account.name, email: account.email || '' },
      });
    }
    maybeGo();
  });

  window.addEventListener('hashchange', go);

  // A save normally means "re-render everything", which is what keeps two
  // tabs and two devices honest. Two screens hold that render and redraw
  // themselves instead: the editor, because a rebuild would take the caret
  // with it, and cook mode, because a rebuild would lose which step you are
  // on and drop you back at the top of the method mid-recipe.
  store.addEventListener('change', maybeGo);

  go();

  registerServiceWorker(import.meta.env.BASE_URL);
  offerClipboard();
}

/* If you have copied a recipe somewhere else, the app can notice and offer to
   read it — which is the whole of the "share to the app" story on iOS, where a
   web app cannot register as a share target however much one would like it to.
   Reading the clipboard needs a gesture and permission, so this only ever
   looks after you have clicked, and never asks twice in a session. */
function offerClipboard() {
  let asked = false;

  document.addEventListener('pointerdown', async function look() {
    if (asked || !navigator.clipboard?.readText) return;
    asked = true;
    document.removeEventListener('pointerdown', look);

    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;   // no permission, and that is a perfectly reasonable answer
    }

    const { looksLikeRecipe } = await import('./lib/import/index.js');
    if (!looksLikeRecipe(text)) return;

    const bar = el('div', { class: 'clip-offer' }, [
      el('span', { text: 'That looks like a recipe on your clipboard.' }),
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Bring it in',
        onClick: () => {
          bar.remove();
          location.hash = `#/import?text=${encodeURIComponent(text.slice(0, 6000))}`;
        },
      }),
      el('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', text: 'No',
        onClick: () => bar.remove(),
      }),
    ]);
    document.body.append(bar);
    setTimeout(() => bar.remove(), 15000);
  }, { once: false });
}

boot();
