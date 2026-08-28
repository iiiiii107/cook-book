import { storage } from './storage.js';
import { newBook, newRecipe } from './recipe.js';
import { uid } from './dom.js';

const MEAL_IDS = ['breakfast', 'lunch', 'dinner'];

/* Single source of truth, in the shape 10minutestospare uses: views read
   `store.state`, call an action, and re-render on the change event. No view
   mutates state directly, so a change from another tab or another device
   lands the same way a local edit does. */

class Store extends EventTarget {
  constructor() {
    super();
    this.state = null;
    this.ready = false;
  }

  async init() {
    this.state = await storage.load();
    this.ready = true;
    storage.subscribe((incoming) => {
      this.state = incoming;
      this.emit();
    });
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  async persist() {
    await storage.save(this.state);
    this.emit();
  }

  // ---- books -------------------------------------------------------------

  addBook(fields) {
    const book = newBook(fields);
    this.state.books.push(book);
    this.persist();
    return book;
  }

  updateBook(id, patch) {
    const book = this.bookById(id);
    if (book) Object.assign(book, patch);
    return this.persist();
  }

  /** A book takes its recipes with it. Nothing is left orphaned in state. */
  deleteBook(id) {
    this.state.books = this.state.books.filter((b) => b.id !== id);
    this.state.recipes = this.state.recipes.filter((r) => r.bookId !== id);
    return this.persist();
  }

  // ---- recipes -----------------------------------------------------------

  addRecipe(fields) {
    const recipe = newRecipe(fields);
    this.state.recipes.push(recipe);
    this.persist();
    return recipe;
  }

  updateRecipe(id, patch) {
    const recipe = this.recipeById(id);
    if (!recipe) return this.persist();
    Object.assign(recipe, patch, { updatedAt: new Date().toISOString() });
    return this.persist();
  }

  deleteRecipe(id) {
    this.state.recipes = this.state.recipes.filter((r) => r.id !== id);
    return this.persist();
  }

  // ---- decoration --------------------------------------------------------

  /**
   * Add a sticker, photo, doodle or scrap of text to a page. `origin` records
   * whether it was placed while customising or while actually cooking — the
   * splatters of a Tuesday night are worth being able to tell apart.
   */
  addElement(recipeId, element) {
    const recipe = this.recipeById(recipeId);
    if (!recipe) return this.persist();
    if (!recipe.elements) recipe.elements = [];
    recipe.elements.push(element);
    recipe.updatedAt = new Date().toISOString();
    return this.persist();
  }

  updateElement(recipeId, elementId, patch) {
    const element = this.recipeById(recipeId)?.elements?.find((e) => e.id === elementId);
    if (element) Object.assign(element, patch);
    return this.persist();
  }

  removeElement(recipeId, elementId) {
    const recipe = this.recipeById(recipeId);
    if (!recipe?.elements) return this.persist();
    recipe.elements = recipe.elements.filter((e) => e.id !== elementId);
    return this.persist();
  }

  // ---- the planning sheet -------------------------------------------------

  /** What is planned for one meal on one day. */
  plannedFor(date, meal) {
    return this.state.plan?.[date]?.[meal] || [];
  }

  /**
   * Put a recipe, or a plain note, into a slot.
   * @param {string} date 'YYYY-MM-DD'
   * @param {string} meal breakfast | lunch | dinner
   * @param {{recipeId?: string, text?: string, servings?: number}} entry
   */
  addToPlan(date, meal, entry) {
    if (!this.state.plan) this.state.plan = {};
    if (!this.state.plan[date]) this.state.plan[date] = {};
    if (!this.state.plan[date][meal]) this.state.plan[date][meal] = [];
    this.state.plan[date][meal].push({ id: uid(), ...entry });
    return this.persist();
  }

  removeFromPlan(date, meal, id) {
    const slot = this.state.plan?.[date]?.[meal];
    if (!slot) return this.persist();
    this.state.plan[date][meal] = slot.filter((e) => e.id !== id);
    // A day with nothing left in it is removed, so the plan does not grow a
    // tail of empty weeks that has to be synced forever.
    if (MEAL_IDS.every((m) => !(this.state.plan[date][m] || []).length)) {
      delete this.state.plan[date];
    }
    return this.persist();
  }

  /** Move an entry to another slot — the drag between days. */
  moveInPlan(from, to, id) {
    const slot = this.state.plan?.[from.date]?.[from.meal];
    const entry = slot?.find((e) => e.id === id);
    if (!entry) return this.persist();
    this.state.plan[from.date][from.meal] = slot.filter((e) => e.id !== id);
    if (!this.state.plan[to.date]) this.state.plan[to.date] = {};
    if (!this.state.plan[to.date][to.meal]) this.state.plan[to.date][to.meal] = [];
    this.state.plan[to.date][to.meal].push(entry);
    return this.persist();
  }

  clearPlan(dates) {
    for (const date of dates) delete this.state.plan?.[date];
    return this.persist();
  }

  // ---- cooking --------------------------------------------------------------

  /* What has been crossed off while cooking. Kept out of the recipe itself:
     it is the state of tonight's dinner, not a property of the recipe, and it
     should not travel to anyone the recipe is shared with. */
  cookProgress(recipeId) {
    return this.cooking?.[recipeId] || { steps: [], ingredients: [] };
  }

  toggleCooked(recipeId, kind, id) {
    if (!this.cooking) this.cooking = {};
    const progress = this.cooking[recipeId] || { steps: [], ingredients: [] };
    const list = progress[kind];
    progress[kind] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    this.cooking[recipeId] = progress;
    this.emit();
  }

  clearCooked(recipeId) {
    if (this.cooking) delete this.cooking[recipeId];
    this.emit();
  }

  // ---- settings ----------------------------------------------------------

  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    return this.persist();
  }

  // ---- lookups -----------------------------------------------------------

  bookById(id) {
    return this.state.books.find((b) => b.id === id);
  }

  recipeById(id) {
    return this.state.recipes.find((r) => r.id === id);
  }

  recipesInBook(bookId) {
    return this.state.recipes.filter((r) => r.bookId === bookId);
  }
}

export const store = new Store();
