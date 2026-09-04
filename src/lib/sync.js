import { clone, storage, withDefaults } from './storage.js';
import { assets } from './assets.js';

/* Sync, by way of a Google account.

   Signing in gives you your own private shelf: everything lives under your own
   user id and the security rules make that the only place you can read or
   write. Nobody, including whoever owns the site, can see anyone else's
   cookbooks.

   Two things differ from the sibling apps, and both are on purpose.

   Recipes are their own documents under `users/{uid}/recipes/{id}` rather than
   fields in one blob. A Firestore document is capped at 1 MB; doodle paths are
   large and a cookbook grows without limit, so one document would eventually
   stop saving — silently, and only for the person with the most recipes.

   Photographs never go into Firestore at all. They are blobs in Storage,
   mirrored from IndexedDB, with only the asset id in the recipe.

   The SDK is loaded on demand, so if sync is not configured — or you never
   sign in — none of it is downloaded. */

function readConfig() {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return null;
  try {
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return config?.apiKey && config?.projectId ? config : null;
  } catch {
    console.warn('VITE_FIREBASE_CONFIG is not valid JSON — sync stays off.');
    return null;
  }
}

const config = readConfig();

/** True when the site was built with a Firebase project attached. */
export function syncConfigured() {
  return config !== null;
}

let sdk = null;

async function firebase() {
  if (sdk) return sdk;

  const [app, auth, firestore, storageSdk] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
    import('firebase/storage'),
  ]);

  const instance = app.getApps().length ? app.getApp() : app.initializeApp(config);

  // Persistent cache: the app opens and works with no connection, and several
  // tabs share one copy rather than fighting over the lock.
  let db;
  try {
    db = firestore.initializeFirestore(instance, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = firestore.getFirestore(instance);
  }

  sdk = {
    auth,
    firestore,
    storageSdk,
    db,
    bucket: storageSdk.getStorage(instance),
    authInstance: auth.getAuth(instance),
  };
  return sdk;
}

/* The SDK, for the sharing module. Loaded on demand like everything else, and
   null until there is a project to talk to. */
export async function firebaseSdk() {
  return config ? firebase() : null;
}

/* ---------- the account ---------- */

const account = new EventTarget();
let currentUser = null;
let watching = false;
let lastError = null;

/** The signed-in user, or null. Only ever id, name, email and photo. */
export function currentAccount() {
  return currentUser;
}

/** Why sync is not working, in words worth showing someone. Null when fine. */
export function syncError() {
  return lastError;
}

function describe(err) {
  const message = String(err?.message || err);
  if (/has not been used in project|is disabled/i.test(message)) {
    return 'The Firestore database has not been created yet — make it in the Firebase console, then reload.';
  }
  if (err?.code === 'permission-denied' || /permission/i.test(message)) {
    return 'The database refused the write — check the security rules have been published.';
  }
  if (err?.code === 'unavailable' || /offline|network/i.test(message)) {
    return 'No connection. Your changes are saved here and will go up when it is back.';
  }
  return 'Sync could not start. Your cookbooks are safe in this browser.';
}

export function onAccountChange(fn) {
  account.addEventListener('change', fn);
  return () => account.removeEventListener('change', fn);
}

function announce() {
  account.dispatchEvent(new CustomEvent('change'));
}

/** Picks the session back up on load, so signing in is once per device. */
export async function restoreSession() {
  if (!config || watching) return;
  watching = true;

  const { auth, authInstance } = await firebase();

  // A redirect sign-in (phones, where popups get blocked) lands back here.
  try {
    await auth.getRedirectResult(authInstance);
  } catch (err) {
    console.warn('Sign-in did not complete.', err);
  }

  auth.onAuthStateChanged(authInstance, async (user) => {
    if (user) {
      currentUser = {
        uid: user.uid,
        name: user.displayName,
        email: user.email,
        photo: user.photoURL,
      };
      try {
        assets.useCloud(createPhotoCloud(user.uid));
        await storage.use(createCloudStorage(user.uid));
        lastError = null;
      } catch (err) {
        // Signed in, but the database will not have us. Stay on this browser
        // rather than losing the app — and say plainly what went wrong.
        console.warn('Sync could not start.', err);
        lastError = describe(err);
        assets.useCloud(null);
        await storage.use(null);
      }
    } else {
      currentUser = null;
      lastError = null;
      photoSync = PHOTO_SYNC.UNKNOWN;
      assets.useCloud(null);
      await storage.use(null);
    }
    announce();
  });
}

/** Google sign-in. Tries a popup, falls back to a redirect where popups die. */
export async function signIn() {
  if (!config) throw new Error('Sync is not set up for this site.');

  const { auth, authInstance } = await firebase();
  await restoreSession();

  const provider = new auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(authInstance, provider);
  } catch (err) {
    const fallback = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment',
    ];
    if (fallback.includes(err?.code)) {
      await auth.signInWithRedirect(authInstance, provider);
      return;
    }
    throw err;
  }
}

export async function signOutOfSync() {
  const { auth, authInstance } = await firebase();
  await auth.signOut(authInstance);
}

/* ---------- photographs ---------- */

/* Photographs are the one thing that needs Firebase Storage, and Storage is
   the one thing that needs a paid plan. Everything else — cookbooks, recipes,
   the plan, doodles, stickers — syncs perfectly well on the free tier.

   So this is not assumed to work. The first upload finds out; if Storage is
   not there, photo sync switches itself off for the session and says so,
   rather than retrying forever and filling the console with failures. The
   photographs stay on the device that took them, and travel in the .zip
   backup, which is exactly what happens with sync off entirely. */

export const PHOTO_SYNC = { UNKNOWN: 'unknown', ON: 'on', UNAVAILABLE: 'unavailable' };

let photoSync = PHOTO_SYNC.UNKNOWN;

/** Whether photographs are following you between devices, and if not, why. */
export function photoSyncState() {
  return photoSync;
}

/** A Storage failure that means "the bucket isn't there", not "try again". */
function storageMissing(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || err);
  return code.includes('unknown')
    || code.includes('unauthorized')
    || code.includes('project-not-found')
    || /storage\/(unknown|unauthorized)|no bucket|not been set up|does not exist/i.test(message);
}

function createPhotoCloud(uid) {
  return {
    async upload(id, blob) {
      if (photoSync === PHOTO_SYNC.UNAVAILABLE) return;
      try {
        const { storageSdk, bucket } = await firebase();
        const ref = storageSdk.ref(bucket, `users/${uid}/assets/${id}`);
        await storageSdk.uploadBytes(ref, blob, { contentType: blob.type || 'image/webp' });
        photoSync = PHOTO_SYNC.ON;
      } catch (err) {
        if (!storageMissing(err)) throw err;
        photoSync = PHOTO_SYNC.UNAVAILABLE;
        console.info(
          'Firebase Storage is not enabled on this project, so photographs stay '
          + 'on the device that added them. Everything else still syncs.',
        );
        announce();
      }
    },

    async download(id) {
      if (photoSync === PHOTO_SYNC.UNAVAILABLE) return null;
      const { storageSdk, bucket } = await firebase();
      const ref = storageSdk.ref(bucket, `users/${uid}/assets/${id}`);
      const url = await storageSdk.getDownloadURL(ref);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Photo ${id} could not be fetched.`);
      return response.blob();
    },

    async remove(id) {
      if (photoSync === PHOTO_SYNC.UNAVAILABLE) return;
      const { storageSdk, bucket } = await firebase();
      await storageSdk.deleteObject(storageSdk.ref(bucket, `users/${uid}/assets/${id}`));
    },
  };
}

/* ---------- the cloud backend ---------- */

/**
 * Everything but the recipes lives in `users/{uid}/app/state`; each recipe is
 * its own document under `users/{uid}/recipes/{id}`. The four methods below
 * hide that from the rest of the app, so `storage` cannot tell the difference
 * between this and the browser.
 */
export function createCloudStorage(uid) {
  const listeners = new Set();
  let cached = null;
  let stopState = null;
  let stopRecipes = null;
  let writing = 0;

  // What each recipe looked like when it was last written. Saving happens on
  // every keystroke's debounce; without this, every save would rewrite every
  // recipe in the book.
  const written = new Map();

  async function refs() {
    const { firestore, db } = await firebase();
    return {
      f: firestore,
      // 'cookbook', not 'state'. All three apps share one Firebase project,
      // and 10-minutes-to-spare already owns users/{uid}/app/state — writing
      // there would silently overwrite the habit tracker on first sign-in.
      // calendartospare uses 'calendar' for the same reason.
      state: firestore.doc(db, 'users', uid, 'app', 'cookbook'),
      recipes: firestore.collection(db, 'users', uid, 'recipes'),
    };
  }

  function fanOut(next) {
    cached = next;
    listeners.forEach((fn) => fn(next));
  }

  async function watch() {
    if (stopState) return;
    const { f, state, recipes } = await refs();

    stopState = f.onSnapshot(state, (snap) => {
      // Our own write comes back as an echo; we already have that state.
      if (snap.metadata.hasPendingWrites || writing > 0 || !snap.exists()) return;
      const incoming = withDefaults(JSON.parse(snap.data().payload || '{}'));
      fanOut({ ...incoming, recipes: cached?.recipes || [] });
    }, (err) => console.warn('Sync listener stopped.', err));

    stopRecipes = f.onSnapshot(recipes, (snap) => {
      if (snap.metadata.hasPendingWrites || writing > 0) return;
      const list = snap.docs.map((d) => d.data());
      for (const recipe of list) written.set(recipe.id, JSON.stringify(recipe));
      fanOut({ ...(cached || withDefaults({})), recipes: list });
    }, (err) => console.warn('Recipe listener stopped.', err));
  }

  return {
    kind: 'cloud',

    async load() {
      const { f, state, recipes } = await refs();
      const [stateSnap, recipeSnap] = await Promise.all([
        f.getDoc(state),
        f.getDocs(recipes),
      ]);

      if (stateSnap.exists()) {
        const base = withDefaults(JSON.parse(stateSnap.data().payload || '{}'));
        const list = recipeSnap.docs.map((d) => d.data());
        for (const recipe of list) written.set(recipe.id, JSON.stringify(recipe));
        cached = { ...base, recipes: list };
      } else {
        // First sign-in on this account: whatever is already in this browser
        // becomes the starting point, so nothing entered is lost.
        cached = withDefaults(clone(await storage.local.load()));
        await this.save(cached);
      }

      watch();
      return cached;
    },

    async save(next) {
      cached = next;
      const { f, state, recipes } = await refs();
      writing += 1;

      try {
        await f.setDoc(state, {
          // The recipes are deliberately not in here — they are their own
          // documents, and a copy in the blob would be a second source of
          // truth that could disagree with them.
          payload: JSON.stringify({ ...next, recipes: [] }),
          updatedAt: f.serverTimestamp(),
        });

        const seen = new Set();
        for (const recipe of next.recipes || []) {
          seen.add(recipe.id);
          const encoded = JSON.stringify(recipe);
          if (written.get(recipe.id) === encoded) continue;
          await f.setDoc(f.doc(recipes, recipe.id), recipe);
          written.set(recipe.id, encoded);
        }

        for (const id of [...written.keys()]) {
          if (seen.has(id)) continue;
          await f.deleteDoc(f.doc(recipes, id));
          written.delete(id);
        }
      } catch (err) {
        console.warn('Could not sync — it will go up when you are back online.', err);
      } finally {
        writing -= 1;
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async exportAll() {
      return JSON.stringify(cached || {}, null, 2);
    },

    async importAll(json) {
      await this.save(withDefaults(JSON.parse(json)));
    },

    stop() {
      stopState?.();
      stopRecipes?.();
      stopState = null;
      stopRecipes = null;
    },
  };
}
