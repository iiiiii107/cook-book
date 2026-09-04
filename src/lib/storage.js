/* Storage adapter.

   Lifted wholesale from 10minutestospare, because the shape has already
   earned its keep there: everything goes through `storage`, never through
   localStorage directly, and `storage` is a facade over one backend at a
   time — the browser when signed out, Firestore when signed in. Swapping the
   backend is the whole of "turning sync on"; no view knows which is under it.

   Photos are the one thing that never travels through here. They are blobs,
   they are large, and they live in IndexedDB and Firebase Storage instead —
   see assets.js. What passes through this file is JSON and stays small. */

const KEY = 'cookbook:data:v1';

export const DEFAULT_SETTINGS = {
  // Filled from the Google account once sync is on; until then it is whatever
  // you type in settings, and an empty name simply means "Chef".
  profile: { name: '', email: '' },
  theme: 'system',       // system | light | dark
  light: 'on',           // on | off (blinds closed) | bulb
  // The sun across the desk, and the cord that changes it, are separate
  // things. The shaft is the look of the app and stays on; the cord is a
  // conceit, and it starts out of the way — most people meet the app without
  // wanting to work out what a dangling string does.
  lighting: true,
  lightSwitch: false,
  wood: 'oak',
  palette: {},           // colour overrides, written onto <html> at boot
  fontDisplay: 'garamond',
  fontBody: 'inter',
  textScale: 1,
  toolStyles: {
    pencil: { ink: '#6B6660', width: 1.8 },
    crayon: { ink: '#46607A', width: 5.5 },
    highlighter: { ink: '#E8C84E', width: 15 },
  },
  ollama: {
    enabled: false,
    url: 'http://localhost:11434',
    // A vision model, because reading a screenshot is the only way to get a
    // recipe off Instagram or TikTok — those pages cannot be fetched at all.
    model: 'qwen2.5vl:7b',
  },
};

/* The two meals everybody starts with.

   Both are the same idea: an evening where the cooking is somebody else's
   problem. They are on the sheet so a day is not left looking unplanned, and
   they are off the shopping list because there is nothing to buy for them —
   which is the whole reason they are worth providing rather than leaving
   everyone to type them in.

   Given once and then owned outright: rename them, add ingredients, delete
   them. Fixed ids so two devices seeding at the same moment collide into one
   rather than leaving a pair of duplicates behind. */
export const BUILT_IN_STANDBYS = [
  { id: 'eating-out', name: 'Eating out', ingredients: [], onList: false },
  { id: 'take-out', name: 'Take out', ingredients: [], onList: false },
];

export const DEFAULT_STATE = {
  version: 1,
  books: [],
  recipes: [],
  plan: {},              // 'YYYY-MM-DD' -> { breakfast: [], lunch: [], dinner: [] }
  // Meals that are not in any cookbook — a jam sandwich, leftovers, the
  // Tuesday takeaway. Kept beside the plan rather than inside it, because the
  // point of them is that they come back week after week.
  standbys: [],          // { id, name, ingredients: [], onList }
  // Whether the two the app provides have been handed over yet. Once, not on
  // every load — deleting one has to mean it stays deleted.
  standbysSeeded: false,
  settings: DEFAULT_SETTINGS,
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fills in anything a stored payload predates, so old saves keep working. */
/* The provided meals, added the first time and never again, and never twice.

   Keyed by id so a state that already carries one — restored from a backup,
   or arrived from another device mid-seed — keeps the version it has rather
   than gaining a second copy under the same name. */
function seedStandbys(data) {
  const own = data.standbys || [];
  if (data.standbysSeeded) return own;

  const mine = new Map(own.map((s) => [s.id, s]));
  const builtInIds = new Set(BUILT_IN_STANDBYS.map((s) => s.id));

  // A copy already in hand wins over the one being offered, so an edit made
  // before the state was marked seeded is not undone by the seeding.
  return [
    ...BUILT_IN_STANDBYS.map((s) => mine.get(s.id) || s),
    ...own.filter((s) => !builtInIds.has(s.id)),
  ];
}

export function withDefaults(data) {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  settings.toolStyles = { ...DEFAULT_SETTINGS.toolStyles, ...(settings.toolStyles || {}) };
  settings.ollama = { ...DEFAULT_SETTINGS.ollama, ...(settings.ollama || {}) };
  settings.profile = { ...DEFAULT_SETTINGS.profile, ...(settings.profile || {}) };
  settings.palette = { ...(settings.palette || {}) };

  return {
    ...DEFAULT_STATE,
    ...data,
    books: data.books || [],
    recipes: data.recipes || [],
    plan: data.plan || {},
    standbys: seedStandbys(data),
    standbysSeeded: true,
    settings,
  };
}

export function createLocalStorage() {
  const listeners = new Set();

  /* Everything goes through withDefaults, including an empty desk. Handing a
     first-time visitor a bare clone of DEFAULT_STATE looks equivalent and is
     not: it skips the normaliser, so anything set up there — the two meals the
     app provides, and every future default — reached returning users only. */
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return withDefaults(raw ? JSON.parse(raw) : {});
    } catch {
      return withDefaults({});
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save — storage may be full or blocked.', err);
    }
    listeners.forEach((fn) => fn(state));
  }

  // Another tab saving counts as a remote change; mirror it into this one.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) listeners.forEach((fn) => fn(read()));
  });

  return {
    kind: 'local',
    load: async () => read(),
    save: async (state) => write(state),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async exportAll() {
      return JSON.stringify(read(), null, 2);
    },
    async importAll(json) {
      write(withDefaults(JSON.parse(json)));
    },
  };
}

/* The facade. Subscribers register here rather than with a backend, so they
   survive a swap: signing in replaces what's underneath and everyone is
   handed the cloud's copy of the state. */

const local = createLocalStorage();
let backend = local;
const listeners = new Set();
let detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

export const storage = {
  get kind() {
    return backend.kind;
  },
  load: (...args) => backend.load(...args),
  save: (...args) => backend.save(...args),
  exportAll: () => backend.exportAll(),
  importAll: (json) => backend.importAll(json),

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** The signed-out backend, for seeding the cloud on first sign-in. */
  local,

  /**
   * Put a different backend underneath and hand everyone its state.
   * @param {object} next a backend, or null to go back to this browser only
   */
  async use(next) {
    const chosen = next || local;
    if (chosen === backend) return backend.load();

    detach?.();
    backend = chosen;
    detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

    const state = await backend.load();
    listeners.forEach((fn) => fn(state));
    return state;
  },
};
