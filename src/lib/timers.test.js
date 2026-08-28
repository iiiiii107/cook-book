import { describe, it, expect } from 'vitest';
import { findTimers, formatClock, formatDuration } from './timers.js';

const seconds = (text) => findTimers(text).map((t) => t.seconds);

describe('findTimers', () => {
  it('finds the plain case', () => {
    expect(seconds('Simmer for 20 minutes.')).toEqual([1200]);
  });

  it('understands the usual abbreviations', () => {
    expect(seconds('Rest 10 mins')).toEqual([600]);
    expect(seconds('Bake 1 hour')).toEqual([3600]);
    expect(seconds('Blanch for 90 seconds')).toEqual([90]);
  });

  it('takes the lower bound of a range, so you check early', () => {
    expect(seconds('Bake for 25–30 minutes')).toEqual([1500]);
    expect(seconds('Cook 2 to 3 minutes')).toEqual([120]);
  });

  it('finds more than one in a step', () => {
    expect(seconds('Fry 5 minutes, then rest for 1 hour')).toEqual([300, 3600]);
  });

  it('does not repeat the same duration twice', () => {
    expect(seconds('10 minutes, then another 10 minutes')).toEqual([600]);
  });

  it('ignores things that are not durations', () => {
    expect(seconds('Put a large pan of water on to boil')).toEqual([]);
    expect(seconds('400 g spaghetti')).toEqual([]);
    expect(seconds('Wait 3 seconds')).toEqual([]);   // too short to be worth a timer
  });

  it('copes with empty and nonsense input', () => {
    expect(findTimers('')).toEqual([]);
    expect(findTimers(null)).toEqual([]);
  });
});

describe('formatClock', () => {
  it('counts down in the shape a clock has', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(0)).toBe('0:00');
  });
});

describe('formatDuration', () => {
  it('writes a duration the way a recipe would', () => {
    expect(formatDuration(90)).toBe('2 min');
    expect(formatDuration(1200)).toBe('20 min');
    expect(formatDuration(3600)).toBe('1 hr');
    expect(formatDuration(5400)).toBe('1 hr 30');
    expect(formatDuration(30)).toBe('30 sec');
  });
});
