import './styles/app.css';
import { el, svg, clear } from './lib/dom.js';
import { store } from './lib/store.js';
import { applyTheme, toggleLight } from './lib/theme.js';
import { registerServiceWorker } from './lib/pwa.js';

import { renderDesk } from './views/desk.js';
import { renderBook } from './views/book.js';
import { renderRecipe } from './views/recipe.js';
import { renderSettings } from './views/settings.js';
import { renderPlan } from './views/plan.js';
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

    clear(host);
    host.className = `light-switch ${night ? 'lamp' : 'cord'}`;
    host.setAttribute(
      'aria-label',
      night
        ? settings.light === 'bulb' ? 'Turn the lamp off' : 'Turn the lamp on'
        : lit ? 'Close the shutters' : 'Open the shutters',
    );
    host.append(night ? lampSvg(settings.light === 'bulb') : cordSvg(lit));
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

function lampSvg(on) {
  const glow = on ? 'var(--lemon)' : 'var(--paper-edge)';
  return svg(
    'svg',
    { viewBox: '0 0 92 108', preserveAspectRatio: 'xMidYMax meet', 'aria-hidden': 'true' },
    [
      on &&
        svg('ellipse', {
          cx: '46', cy: '52', rx: '44', ry: '40',
          fill: 'var(--lemon)', opacity: '.22',
        }),
      // shade
      svg('path', {
        d: 'M22 46 L34 16 L58 16 L70 46 Z',
        fill: glow, stroke: 'var(--ink-deep)', 'stroke-width': '2.4',
        'stroke-linejoin': 'round',
      }),
      // stem and base
      svg('path', {
        d: 'M46 46 L46 92 M26 96 L66 96',
        stroke: 'var(--ink-deep)', 'stroke-width': '3',
        'stroke-linecap': 'round', fill: 'none',
      }),
      svg('ellipse', { cx: '46', cy: '99', rx: '22', ry: '6', fill: 'var(--ink-deep)' }),
    ].filter(Boolean),
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

  window.addEventListener('hashchange', go);

  // A save normally means "re-render everything", which is what keeps two
  // tabs and two devices honest. Two screens hold that render and redraw
  // themselves instead: the editor, because a rebuild would take the caret
  // with it, and cook mode, because a rebuild would lose which step you are
  // on and drop you back at the top of the method mid-recipe.
  store.addEventListener('change', () => {
    const held = document.body.dataset.editing === '1'
      || document.body.dataset.cooking === '1';
    if (!held) go();
  });

  go();

  registerServiceWorker(import.meta.env.BASE_URL);
}

boot();
