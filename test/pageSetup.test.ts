import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, PAGE_SPACING_FACTOR } from '../src/data/export/pageSetup';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const typography = fs.readFileSync(path.resolve(process.cwd(), 'src/ds/tokens/typography.css'), 'utf8');

describe('#142 — Community Checking spacing token contract', () => {
  it('keeps Single tied to the preview token and Double exactly twice Single', () => {
    expect(Object.isFrozen(DEFAULT_PAGE_SETUP)).toBe(true);
    expect(PAGE_SPACING_FACTOR.single).toBe(1);
    expect(PAGE_SPACING_FACTOR.double).toBe(2);
    const base = typography.match(/--lh-verse-md:\s*(\d+)px/);
    expect(base?.[1]).toBe('32');
    expect(typography).toContain('--lh-community-checking-single: var(--lh-verse-md);');
    expect(typography).toContain('--lh-community-checking-double: calc(var(--lh-verse-md) + var(--lh-verse-md));');
    expect(Number(base?.[1]) * 2).toBe(64);
  });
});

describe('#381 — the page-setup contract carries paper, pictures and the OBS layout', () => {
  it('defaults to A4, pictures on and pictures above the text, frozen, with semantic values only', () => {
    expect(DEFAULT_PAGE_SETUP).toEqual({ columns: 1, dropCapChapters: true, verseNumbers: true, spacing: 'single', paper: 'a4', pictures: true, obsLayout: 'above' });
    expect(Object.isFrozen(DEFAULT_PAGE_SETUP)).toBe(true);
    // A semantic choice, never a CSS value (no unit, no var(), no calc()).
    for (const value of Object.values(DEFAULT_PAGE_SETUP)) expect(String(value)).not.toMatch(/\d(px|pt|mm|in|em|rem)|var\(|calc\(/);
  });
});
