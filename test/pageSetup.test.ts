import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, PAGE_SPACING_FACTOR } from '../src/data/export/pageSetup';
import { PRINT_LEADING, printVariables } from '../src/views/print/PrintBook.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const typography = fs.readFileSync(path.resolve(process.cwd(), 'src/ds/tokens/typography.css'), 'utf8');

describe('#142 — Community Checking spacing token contract', () => {
  it('keeps Single at 1.4 × the verse size (#20) and Double exactly twice Single, for the preview and the PDF alike', () => {
    expect(Object.isFrozen(DEFAULT_PAGE_SETUP)).toBe(true);
    expect(PAGE_SPACING_FACTOR.single).toBe(1);
    expect(PAGE_SPACING_FACTOR.double).toBe(2);
    expect(PRINT_LEADING).toBe(1.4);
    // One source: the preview sheets and the print document both read printVariables.
    expect(printVariables({ ...DEFAULT_PAGE_SETUP, spacing: 'single' })['--print-leading']).toBe(1.4);
    expect(printVariables({ ...DEFAULT_PAGE_SETUP, spacing: 'double' })['--print-leading']).toBe(2.8);
    expect(typography).not.toContain('--lh-community-checking');
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
