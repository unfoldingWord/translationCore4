import { describe, expect, it } from 'vitest';
import { inFocus, editingFocus } from '../src/views/helpsFocus.js';

describe('helpsFocus', () => {
  it('null keeps all', () => {
    expect(inFocus({ chapter: 1, verse: 1 }, null)).toBe(true);
    expect(inFocus({ chapter: 1, verse: 'intro' }, null)).toBe(true);
    expect(inFocus({ chapter: 1, verse: 3 }, null)).toBe(true);
    expect(inFocus({ chapter: 1, verse: '4-5' }, null)).toBe(true);
  });

  it('verse 3 focus drops verse 1 and intro', () => {
    expect(inFocus({ chapter: 1, verse: 1 }, ['3'])).toBe(false);
    expect(inFocus({ chapter: 1, verse: 'intro' }, ['3'])).toBe(false);
    expect(inFocus({ chapter: 1, verse: 3 }, ['3'])).toBe(true);
  });

  it('focus ["1"] keeps intro', () => {
    expect(inFocus({ chapter: 1, verse: 'intro' }, ['1'])).toBe(true);
    expect(inFocus({ chapter: 1, verse: 1 }, ['1'])).toBe(true);
    expect(inFocus({ chapter: 1, verse: 2 }, ['1'])).toBe(false);
  });

  it('focus ["4-5"] keeps verse 5 and verse "4-5"', () => {
    expect(inFocus({ chapter: 1, verse: 5 }, ['4-5'])).toBe(true);
    expect(inFocus({ chapter: 1, verse: '4-5' }, ['4-5'])).toBe(true);
    expect(inFocus({ chapter: 1, verse: 4 }, ['4-5'])).toBe(true);
    expect(inFocus({ chapter: 1, verse: 3 }, ['4-5'])).toBe(false);
    expect(inFocus({ chapter: 1, verse: '4-5' }, ['5'])).toBe(true);
  });

  it('editingFocus returns keys for section editing and verse key for verse editing', () => {
    expect(editingFocus({ key: '1:s1', keys: ['1', '2'] }, 1)).toEqual(['1', '2']);
    expect(editingFocus({ key: '1:3' }, 1)).toEqual(['3']);
    expect(editingFocus({ key: '1:4-5' }, 1)).toEqual(['4-5']);
  });

  it('editingFocus returns null for another chapter and null editing', () => {
    expect(editingFocus({ key: '2:3' }, 1)).toBeNull();
    expect(editingFocus({ key: '2:s1', keys: ['1', '2'] }, 1)).toBeNull();
    expect(editingFocus(null, 1)).toBeNull();
    expect(editingFocus(undefined, 1)).toBeNull();
  });
});
