# Cook Book

**[iiiiii107.github.io/cook-book](https://iiiiii107.github.io/cook-book/)**

A digital scrapbook for recipes. Books lie open on a wooden desk with the light
falling across the page; recipes flow across as many leaves as they need and can
be written on, decorated and cooked from.

Built for PC and iPad first, and usable on a phone.

```bash
npm install
npm run dev        # http://localhost:5175
npm test
npm run build
npm run icons      # regenerate the PWA icons after changing the mark
```

## How it is put together

Vanilla ES modules and Vite, in the same shape as `10-minutes-to-spare` — no
framework, a hash router, one store, and plain CSS with custom properties.

| Path | What it holds |
|---|---|
| `src/lib/paginate.js` | The page-flow engine — the heart of the thing |
| `src/lib/recipe.js` | The model, and the ingredient parser |
| `src/lib/storage.js` | The swappable backend facade (browser now, Firestore later) |
| `src/lib/theme.js` | Settings → CSS custom properties on `<html>` |
| `src/views/customise.js` | The decoration layer and its tray |
| `src/lib/elements.js` | What gets stuck on a page |
| `src/lib/assets.js` | Photograph blobs, in IndexedDB |
| `src/lib/crop.js` | Crop and re-encode before a photo lands |
| `src/lib/units.js` | Unit arithmetic — why ingredients are stored parsed |
| `src/lib/aisles.js` | Sorting a list into the order a shop is walked |
| `src/lib/timers.js` | Finding the timers already written into a method |
| `src/lib/md.js` | Recipes as markdown, both directions |
| `src/lib/backup.js` | The zip backup, photographs included |
| `src/views/spread.js` | The page-turn furniture every open book shares |
| `src/views/cook.js` | Cook mode |
| `src/views/plan.js` | The planning sheet and the shopping list |
| `src/views/` | One module per screen |
| `scripts/generate-icons.mjs` | Draws and encodes the PWA icons from scratch |

### Pages flow because CSS does it

A recipe is one CSS multi-column element whose column width is a page width and
whose height is a page height. The browser fragments it into columns; the app
clips to two and slides horizontally to turn the page. Nothing in the code
decides where a page breaks — which is why text divides mid-sentence across the
gutter and looks right, in reading and in editing alike.

Decoration is deliberately not in that flow. Stickers, photographs and doodles
are positioned in per-page overlays as fractions of the page box, so they stay
where they were put when the text above them grows, and land in the same spot on
a monitor and an iPad.

### Editing happens on the page

The blocks are `contenteditable` in place, inside the same flow that reading
uses, so there is no second layout to keep in step. Two details make it work:

- The global re-render is held while typing (`body[data-editing]`). A save
  normally rebuilds the view, which would take the caret with it.
- The lists are `contenteditable="true"`, not `plaintext-only`. In plaintext-only
  mode the browser treats the subtree as a flat string and silently normalises
  away any `<li>` inserted into it, so Enter could never make a new item.
- The column properties are written **only when the layout has actually
  changed**, never on every keystroke. Re-fragmenting a multi-column element
  can drop the selection, and the caret then lands back in the first editable
  block — which is how ingredients end up typed into the title.

### The cookbook is one book

Cover, then the index, then every recipe — a single flow you turn through from
front to back, which puts the first recipe on **page three, the left-hand
leaf**. The cover and the index are fixed pages: a block the full height of a
page fills its column, and `break-after: column` sends what follows to the
next one.

**The order of the pages is the order of the index.** Change the sort and the
book is rebound, because a contents page is not a filter over some other
order — it is the order.

Decoration is *shown* in the book but *edited* on the recipe's own spread.
Elements store their page relative to their own recipe, so a recipe growing —
or the book being re-sorted — never drags anybody's photographs onto a
different page; they are offset into the book's numbering only for display,
read from the laid-out flow because only the browser knows how many pages a
recipe turned into.

### Sharing, and backup

`md.js` writes recipes as markdown, because whoever you send one to should be
able to read it without installing anything, and it round-trips — what comes
out of `parseMarkdown` is what went into `recipeToMarkdown`. What it cannot
carry is the decoration; the share dialog says so rather than letting it be
discovered at the other end, and shows the exact file before it leaves.

`backup.js` is a **zip**, not the JSON it replaces. Photographs live in
IndexedDB rather than the state blob, so a JSON backup restored onto a new
machine came back with every picture missing — a backup that quietly loses
things is worse than none. It still reads the old `.json` files.

### Decorating a page

Photographs, stickers, doodles and scraps of text share one shape and live in
`recipe.elements` (or `book.cover.elements` for a cover). Positions are
**fractions of the page box, never pixels** — a sticker at `x: 0.25` sits a
quarter of the way across whether the page is 300px wide on a phone or 700px on
a monitor. The layer is present in every mode, because photographs have to be
visible while reading; only customising turns input on.

Doodles are stored as SVG paths in a fixed 0–1000 space and stretched onto the
page with `preserveAspectRatio="none"`, so marks stay where they were drawn at
any size; `vector-effect="non-scaling-stroke"` then stops that stretch from
squashing the line itself. Strokes are accumulated in a live path and only
committed on `pointerup` — writing to the store mid-stroke re-renders the page
and takes the canvas away mid-line. Once a pen has been seen, touches are
ignored for a second and a half, which is palm rejection.

Photographs never go near `storage.js`. They are cropped, capped at a 1600px
long edge and re-encoded to WebP (a 4MB phone photo becomes ~150KB), then kept
as blobs in IndexedDB with only the asset id in the recipe.

**Three traps worth naming**, because each cost real time:

- An element has its own `x` and `y`, and so does a pointer event. Writing
  `{ x: event.clientX, ...element }` silently replaces the pointer position
  with the element's fractional coordinate, and every drag then measures its
  delta from `0.2`. The pointer origin is called `px`/`py` throughout for that
  reason.
- **Saving rebuilds the page, so a drag must only save when something actually
  moved.** Writing on every `pointerup` replaced the node under the pointer on
  a plain click — which meant a note could never be double-clicked open,
  because the second click landed on a brand-new element.
- **The drag must not `preventDefault()` on `pointerdown`** — that suppresses
  the `click` and `dblclick` that follow. Scrolling and text selection are held
  off with `touch-action` and `user-select` in CSS instead. Move listeners live
  on `window`, not the element: a quick drag leaves a small sticker before the
  first `pointermove`, and relying on pointer capture alone made stickers feel
  stuck.

### Turning a page

`turn()` in `paginate.js` composes three layers: the pages either side are put
into their new state underneath straight away, a static copy of the page the
leaf will land on sits above them, and between the two a single sheet rotates
about the spine — its front is the page you are leaving and its back is the
page you are turning to, which is what a leaf physically is. Arrows sit at the
outer edges, and a horizontal swipe does the same thing.

### Every cookbook is its own object

A book carries its own binding (`plain`, `halfbound`, `banded`, `label`,
`cloth`), a spine colour picked from a real colour input rather than a fixed
set, an optional cover sticker, and the paper its pages are printed on
(`ruled`, `margin`, `grid`, `graph`, `dots`, `aged`). Bindings are drawn from
the single spine colour, so choosing a colour and choosing a style stay
independent. Paper stocks are drawn from `--paper-line`, so they follow the
palette, and every stock keeps identical margins — changing paper never
reflows a recipe.

### Colours are genuinely yours

Every colour, the wood and the light are custom properties written onto `<html>`
by `theme.js`, and no stylesheet reads settings any other way. Light and dark are
not a toggle but two axes: day is sun through a window and night is moonlight,
and the cord and the lamp on the desk turn each of them off.

The planning sheet is the exception to the theme: real paper does not turn dark
when the sun goes down, it is only lit differently. It has its own `--sheet-*`
tokens that no dark block redefines, and `applyTheme` mirrors any palette
choice onto them so it still follows a custom palette without ever inverting.

The daylight casts a **window**, not blinds: a casement of two sashes, each
divided into a grid of panes, with a heavier meeting stile down the middle. The
lattice is rotated and skewed because a window projected onto a desk lands as a
parallelogram, and masked along the shaft so it reads as a cast shadow rather
than a graphic laid over the screen.

### The kitchen

**Cook mode** holds the screen awake (re-acquiring the Wake Lock every time the
tab comes back, or it sleeps the first time you glance at your phone), closes
every way out but one deliberate action, and shows the page you made — your
photographs and doodles included — with the step you are on lit.

The dimming is **one scrim over the page with a hole cut in it**, not opacity on
each element, so a photograph sitting behind the current step dims with it and
nothing shifts as the focus travels down the method. Ticking something off
draws the hand-made stroke from `10minutestospare`, seeded per row so no two
look stamped. Marks made while cooking are recorded with `origin: 'cook'` and
kept out of the recipe — they are the state of tonight's dinner, not a property
of the recipe, and should not travel to anyone you share it with.

Durations already written into a step become timers you can start with a tap.
Ranges take their **lower** bound: a thing that is not ready can go back in, a
thing that has burnt cannot come out.

**The week rolls over on its own.** The plan is keyed by the actual date, so
next Monday is simply a different key and starts blank — nothing is carried
over and nothing needs resetting. Two sheets lie on the desk, this week and the
one just gone; anything older is forgotten at boot by `store.prunePlan`, which
is why ISO date strings are used throughout — they sort correctly as plain
strings, so the cutoff is a string comparison. Weeks you planned *ahead* are
never pruned: those were deliberate, and forgetting them would throw away work.

**The shopping list** is the reason ingredients are stored parsed. Quantities
only combine inside a family — millilitres and litres add, tablespoons and
millilitres do not, because that conversion depends on what is being measured
and guessing it would put a wrong number on the list. What cannot be added is
kept side by side (`2 tbsp + 100 ml olive oil`) rather than fudged. Display
units are a shorter list than readable ones: 100 ml is a decilitre and nobody
has ever written that down, and a step up only happens when it costs no
accuracy — 1500 g becomes 1.5 kg, 1333 g stays in grams.

Aisle keywords are written in the **singular**, because names reach `aisles.js`
after `normaliseItem` — a plural keyword would silently never match, which is
how chopped tomatoes once ended up in the vegetable aisle.

## Where it is going

Phases 1 to 3 are done: the desk and the flowing pages, the scrapbook layer,
and the kitchen — cook mode, the planning sheet and the shopping list.

Sharing and backup are done. Phase 4 is what remains: Google sign-in and sync
across devices, and importing recipes by screenshot, URL or paste.

## Setting up sync (Phase 4, not needed yet)

`firestore.rules` and `storage.rules` are ready. Photographs go to Firebase
Storage, which needs the project on the pay-as-you-go plan — **set a spending cap
at the same time**; the free tier covers this comfortably, and the cap means a
mistake can never bill you. The config goes in as the `VITE_FIREBASE_CONFIG`
repository secret. Without it the app simply stays local.
