/* Backup, with the photographs in it.

   The JSON export this replaces was honest about everything except the one
   thing you cannot retype: your pictures live in IndexedDB, not in the state
   blob, so a JSON backup restored onto a new machine came back with every
   photograph missing. A backup that quietly loses things is worse than no
   backup, so this is a zip: the state, and every photograph beside it. */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { storage } from './storage.js';
import { assets } from './assets.js';

const STATE = 'cookbook.json';
const PHOTOS = 'photos/';
const MANIFEST = 'manifest.json';

export const BACKUP_VERSION = 1;

/** Everything, as a zip. */
export async function makeBackup() {
  const json = await storage.exportAll();
  const photos = await assets.all();

  const files = {
    [STATE]: strToU8(json),
    [MANIFEST]: strToU8(JSON.stringify({
      app: 'cook-book',
      version: BACKUP_VERSION,
      created: new Date().toISOString(),
      photos: photos.length,
    }, null, 2)),
  };

  for (const { id, blob } of photos) {
    if (!blob) continue;
    files[`${PHOTOS}${id}${extensionFor(blob.type)}`] =
      new Uint8Array(await blob.arrayBuffer());
  }

  // Photographs are already WebP or JPEG, so they are incompressible; asking
  // deflate to try again only costs time. The JSON is worth compressing.
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

function extensionFor(type) {
  if (type === 'image/webp') return '.webp';
  if (type === 'image/png') return '.png';
  return '.jpg';
}

function typeFor(name) {
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/**
 * Read a backup back in. Everything currently on the desk is replaced.
 * @returns {Promise<{recipes: number, books: number, photos: number}>}
 */
export async function restoreBackup(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // A .json from the older export is still a valid backup — just one without
  // any photographs in it. Refusing to read it would be gratuitous.
  if (looksLikeJson(bytes)) {
    const json = strFromU8(bytes);
    await storage.importAll(json);
    const state = JSON.parse(json);
    return { books: state.books?.length || 0, recipes: state.recipes?.length || 0, photos: 0 };
  }

  const files = unzipSync(bytes);
  const state = files[STATE];
  if (!state) throw new Error('That zip is not a Cook Book backup.');

  const json = strFromU8(state);
  await storage.importAll(json);

  let photos = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(PHOTOS) || !data.length) continue;
    const id = name.slice(PHOTOS.length).replace(/\.[a-z]+$/i, '');
    await assets.put(id, new Blob([data], { type: typeFor(name) }));
    photos += 1;
  }

  const parsed = JSON.parse(json);
  return { books: parsed.books?.length || 0, recipes: parsed.recipes?.length || 0, photos };
}

function looksLikeJson(bytes) {
  // A zip always begins "PK"; JSON, once whitespace is skipped, begins { or [.
  for (const byte of bytes.subarray(0, 8)) {
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) continue;
    return byte === 0x7b || byte === 0x5b;
  }
  return false;
}

export function backupFilename() {
  return `cook-book-${new Date().toISOString().slice(0, 10)}.zip`;
}
