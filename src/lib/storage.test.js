/* @vitest-environment jsdom */

/* The two meals the app provides, and the one rule that makes them bearable:
   they are a gift, not a fixture. Handed over once and then owned outright —
   so deleting one has to mean it is gone, and a reload must not quietly put it
   back. */

import { describe, it, expect } from 'vitest';
import { withDefaults, BUILT_IN_STANDBYS } from './storage.js';

const names = (state) => state.standbys.map((s) => s.name);

describe('the meals everyone starts with', () => {
  it('reaches a first-time visitor, who has no stored state at all', () => {
    // The empty desk used to skip the normaliser entirely, which meant the
    // one group of people these are for were the only ones not getting them.
    const fresh = withDefaults({});
    expect(names(fresh)).toEqual(['Eating out', 'Take out']);
  });

  it('keeps them off the shopping list', () => {
    for (const standby of withDefaults({}).standbys) {
      expect(standby.onList).toBe(false);
    }
  });

  it('reaches someone who was already using the app', () => {
    const existing = { standbys: [{ id: 'x', name: 'Porridge', onList: true }] };
    expect(names(withDefaults(existing))).toEqual(['Eating out', 'Take out', 'Porridge']);
  });

  it('does not come back once deleted', () => {
    const afterDeleting = withDefaults({ standbysSeeded: true, standbys: [] });
    expect(afterDeleting.standbys).toEqual([]);
  });

  it('lets them be renamed and kept', () => {
    const renamed = { standbysSeeded: true, standbys: [{ id: 'take-out', name: 'Takeaway', onList: false }] };
    expect(names(withDefaults(renamed))).toEqual(['Takeaway']);
  });

  it('never lands twice, however the state arrived', () => {
    // A backup restored mid-seed, or a second device racing the first: the id
    // is fixed precisely so the two collide into one.
    const half = { standbys: [BUILT_IN_STANDBYS[0]] };
    expect(names(withDefaults(half))).toEqual(['Eating out', 'Take out']);
  });

  it('marks the state seeded, so the gift is only ever given once', () => {
    expect(withDefaults({}).standbysSeeded).toBe(true);
  });
});
