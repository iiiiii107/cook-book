/* @vitest-environment jsdom */

/* How the desk ends up lit is decided from three separate settings, and the
   stored `light` value is only one of them. The case that matters: someone who
   once closed the shutters, and then finds the cord switched off. Their stored
   light is still 'off' and there is nothing on screen to pull, so reading it
   straight would leave them sitting in the dark with no way out. */

import { describe, it, expect } from 'vitest';
import { applyTheme } from './theme.js';

const lightOf = (settings) => {
  applyTheme(settings);
  return document.documentElement.dataset.light;
};

describe('how the desk is lit', () => {
  it('ignores a light nobody can change, so no one is stranded in the dark', () => {
    expect(lightOf({ light: 'off', lightSwitch: false })).toBe('on');
    expect(lightOf({ light: 'bulb', lightSwitch: false })).toBe('on');
  });

  it('follows the stored light once the cord is there to pull', () => {
    expect(lightOf({ light: 'off', lightSwitch: true })).toBe('off');
    expect(lightOf({ light: 'bulb', lightSwitch: true })).toBe('bulb');
    expect(lightOf({ lightSwitch: true })).toBe('on');
  });

  it('drops the lighting layer entirely when the sun is turned off', () => {
    // Whatever else is set — this is the way out for a machine the shaft
    // makes judder, so nothing may override it.
    expect(lightOf({ lighting: false, light: 'bulb', lightSwitch: true })).toBe('none');
  });

  it('leaves day and night alone, which everyone keeps', () => {
    applyTheme({ theme: 'dark', lighting: false, lightSwitch: false });
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme({ theme: 'system' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
