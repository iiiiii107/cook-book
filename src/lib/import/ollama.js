/* Reading a recipe out of text or a photograph, using a model on your own Mac.

   Ollama serves an HTTP API on localhost. Nothing leaves the machine, there is
   no key and no bill, and it works with no connection.

   What it cannot do is reach your iPad: a page served over HTTPS may not call
   http://192.168.x.x — that is mixed content, and browsers block it outright —
   and Safari blocks even http://localhost. So this is Chrome on the Mac. Every
   other way in (typing it out, a .md file, a page with JSON-LD) works
   everywhere, so no device is ever locked out of adding a recipe.

   Ollama also has to be started with OLLAMA_ORIGINS set to this site, or the
   browser's request is refused before it arrives. See the README. */

import { parseIngredient, newRecipe } from '../recipe.js';

/* The model is asked for exactly this shape, and Ollama constrains it to fit.
   Asking for JSON in the prompt and hoping is how you end up parsing an
   apology; a schema means the reply either matches or the request failed. */
const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    servings: { type: 'integer' },
    prepMinutes: { type: 'integer' },
    cookMinutes: { type: 'integer' },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['title', 'ingredients', 'steps'],
};

const SYSTEM = [
  'You read recipes and return them as structured data.',
  'Copy the quantities exactly as written; never convert, round or invent them.',
  'Each ingredient is one string, as a cook would write it: "400 g spaghetti".',
  'Each step is one instruction, in order, without its number.',
  'If something is genuinely not stated, leave it out rather than guessing.',
  'Put anything that is advice rather than an instruction into notes.',
].join(' ');

/** Is Ollama running and reachable from this page? */
export async function ollamaAvailable(url) {
  try {
    const response = await fetch(`${trim(url)}/api/tags`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/** Which models are installed, so settings can offer the real list. */
export async function ollamaModels(url) {
  try {
    const response = await fetch(`${trim(url)}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models || []).map((m) => m.name).sort();
  } catch {
    return [];
  }
}

function trim(url) {
  return String(url || 'http://localhost:11434').replace(/\/+$/, '');
}

/**
 * Ask the model to read a recipe.
 * @param {object} options
 * @param {string} options.url where Ollama is
 * @param {string} options.model which model to use
 * @param {string} [options.text] the recipe as words
 * @param {string} [options.image] a screenshot, base64 without the data: prefix
 * @param {AbortSignal} [options.signal]
 */
export async function extractWithOllama({ url, model, text, image, signal }) {
  const prompt = image
    ? 'Read the recipe in this image and return it as structured data.'
    : `Read this recipe and return it as structured data.\n\n${text}`;

  const response = await fetch(`${trim(url)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: SCHEMA,
      options: {
        // Extraction is not a creative task: the same page should give the
        // same recipe every time.
        temperature: 0,
      },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt, ...(image ? { images: [image] } : {}) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await describeFailure(response, model));
  }

  const data = await response.json();
  let parsed;
  try {
    parsed = JSON.parse(data.message?.content || '{}');
  } catch {
    throw new Error('The model did not return a recipe. Try again, or use a larger model.');
  }
  return toRecipe(parsed);
}

async function describeFailure(response, model) {
  const body = await response.text().catch(() => '');
  if (response.status === 404 || /not found|no such model/i.test(body)) {
    return `Ollama does not have "${model}". Run: ollama pull ${model}`;
  }
  if (response.status === 403) {
    return 'Ollama refused the request. Start it with OLLAMA_ORIGINS set to this site — see the README.';
  }
  return `Ollama could not read that (${response.status}).`;
}

/** The model's answer, turned into one of ours. */
export function toRecipe(data, { bookId } = {}) {
  const recipe = newRecipe({ bookId, title: String(data.title || '').trim() || 'Untitled recipe' });

  const servings = Number.parseInt(data.servings, 10);
  if (Number.isFinite(servings) && servings > 0 && servings < 100) recipe.servings = servings;

  recipe.time = {
    prep: clampMinutes(data.prepMinutes),
    cook: clampMinutes(data.cookMinutes),
  };

  for (const line of data.ingredients || []) {
    // Everything is parsed on the way in, so an imported recipe can be scaled
    // and added to a shopping list exactly like one typed by hand.
    const parsed = parseIngredient(String(line));
    if (parsed) recipe.ingredients.push(parsed);
  }

  (data.steps || []).forEach((text, i) => {
    const clean = String(text).replace(/^\s*\d+[.)]\s*/, '').trim();
    if (clean) recipe.steps.push({ id: `s${i}${Date.now().toString(36)}`, text: clean });
  });

  const notes = String(data.notes || '').trim();
  if (notes) recipe.notes = notes;

  return recipe;
}

function clampMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  return Number.isFinite(minutes) && minutes > 0 && minutes < 6000 ? minutes : 0;
}
