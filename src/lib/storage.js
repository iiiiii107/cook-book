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

export const DEFAULT_STATE = {
  version: 1,
  books: [],
  recipes: [],
  plan: {},              // 'YYYY-MM-DD' -> { breakfast: [], lunch: [], dinner: [] }
  settings: DEFAULT_SETTINGS,
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fills in anything a stored payload predates, so old saves keep working. */
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
    settings,
  };
}

export function createLocalStorage() {
  const listeners = new Set();

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? withDefaults(JSON.parse(raw)) : clone(DEFAULT_STATE);
    } catch {
      return clone(DEFAULT_STATE);
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
