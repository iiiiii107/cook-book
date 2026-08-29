/* Getting a recipe in from somewhere else.

   One interface with several ways in, tried cheapest first:

     a page with JSON-LD   exact, instant, free, works on every device
     a page without it     the readable text goes to the model
     pasted text           the same, without needing to fetch anything
     a screenshot          a vision model reads it — the only thing that
                           actually solves Instagram and TikTok, since those
                           are login-walled and no proxy can reach them

   Everything lands on a review screen before it is saved. A model that has
   misread a quantity should be corrected while the source is still in front of
   you, not discovered halfway through cooking. */

import { recipeFromHtml, textFromHtml } from './jsonld.js';
import { extractWithOllama, ollamaAvailable } from './ollama.js';

/**
 * Is this page allowed to talk to a program on your own machine at all?
 *
 * Browsers refuse to let an HTTPS page reach http://localhost — it is a
 * deliberate protection, not a bug, and no header or setting on Ollama's side
 * can lift it. So AI import works when the app is served locally and cannot
 * work from the deployed site, whatever Ollama is doing. Saying so is far
 * better than a request that fails for no visible reason.
 */
export function localModelReachable(ollamaUrl) {
  // From an http page — the local copy — anything goes.
  if (location.protocol !== 'https:') return true;
  // From an https page, only an https address is allowed. A tunnel gives
  // Ollama one, which is what makes this work from the deployed site and from
  // the iPad; plain http://localhost is blocked and no setting changes that.
  return /^https:/i.test(String(ollamaUrl || ''));
}

/** Where the page fetcher lives. Empty until the Worker is deployed. */
export function proxyUrl() {
  return import.meta.env.VITE_FETCH_PROXY || '';
}

export function proxyConfigured() {
  return Boolean(proxyUrl());
}

/**
 * What can be done right now, so the import screen can say so rather than
 * offering something that will fail.
 */
export async function importCapabilities(settings) {
  const ollama = settings?.ollama || {};
  const reachable = localModelReachable(ollama.url);
  return {
    proxy: proxyConfigured(),
    blockedByOrigin: !reachable,
    ollama: reachable && ollama.enabled ? await ollamaAvailable(ollama.url) : false,
    model: ollama.model,
  };
}

async function fetchPage(url) {
  if (!proxyConfigured()) {
    throw new Error(
      'Reading a web page needs the fetch helper, which is not set up yet. '
      + 'Paste the recipe text instead — that always works.',
    );
  }

  const response = await fetch(`${proxyUrl()}?url=${encodeURIComponent(url)}`);
  if (response.ok) return response.text();

  // Plenty of recipe sites refuse anything that is not a person with a
  // browser — Serious Eats and Allrecipes among them. That is their right,
  // and there is a perfectly good way round it that does not involve
  // pretending to be something else.
  const body = await response.text().catch(() => '');
  if (/40[13]/.test(body) || response.status === 403) {
    throw new Error(
      'That site will not let the app fetch its pages. Open the recipe, copy '
      + 'the text, and paste it below — or take a screenshot.',
    );
  }
  if (/404/.test(body)) {
    throw new Error('That page was not found. Check the link, or paste the recipe text instead.');
  }
  throw new Error(`That page could not be fetched (${response.status}). Paste the text instead.`);
}

/**
 * Import from a link.
 * @returns {Promise<{recipe: object, how: 'structured'|'model'}>}
 */
export async function importFromUrl(url, settings) {
  const html = await fetchPage(url);

  // The free, exact path first. Where a site publishes its recipe as data
  // there is nothing to infer and nothing for a model to get wrong.
  const structured = recipeFromHtml(html, url);
  if (structured) return { recipe: structured, how: 'structured' };

  const text = textFromHtml(html).slice(0, 12000);
  const recipe = await importFromText(text, settings);
  recipe.recipe.sourceUrl = url;
  return recipe;
}

/** Import from words — pasted, or scraped off a page with no structured data. */
export async function importFromText(text, settings) {
  const ollama = settings?.ollama || {};
  if (!localModelReachable(ollama.url)) {
    throw new Error(
      'This page is served over HTTPS, so it can only reach the model at an '
      + 'https address. Start the tunnel and paste the address it prints into '
      + 'Settings — or use the local copy of the app.',
    );
  }
  if (!ollama.enabled) {
    throw new Error('Turn on Ollama in settings to read a recipe from text.');
  }
  if (!await ollamaAvailable(ollama.url)) {
    throw new Error(
      'Ollama is not answering. Start it, and make sure it was launched with '
      + 'OLLAMA_ORIGINS set to this site.',
    );
  }

  const recipe = await extractWithOllama({
    url: ollama.url,
    model: ollama.model,
    text: String(text).slice(0, 12000),
  });
  return { recipe, how: 'model' };
}

/**
 * Import from a screenshot. This is the path that works for social media,
 * because those pages cannot be fetched at all.
 */
export async function importFromImage(file, settings) {
  const ollama = settings?.ollama || {};
  if (!localModelReachable(ollama.url)) {
    throw new Error(
      'This page is served over HTTPS, so it can only reach the model at an '
      + 'https address. Start the tunnel and paste the address it prints into '
      + 'Settings — or use the local copy of the app.',
    );
  }
  if (!ollama.enabled) {
    throw new Error('Turn on Ollama in settings to read a recipe from a picture.');
  }
  if (!await ollamaAvailable(ollama.url)) {
    throw new Error('Ollama is not answering. Start it and try again.');
  }

  const recipe = await extractWithOllama({
    url: ollama.url,
    model: ollama.model,
    image: await toBase64(await shrink(file)),
  });
  return { recipe, how: 'model' };
}

/* A phone screenshot is far larger than a model needs, and every extra pixel
   is time spent encoding it, sending it and reading it. */
async function shrink(file, maxEdge = 1400) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 900_000) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // Ollama wants the payload only, without the data: prefix.
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Does what is on the clipboard look like a recipe worth offering to import? */
export function looksLikeRecipe(text) {
  const body = String(text || '');
  if (body.length < 60 || body.length > 20000) return false;

  // A quantity with a unit, and several lines. Prose about a holiday has
  // neither; a caption from a cooking account has both.
  const quantities = body.match(/\b\d+\s*(g|kg|ml|l|tbsp|tsp|cups?|oz|lb)\b/gi) || [];
  const lines = body.split(/\n/).filter((l) => l.trim()).length;
  return quantities.length >= 2 && lines >= 4;
}
