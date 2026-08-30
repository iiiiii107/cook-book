import { el, iconButton, strikeSvg, toast, modal, claimBodyFlag } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { createPagedSpread } from '../lib/paginate.js';
import { scaleIngredients, formatIngredient, totalTime } from '../lib/recipe.js';
import { findTimers, formatClock } from '../lib/timers.js';
import { mountDecorations } from './customise.js';
import { mountSpreadControls } from './spread.js';
import { buildFlow } from './recipe.js';

/* Cook mode.

   A deliberate place to be, and a hard one to leave by accident: no
   navigation, no links out, and a guard on refresh. The screen is held awake,
   because the one thing worse than a recipe you cannot read is a recipe that
   went dark while your hands were covered in flour.

   What you are looking at is the page you made — your photographs, your
   doodles, your layout — scaled up, with the step you are on lit and the rest
   of the page dimmed. Everything you cross off is drawn as a hand-made stroke
   rather than a tick box, and the marks are kept out of the recipe itself:
   they are the state of tonight's dinner, not a property of the recipe, and
   they should not travel to anyone you share it with. */

export function renderCook(host, recipeId) {
  const recipe = store.recipeById(recipeId);
  if (!recipe) {
    location.hash = '#/';
    return;
  }

  const wake = holdScreenAwake();
  const guard = (event) => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', guard);

  let servings = recipe.servings || 4;
  let current = 0;

  const leave = () => {
    window.removeEventListener('beforeunload', guard);
    wake.release();
    releaseFlag();
    location.hash = `#/recipe/${recipe.id}`;
  };

  /* --- the bar ------------------------------------------------------------ */

  const portionLabel = el('strong', { text: String(servings) });
  const head = el('div', { class: 'cook-bar' }, [
    el('div', { class: 'cook-title' }, [
      el('h1', { text: recipe.title }),
      el('span', { class: 'cook-sub', text: totalTime(recipe) ? `${totalTime(recipe)} min` : '' }),
    ]),
    el('div', { class: 'cook-portions' }, [
      el('button', {
        class: 'btn-icon', type: 'button', text: '−',
        title: 'Fewer portions', 'aria-label': 'Fewer portions',
        onClick: () => setServings(servings - 1),
      }),
      el('span', { class: 'cook-portion-count' }, [portionLabel, ' portions']),
      el('button', {
        class: 'btn-icon', type: 'button', text: '+',
        title: 'More portions', 'aria-label': 'More portions',
        onClick: () => setServings(servings + 1),
      }),
    ]),
    el('div', { class: 'cook-bar-actions' }, [
      iconButton('brush', 'Draw on the page', {
        onClick: () => {
          drawing = !drawing;
          deco.layer.classList.toggle('is-active', drawing);
          deco.setTool(drawing ? 'pencil' : 'move');
          toast(drawing ? 'Draw on the page.' : 'Back to cooking.');
        },
      }),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: 'Leave',
        onClick: () => {
          // Leaving is the one way out, so it asks — an accidental tap here
          // loses everything you have crossed off.
          modal({
            title: 'Stop cooking?',
            body: el('p', { class: 'settings-sub', text: 'What you have crossed off will be forgotten.' }),
            actions: [
              { label: 'Keep cooking' },
              { label: 'Stop', class: 'btn', onClick: () => { store.clearCooked(recipe.id); leave(); } },
            ],
          });
        },
      }),
    ]),
  ]);
  host.append(head);

  /* --- the page ------------------------------------------------------------ */

  const stage = el('div', { class: 'book-stage' });
  const spread = el('div', {
    class: 'spread',
    dataset: { paper: store.bookById(recipe.bookId)?.paperStock || 'plain' },
  });
  stage.append(spread);
  host.append(stage);


  let controls;
  const paged = createPagedSpread({
    host: spread,
    onChange: (api) => {
      controls?.update(api);
      api.onSpreadChange?.();
    },
  });
  controls = mountSpreadControls({ spread, paged });

  let drawing = false;
  const deco = mountDecorations({
    host: paged.viewport,
    paged,
    active: false,
    toolStyles: store.state.settings.toolStyles,
    read: () => structuredClone(store.recipeById(recipe.id)?.elements || []),
    write: (elements) => {
      // Marks made while cooking are recorded as such — the splatters of a
      // Tuesday night are worth being able to tell apart later.
      for (const element of elements) if (!element.origin) element.origin = 'cook';
      store.updateRecipe(recipe.id, { elements });
      deco.refresh();
    },
  });

  function draw() {
    const scaled = {
      ...recipe,
      servings,
      ingredients: scaleIngredients(recipe.ingredients, servings / (recipe.servings || 1)),
    };
    buildFlow(paged.flow, scaled, false);
    wireTicking(scaled);
    paged.refresh();
    deco.refresh();
    lightCurrentStep();
  }

  paged.onSpreadChange = () => {
    deco.refresh();
    lightCurrentStep();
  };

  function setServings(next_) {
    servings = Math.min(Math.max(1, next_), 99);
    portionLabel.textContent = String(servings);
    draw();
  }

  /* --- crossing things off -------------------------------------------------- */

  function wireTicking(scaled) {
    const progress = store.cookProgress(recipe.id);

    const rows = [
      ...[...paged.flow.querySelectorAll('[data-field="ingredients"] li')]
        .map((node, i) => ({ node, kind: 'ingredients', id: scaled.ingredients[i]?.id })),
      ...[...paged.flow.querySelectorAll('[data-field="steps"] li')]
        .map((node, i) => ({ node, kind: 'steps', id: scaled.steps[i]?.id, step: i })),
    ];

    for (const row of rows) {
      if (!row.id) continue;
      row.node.classList.add('tickable');
      if (progress[row.kind].includes(row.id)) {
        row.node.classList.add('is-done');
        // A different wobble per row, so no two strokes are identical.
        row.node.append(strikeSvg(row.id.charCodeAt(0) + row.id.length));
      }

      // A tap works, and so does drawing across it — the pen is the point on
      // a tablet, but nobody should need one.
      const wasDone = progress[row.kind].includes(row.id);
      const toggle = () => {
        store.toggleCooked(recipe.id, row.kind, row.id);
        // Completing a step moves the light on to the next one; un-completing
        // it puts the light back where you just were.
        if (row.kind === 'steps') {
          current = wasDone
            ? row.step
            : Math.min(row.step + 1, scaled.steps.length - 1);
        }
        draw();
      };
      row.node.addEventListener('click', toggle);
      row.node.addEventListener('pointerenter', (event) => {
        // Dragging a pen across a row crosses it off, the way you would on
        // paper. Only while the pen is actually down.
        if (event.pressure > 0 && event.pointerType === 'pen') toggle();
      });

      if (row.kind === 'steps' && row.step === current) {
        row.node.classList.add('is-current');
        row.node.prepend(timerStrip(scaled.steps[row.step].text));
      }
    }
  }

  /* --- the step you are on ---------------------------------------------------- */

  /* Marked by colouring the step itself, not by dimming everything else.
     Greying the page made the rest harder to read, which is exactly wrong in a
     kitchen: you want to glance ahead at what is coming and back at what you
     just did. A solid band says "here" without taking anything away.

     All this does now is follow the step if it has flowed onto another page. */
  function lightCurrentStep() {
    const node = paged.flow.querySelector('.recipe-steps li.is-current');
    if (!node) return;

    const box = spread.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.bottom >= box.top && rect.top <= box.bottom) return;

    const flowBox = paged.flow.getBoundingClientRect();
    const stride = paged.pageSize.width + Number.parseFloat(
      getComputedStyle(paged.flow).columnGap || 0,
    );
    if (!stride) return;
    const column = Math.floor((rect.left - flowBox.left) / stride);
    paged.goToSpread(Math.floor(column / paged.perView));
  }


  draw();

  // Holds the background re-render for as long as this page is on screen, and
  // only ever releases its own claim.
  const releaseFlag = claimBodyFlag('cooking', spread);

  const observer = new MutationObserver(() => {
    if (document.contains(spread)) return;
    window.removeEventListener('beforeunload', guard);
    wake.release();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* --- timers ----------------------------------------------------------------- */

function timerStrip(text) {
  const timers = findTimers(text);
  const strip = el('span', { class: 'timer-strip', contenteditable: 'false' });
  if (!timers.length) return strip;

  for (const timer of timers) {
    strip.append(el('button', {
      class: 'timer-chip',
      type: 'button',
      text: timer.label,
      title: `Start a ${timer.label} timer`,
      onClick: (event) => {
        event.stopPropagation();
        startTimer(timer.seconds, event.currentTarget);
      },
    }));
  }
  return strip;
}

function startTimer(seconds, chip) {
  let left = seconds;
  chip.classList.add('is-running');
  chip.textContent = formatClock(left);

  const tick = setInterval(() => {
    left -= 1;
    chip.textContent = formatClock(left);
    if (left > 0) return;

    clearInterval(tick);
    chip.classList.remove('is-running');
    chip.classList.add('is-done');
    chip.textContent = 'ready';
    toast('Timer finished.');
    // A sound would be better than a toast in a noisy kitchen, but it needs a
    // user gesture to unlock audio on iOS; the tap that started the timer
    // counts, so this is the place to add one later.
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }, 1000);

  chip.addEventListener('click', function stop(event) {
    event.stopPropagation();
    clearInterval(tick);
    chip.classList.remove('is-running');
    chip.textContent = formatClock(seconds);
    chip.removeEventListener('click', stop);
  }, { once: true });
}

/* --- the screen ------------------------------------------------------------- */

/* Wake Lock is dropped whenever the tab is hidden, so it has to be taken again
   every time the app comes back — otherwise the screen sleeps the first time
   you glance at your phone. */
function holdScreenAwake() {
  let sentinel = null;
  let live = true;

  async function acquire() {
    if (!live || !('wakeLock' in navigator)) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      /* denied, or the battery is too low — cooking still works */
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  acquire();

  return {
    release() {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release?.().catch(() => {});
      sentinel = null;
    },
  };
}
