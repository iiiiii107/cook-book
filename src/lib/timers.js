/* Finding the timers hidden in a method.

   "Simmer for 20 minutes" already contains a timer; making the cook set one
   by hand is asking them to retype something the recipe told them. So every
   duration in a step becomes a chip they can start with one tap.

   Ranges take their lower bound: "bake for 25–30 minutes" means look at 25,
   because a thing that is not ready yet can go back in and a thing that has
   burnt cannot come out. */

const UNITS = [
  [/^(h|hr|hrs|hour|hours)$/i, 3600],
  [/^(m|min|mins|minute|minutes)$/i, 60],
  [/^(s|sec|secs|second|seconds)$/i, 1],
];

const PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(?:[-–—]|\s+to\s+)?\s*(?:\d+(?:[.,]\d+)?)?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;

function secondsFor(amount, unit) {
  const found = UNITS.find(([test]) => test.test(unit));
  return found ? Math.round(amount * found[1]) : null;
}

/**
 * Every duration mentioned in a piece of text.
 * @param {string} text
 * @returns {Array<{seconds: number, label: string}>}
 */
export function findTimers(text) {
  const out = [];
  const seen = new Set();

  for (const match of String(text || '').matchAll(PATTERN)) {
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const seconds = secondsFor(amount, match[2]);
    // Nothing under ten seconds is a timer; it is a turn of phrase.
    if (!seconds || seconds < 10 || seen.has(seconds)) continue;

    seen.add(seconds);
    out.push({ seconds, label: formatDuration(seconds) });
  }
  return out;
}

/** 90 → "1:30", 3600 → "1:00:00". */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** How a duration is written on a chip: "20 min", "1 hr 30". */
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours} hr ${minutes}` : `${hours} hr`;
}
