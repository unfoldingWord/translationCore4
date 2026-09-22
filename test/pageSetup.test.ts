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
