import { store } from '../lib/store.js';
import { parseIngredient } from '../lib/recipe.js';

/* Editing happens on the page itself.

   The blocks are contenteditable in place, inside the same multi-column flow
   that reading uses, so a paragraph that grows past the bottom of a page runs
   onto the next one as you type — the same way it will look when you read it
   back. There is no separate editing layout to keep in step.

   Two things make that work:

   1. The global re-render is held while editing (body[data-editing]). A save
      normally rebuilds the view, which would take the caret with it.
   2. Enter is handled explicitly inside the lists. Left to the browser,
      plaintext-only editing inserts a newline rather than a new list item,
      and the numbering stops matching the steps. */

const SAVE_DELAY = 500;

/* `event.key` is the right way to read a key, but it is not universally
   reliable: some remote-desktop bridges, on-screen keyboards and IMEs send an
   empty key with only the legacy code filled in. Checking all three costs
   nothing and stops Enter silently doing nothing on someone's setup. */
const isKey = (event, name, legacy) =>
  event.key === name || event.code === name || event.keyCode === legacy;

const isEnter = (event) =>
  isKey(event, 'Enter', 13) || event.code === 'NumpadEnter';
const isBackspace = (event) => isKey(event, 'Backspace', 8);

export function attachEditor({ recipe, flow, paged }) {
  document.body.dataset.editing = '1';

  let timer = null;

  function scheduleCommit() {
    clearTimeout(timer);
    timer = setTimeout(() => commit(recipe, flow), SAVE_DELAY);
  }

  flow.addEventListener('input', () => {
    // Re-flow immediately so the text moves between pages as it is typed,
    // then follow the caret if it has just crossed onto a further page.
    paged.refresh();
    followCaret(paged);
    scheduleCommit();
  });

  // The title is one line. Enter there should move you on to the ingredients
  // rather than pushing a second line into the heading.
  flow.querySelector('[data-field="title"]')?.addEventListener('keydown', (event) => {
    if (!isEnter(event)) return;
    event.preventDefault();
    const first = flow.querySelector('[data-field="ingredients"] li');
    if (!first) return;
    const at = document.createRange();
    at.selectNodeContents(first);
    at.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(at);
    flow.querySelector('[data-field="ingredients"]').focus();
  });

  // Leaving a block is a natural moment to write it down.
  flow.addEventListener('focusout', () => {
    clearTimeout(timer);
    commit(recipe, flow);
  });

  flow.addEventListener('keydown', (event) => {
    if (isBackspace(event)) {
      if (mergeBackwards(event)) {
        paged.refresh();
        scheduleCommit();
      }
      return;
    }
    if (!isEnter(event)) return;
    const list = event.target.closest?.('[data-field="ingredients"], [data-field="steps"]')
      || flow.querySelector(':focus-within[data-field]');
    if (!list || !list.matches('ul, ol')) return;

    event.preventDefault();
    splitListItem(list);
    paged.refresh();
    followCaret(paged);
    scheduleCommit();
  });

  // Paste as plain text, so a recipe copied off a website doesn't arrive
  // wearing that website's markup.
  flow.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (text == null) return;
    event.preventDefault();
    document.execCommand('insertText', false, text);
  });

  // Only a brand-new recipe gets the caret placed for you. Stealing focus on
  // an existing one is how you end up typing an ingredient into the title.
  if (recipe.title === 'Untitled recipe' && !recipe.ingredients.length) {
    flow.querySelector('[data-field="title"]')?.focus();
  }

  // The scene is emptied on every route change; go with it.
  const observer = new MutationObserver(() => {
    if (document.contains(flow)) return;
    clearTimeout(timer);
    delete document.body.dataset.editing;
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Read the page back into the model. */
function commit(recipe, flow) {
  const title = flow.querySelector('[data-field="title"]')?.textContent.trim();
  const notes = flow.querySelector('[data-field="notes"]')?.innerText.trim() ?? '';

  const lines = (selector) =>
    [...flow.querySelectorAll(`[data-field="${selector}"] li`)]
      .map((li) => li.textContent.trim())
      .filter(Boolean);

  // Ids are reused positionally. They only matter for remembering what has
  // been crossed off in cook mode, and holding them steady while a line is
  // being retyped is worth more than being strictly correct about identity.
  const ingredients = lines('ingredients')
    .map((line, i) => {
      const parsed = parseIngredient(line);
      if (!parsed) return null;
      const existing = recipe.ingredients[i];
      return existing ? { ...parsed, id: existing.id } : parsed;
    })
    .filter(Boolean);

  const steps = lines('steps').map((text, i) => ({
    id: recipe.steps[i]?.id || `s${i}${Date.now().toString(36)}`,
    text,
  }));

  const unchanged =
    recipe.title === (title || 'Untitled recipe') &&
    recipe.notes === notes &&
    JSON.stringify(recipe.ingredients) === JSON.stringify(ingredients) &&
    JSON.stringify(recipe.steps) === JSON.stringify(steps);
  if (unchanged) return;

  store.updateRecipe(recipe.id, {
    title: title || 'Untitled recipe',
    notes,
    ingredients,
    steps,
  });
}

/* --- list editing ---------------------------------------------------------- */

/** Split the current list item at the caret, the way Enter ought to behave. */
function splitListItem(list) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;

  const range = selection.getRangeAt(0);
  const item = range.startContainer.nodeType === 1
    ? range.startContainer.closest('li')
    : range.startContainer.parentElement?.closest('li');
  if (!item) return;

  // Everything after the caret moves down into the new item.
  const tail = range.cloneRange();
  tail.setEndAfter(item.lastChild || item);
  const moved = tail.extractContents();

  const next = document.createElement('li');
  next.append(moved);
  item.after(next);

  const at = document.createRange();
  at.setStart(next, 0);
  at.collapse(true);
  selection.removeAllRanges();
  selection.addRange(at);
}

/**
 * Backspace at the very start of a list item joins it to the one above.
 * Without this the browser is free to delete the <li> outright and drop the
 * text with it, which loses a line you were only trying to reflow.
 * @returns {boolean} whether it handled the key
 */
function mergeBackwards(event) {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;

  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const item = (node.nodeType === 1 ? node : node.parentElement)?.closest('li');
  if (!item || !item.previousElementSibling) return false;

  // Only when the caret really is at the front of the item.
  const before = range.cloneRange();
  before.selectNodeContents(item);
  before.setEnd(range.startContainer, range.startOffset);
  if (before.toString().length > 0) return false;

  event.preventDefault();
  const previous = item.previousElementSibling;
  const at = document.createRange();
  at.selectNodeContents(previous);
  at.collapse(false);

  while (item.firstChild) previous.append(item.firstChild);
  item.remove();

  selection.removeAllRanges();
  selection.addRange(at);
  return true;
}

/**
 * Keep the page you are typing on in view — but only when the caret has
 * genuinely left the visible pages. Following it the moment the computed
 * column changes turns the page the instant a word wraps past the fold, which
 * reads as the book flipping ahead of you for no reason.
 */
function followCaret(paged) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;

  // Mid-turn the flow is mid-animation and any measurement is meaningless.
  if (paged.isTurning) return;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const flowBox = paged.flow.getBoundingClientRect();
  const stride = paged.pageSize.width + Number.parseFloat(
    getComputedStyle(paged.flow).columnGap || 0,
  );
  if (!stride) return;

  const column = Math.floor((rect.left - flowBox.left) / stride);
  const firstVisible = paged.spread * paged.perView;
  const lastVisible = firstVisible + paged.perView - 1;
  if (column >= firstVisible && column <= lastVisible) return;

  paged.goToSpread(Math.floor(column / paged.perView));
}
