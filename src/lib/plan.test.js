import { describe, it, expect } from 'vitest';
import { todayISO, addDays, startOfWeek, weekLabel } from './dates.js';

/* The pruning rule, exercised directly. It deletes data, so it is worth
   pinning down exactly which weeks survive and which do not. */

const MEAL_IDS = ['breakfast', 'lunch', 'dinner'];

function prune(plan, today = todayISO()) {
  const cutoff = startOfWeek(addDays(today, -7), 1);
  const kept = {};
  for (const [date, day] of Object.entries(plan)) {
    if (date >= cutoff) kept[date] = day;
  }
  return kept;
}

const planOn = (...dates) =>
  Object.fromEntries(dates.map((d) => [d, { dinner: [{ id: 'x', text: 'something' }] }]));

describe('pruning the plan', () => {
  const today = '2026-08-28';                 // a Friday
  const thisWeek = startOfWeek(today, 1);     // Monday 24 Aug
  const lastWeek = addDays(thisWeek, -7);     // Monday 17 Aug
  const older = addDays(thisWeek, -14);       // Monday 10 Aug
  const nextWeek = addDays(thisWeek, 7);      // Monday 31 Aug

  it('keeps this week', () => {
    expect(Object.keys(prune(planOn(thisWeek), today))).toEqual([thisWeek]);
  });

  it('keeps last week — the second sheet on the desk', () => {
    expect(Object.keys(prune(planOn(lastWeek), today))).toEqual([lastWeek]);
  });

  it('keeps the whole of last week, right up to its last day', () => {
    const sunday = addDays(lastWeek, 6);
    expect(Object.keys(prune(planOn(sunday), today))).toEqual([sunday]);
  });

  it('forgets anything before last week', () => {
    expect(prune(planOn(older), today)).toEqual({});
    expect(prune(planOn(addDays(lastWeek, -1)), today)).toEqual({});
  });

  it('never forgets a week you planned ahead', () => {
    expect(Object.keys(prune(planOn(nextWeek), today))).toEqual([nextWeek]);
    expect(Object.keys(prune(planOn(addDays(thisWeek, 60)), today))).toEqual([addDays(thisWeek, 60)]);
  });

  it('keeps exactly the two weeks and the future, out of a long history', () => {
    const plan = planOn(
      addDays(thisWeek, -35), addDays(thisWeek, -21), older,
      lastWeek, thisWeek, nextWeek,
    );
    expect(Object.keys(prune(plan, today)).sort()).toEqual([lastWeek, thisWeek, nextWeek].sort());
  });

  it('does not mind an empty plan', () => {
    expect(prune({}, today)).toEqual({});
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

describe('the shape the plan is stored in', () => {
  it('sorts correctly as plain strings, which is what pruning relies on', () => {
    const dates = ['2026-09-01', '2026-08-31', '2026-12-25', '2026-01-02'];
    expect([...dates].sort()).toEqual(['2026-01-02', '2026-08-31', '2026-09-01', '2026-12-25']);
  });

  it('counts meals across a week', () => {
    const plan = { '2026-08-24': { breakfast: [{}], dinner: [{}, {}] } };
    const count = MEAL_IDS.reduce((n, m) => n + (plan['2026-08-24'][m] || []).length, 0);
    expect(count).toBe(3);
  });
});
