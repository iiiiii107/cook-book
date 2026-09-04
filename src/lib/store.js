import { storage } from './storage.js';
import { newBook, newRecipe } from './recipe.js';
import { uid } from './dom.js';
import { prunePlan, planWindow } from './plan.js';
import { createShare, joinShare, leaveShare, watchShare, saveShare } from './share.js';

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
    // The shared week being followed, if any. Null means your own.
    this.shared = null;
    this.stopWeekShare = null;
  }

  async init() {
    this.state = await storage.load();
    // Three weeks and no more — see lib/plan.js. A plan that kept every week
    // you ever made would grow without limit and sync all of it.
    if (prunePlan(this.state.plan)) await storage.save(this.state);
    this.ready = true;
    // A shared week is picked up again on every load, so it is not something
    // you have to rejoin each morning.
    if (this.state.settings.weekShareId) {
      this.attachWeekShare(this.state.settings.weekShareId);
    }
    storage.subscribe((incoming) => {
      this.state = incoming;
      this.emit();
    });
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  /* ---- which week is on the desk ------------------------------------------

     Your own, or one you are sharing. Both carry a `plan` and the quick meals
     the plan refers to, so everything below works on whichever is in view
     without knowing which it is — and your own week sits untouched under your
     own user id the whole time a share is on, waiting to come back. */

  get week() {
    return this.shared || this.state;
  }

  /** True while somebody else's Tuesday can appear on this sheet. */
  get sharingWeek() {
    return Boolean(this.shared);
  }

  async persistWeek() {
    if (!this.shared) return this.persist();
    await saveShare(this.shared.id, {
      plan: this.shared.plan,
      standbys: this.shared.standbys,
    });
    this.emit();
  }

  /** Follow a shared week, and keep following it across reloads. */
  attachWeekShare(id) {
    this.detachWeekShare();
    this.stopWeekShare = watchShare(
      id,
      (share) => {
        const payload = share.payload || {};
        this.shared = {
          id: share.id,
          label: share.label,
          ownerId: share.ownerId,
          ownerName: share.ownerName,
          members: share.members,
          memberIds: share.memberIds,
          plan: payload.plan || {},
          standbys: payload.standbys || [],
        };
        // The three-week window applies to a shared sheet exactly as it does
        // to your own; nobody wants last spring arriving from someone else.
        if (prunePlan(this.shared.plan)) this.persistWeek();
        this.emit();
      },
      (why) => {
        this.detachWeekShare();
        this.state.settings.weekShareId = null;
        this.persist();
        this.dispatchEvent(new CustomEvent('share-ended', { detail: { why } }));
      },
    );
  }

  detachWeekShare() {
    this.stopWeekShare?.();
    this.stopWeekShare = null;
    this.shared = null;
  }

  /** Start sharing this week. What is already on it goes with you. */
  async startWeekShare(label) {
    const id = await createShare(
      'week',
      { plan: this.state.plan, standbys: this.state.standbys },
      label,
    );
    this.state.settings.weekShareId = id;
    await this.persist();
    this.attachWeekShare(id);
    return id;
  }

  async joinWeekShare(id) {
    await joinShare(id);
    this.state.settings.weekShareId = id;
    await this.persist();
    this.attachWeekShare(id);
  }

  /** Step out. Your own week is exactly where you left it. */
  async leaveWeekShare() {
    const id = this.shared?.id;
    this.detachWeekShare();
    this.state.settings.weekShareId = null;
    await this.persist();
    if (id) await leaveShare(id);
    this.emit();
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

  /** The first and last dates the planning sheet covers. */
  planWindow() {
    return planWindow();
  }

  /** How many meals are planned across a run of days. */
  plannedCount(dates) {
    let count = 0;
    for (const date of dates) {
      for (const meal of MEAL_IDS) count += (this.week.plan?.[date]?.[meal] || []).length;
    }
    return count;
  }

  /** What is planned for one meal on one day. */
  plannedFor(date, meal) {
    return this.week.plan?.[date]?.[meal] || [];
  }

  /**
   * Put a recipe, or a plain note, into a slot.
   * @param {string} date 'YYYY-MM-DD'
   * @param {string} meal breakfast | lunch | dinner
   * @param {{recipeId?: string, text?: string, servings?: number}} entry
   */
  // ---- standbys ----------------------------------------------------------
  /* Meals with no recipe behind them. They are referred to from the plan by
     id rather than copied into it, so correcting the name — or adding the
     ingredients you meant to add — reaches every day it is already on. */

  standbyById(id) {
    return this.week.standbys?.find((s) => s.id === id);
  }

  addStandby({ name, ingredients = [], onList = true }) {
    const week = this.week;
    if (!week.standbys) week.standbys = [];
    const standby = { id: uid(), name: String(name).trim(), ingredients, onList };
    week.standbys.push(standby);
    return this.persistWeek().then(() => standby);
  }

  updateStandby(id, patch) {
    const standby = this.standbyById(id);
    if (!standby) return Promise.resolve();
    Object.assign(standby, patch);
    return this.persistWeek();
  }

  /* Removing one leaves the days it was planned on pointing at nothing, so
     they are turned back into plain written-in meals rather than vanishing —
     deleting a standby should tidy the drawer, not edit last Tuesday. */
  removeStandby(id) {
    const standby = this.standbyById(id);
    if (!standby) return Promise.resolve();

    for (const day of Object.values(this.week.plan || {})) {
      for (const entries of Object.values(day)) {
        for (const entry of entries) {
          if (entry.standbyId !== id) continue;
          delete entry.standbyId;
          entry.text = standby.name;
          if (standby.ingredients?.length) entry.ingredients = standby.ingredients;
          // Including whether it belonged on the list. Deleting "Eating out"
          // should not put it on next week's shopping.
          if (standby.onList === false) entry.onList = false;
        }
      }
    }

    this.week.standbys = this.week.standbys.filter((s) => s.id !== id);
    return this.persistWeek();
  }

  addToPlan(date, meal, entry) {
    const plan = this.week.plan || (this.week.plan = {});
    if (!plan[date]) plan[date] = {};
    if (!plan[date][meal]) plan[date][meal] = [];
    /* A recipe's name is copied onto the entry, not just its id.

       On a shared week the other person has their own cookbooks and not
       yours, so an id on its own would show them a blank where Tuesday's
       dinner should be. The id still does the work when they do have it —
       the name is only there to be read when it cannot. */
    const recipe = entry.recipeId && this.recipeById(entry.recipeId);
    const named = recipe ? { title: recipe.title, ...entry } : entry;
    plan[date][meal].push({ id: uid(), ...named });
    return this.persistWeek();
  }

  removeFromPlan(date, meal, id) {
    const plan = this.week.plan || {};
    const slot = plan[date]?.[meal];
    if (!slot) return this.persistWeek();
    plan[date][meal] = slot.filter((e) => e.id !== id);
    // A day with nothing left in it is removed, so the plan does not grow a
    // tail of empty weeks that has to be synced forever.
    if (MEAL_IDS.every((m) => !(plan[date][m] || []).length)) delete plan[date];
    return this.persistWeek();
  }

  /** Move an entry to another slot — the drag between days. */
  moveInPlan(from, to, id) {
    const plan = this.week.plan || {};
    const slot = plan[from.date]?.[from.meal];
    const entry = slot?.find((e) => e.id === id);
    if (!entry) return this.persistWeek();
    plan[from.date][from.meal] = slot.filter((e) => e.id !== id);
    if (!plan[to.date]) plan[to.date] = {};
    if (!plan[to.date][to.meal]) plan[to.date][to.meal] = [];
    plan[to.date][to.meal].push(entry);
    return this.persistWeek();
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
