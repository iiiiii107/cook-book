import { describe, it, expect } from 'vitest';
import { addDays, startOfWeek, weekLabel } from './dates.js';
import { prunePlan, planWindow, weekStarts, withinWindow } from './plan.js';

/* The pruning rule deletes data, so it is worth pinning down exactly which
   weeks survive. These call the real implementation — verifying a deletion
   rule against a second copy of itself proves nothing. */

const planOn = (...dates) =>
  Object.fromEntries(dates.map((d) => [d, { dinner: [{ id: 'x', text: 'something' }] }]));

const survivors = (plan, today) => {
  const copy = structuredClone(plan);
  prunePlan(copy, today);
  return Object.keys(copy).sort();
};

describe('the three weeks the sheet covers', () => {
  const today = '2026-08-28';                 // a Friday
  const thisWeek = startOfWeek(today, 1);     // Monday 24 Aug
  const lastWeek = addDays(thisWeek, -7);     // Monday 17 Aug
  const nextWeek = addDays(thisWeek, 7);      // Monday 31 Aug

  it('is last week, this week and next week', () => {
    expect(weekStarts(today)).toEqual([lastWeek, thisWeek, nextWeek]);
  });

  it('runs from last Monday to next Sunday', () => {
    expect(planWindow(today)).toEqual({ first: lastWeek, last: addDays(nextWeek, 6) });
  });

  it('knows what falls inside it', () => {
    expect(withinWindow(lastWeek, today)).toBe(true);
    expect(withinWindow(addDays(nextWeek, 6), today)).toBe(true);
    expect(withinWindow(addDays(lastWeek, -1), today)).toBe(false);
    expect(withinWindow(addDays(nextWeek, 7), today)).toBe(false);
  });
});

describe('pruning the plan', () => {
  const today = '2026-08-28';
  const thisWeek = startOfWeek(today, 1);
  const lastWeek = addDays(thisWeek, -7);
  const nextWeek = addDays(thisWeek, 7);

  it('keeps all three weeks', () => {
    expect(survivors(planOn(lastWeek, thisWeek, nextWeek), today))
      .toEqual([lastWeek, thisWeek, nextWeek].sort());
  });

  it('keeps the very edges — last Monday and next Sunday', () => {
    const sunday = addDays(nextWeek, 6);
    expect(survivors(planOn(lastWeek, sunday), today)).toEqual([lastWeek, sunday].sort());
  });

  it('forgets anything before last week', () => {
    expect(survivors(planOn(addDays(lastWeek, -1), addDays(thisWeek, -35)), today)).toEqual([]);
  });

  it('forgets anything beyond next week', () => {
    expect(survivors(planOn(addDays(nextWeek, 7), addDays(thisWeek, 60)), today)).toEqual([]);
  });

  it('reports whether it actually removed anything', () => {
    expect(prunePlan(planOn(thisWeek), today)).toBe(false);
    expect(prunePlan(planOn(addDays(thisWeek, -35)), today)).toBe(true);
  });

  it('does not mind an empty plan, or none at all', () => {
    expect(prunePlan({}, today)).toBe(false);
    expect(prunePlan(undefined, today)).toBe(false);
  });
});

describe('weekLabel', () => {
  const today = '2026-08-28';
  const thisWeek = startOfWeek(today, 1);

  it('says what a person would say', () => {
    expect(weekLabel(thisWeek, today)).toBe('This week');
    expect(weekLabel(addDays(thisWeek, -7), today)).toBe('Last week');
    expect(weekLabel(addDays(thisWeek, 7), today)).toBe('Next week');
  });

  it('gives dates once counting weeks stops helping', () => {
    expect(weekLabel(addDays(thisWeek, 21), today)).toMatch(/^Week of /);
  });
});
