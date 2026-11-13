import { describe, expect, it } from 'vitest';
import { acceleratorFromKey } from './format';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFromKey', () => {
  it('builds the accelerator from the physical key and the modifiers', () => {
    expect(acceleratorFromKey(key('KeyM', { ctrlKey: true, altKey: true }))).toBe('CommandOrControl+Alt+M');
    expect(acceleratorFromKey(key('Digit3', { ctrlKey: true, shiftKey: true }))).toBe('CommandOrControl+Shift+3');
    expect(acceleratorFromKey(key('ArrowUp', { altKey: true }))).toBe('Alt+Up');
    expect(acceleratorFromKey(key('Numpad5', { ctrlKey: true }))).toBe('CommandOrControl+num5');
  });

  it('waits while only modifiers are down', () => {
    expect(acceleratorFromKey(key('ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromKey(key('AltRight', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('takes bare F-keys but no bare letters', () => {
    expect(acceleratorFromKey(key('F9'))).toBe('F9');
    expect(acceleratorFromKey(key('KeyM'))).toBeNull();
    expect(acceleratorFromKey(key('KeyM', { shiftKey: true }))).toBeNull();
  });
});
