// The PDF producer (issue #20): one print document of the whole book, the page
// setup applied as CSS, handed to the desktop bridge; the bridge's bytes are
// the file. A browser has no bridge, so the menu has no PDF item there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDF, printDocument } from '../../src/data/export/pdf';
import { DEFAULT_PAGE_SETUP, type PageSetup } from '../../src/data/export/pageSetup';
import type { BurritoStore, ProjectSummary } from '../../src/data/burritoStore';

const USFM = `\\id TIT
\\c 1
\\p
\\v 1 Paul, a servant of God.
\\v 2 ___
\\c 2
\\p
\\v 1 Speak <sound> doctrine.
\\c 3
\\p
\\v 1 ___
\\v 2 ___
`;
const bible = { name: 'demo', flavor: 'textTranslation', scriptDirection: 'ltr' } as ProjectSummary;
const store = { readBook: vi.fn(async () => ({ usfm: USFM })) } as unknown as BurritoStore;
const setup = (patch: Partial<PageSetup> = {}): PageSetup => ({ ...DEFAULT_PAGE_SETUP, ...patch });
const g = globalThis as { window?: unknown };

/** Install a desktop bridge that records the document and answers with `bytes`. */
const installBridge = (bytes = new Uint8Array([37, 80, 68, 70])) => {
  const printPdf = vi.fn<(html: string) => Promise<Uint8Array>>(async () => bytes);
  g.window = { tc4Desktop: { printPdf } };
  return printPdf;
};

afterEach(() => {
  delete g.window;
});

describe('the PDF producer', () => {
  it('shows only for a Bible project, and only when the desktop bridge exists', () => {
    expect(PDF.appliesTo(bible)).toBe(false); // a browser: no bridge, no menu item
    installBridge();
    expect(PDF.appliesTo(bible)).toBe(true);
    expect(PDF.appliesTo({ ...bible, flavor: 'textStories' })).toBe(false);
  });

  it('refuses with no bridge or no open book, and prints nothing', async () => {
    await expect(PDF.produce({ store, project: bible, book: 'TIT' })).rejects.toThrow(/desktop app/);
    const printPdf = installBridge();
    await expect(PDF.produce({ store, project: bible })).rejects.toThrow(/no book/);
    expect(printPdf).not.toHaveBeenCalled();
  });

  it('refuses a book with no drafted verse with export.nothing-drafted, and prints nothing', async () => {
    const printPdf = installBridge();
    const empty = { readBook: async () => ({ usfm: '\\id TIT\n\\c 1\n\\p\n\\v 1 ___\n\\v 2 ___\n' }) } as unknown as BurritoStore;
    await expect(PDF.produce({ store: empty, project: bible, book: 'TIT' })).rejects.toMatchObject({ code: 'export.nothing-drafted' });
    expect(printPdf).not.toHaveBeenCalled();
  });
});

describe('the print document', () => {
  it('holds every chapter with a drafted verse, and states an undrafted verse inside it as the preview does', () => {
    const html = printDocument(USFM, 'TIT', setup(), 'ltr');
    expect(html.match(/<section class="print-chapter"/g)).toHaveLength(2); // chapter 3 has no drafted verse
    expect(html).toContain('Paul, a servant of God.');
    expect(html).toContain('<span class="print-undrafted"><sup class="print-verse-number">2</sup>[ verse not yet drafted ] </span>');
    expect(html).toContain('Speak &lt;sound&gt; doctrine.'); // text, never markup
  });

  it('carries the paper, columns and spacing as CSS, in front of the whole print stylesheet', () => {
    const a4 = printDocument(USFM, 'TIT', setup(), 'ltr');
    const css = process.getBuiltinModule('node:fs').readFileSync(new URL('../../src/ds/tokens/print.css', import.meta.url), 'utf8');
    expect(a4).toContain(css);
    expect(a4).toContain('line-height: var(--print-leading)'); // the variables below reach the CSS
    expect(a4).toContain('@page { size: A4; margin: 18mm 16mm 20mm;');
    expect(a4).toContain('--print-columns: 1; --print-leading: 1.4;');
    const letter = printDocument(USFM, 'TIT', setup({ paper: 'letter', columns: 2, spacing: 'double' }), 'ltr');
    expect(letter).toContain('@page { size: letter; margin: 18mm 16mm 20mm;');
    expect(letter).toContain('--print-columns: 2; --print-leading: 2.8;');
  });

  it('adds drop caps and verse numbers only when the page setup asks, and sets the direction', () => {
    const on = printDocument(USFM, 'TIT', setup(), 'rtl');
    expect(on.match(/class="print-dropcap"/g)).toHaveLength(2);
    expect(on).not.toContain('class="print-chapter-heading"');
    expect(on.match(/class="print-verse-number"/g)).toHaveLength(3);
    expect(on).toContain('<html dir="rtl">');
    expect(on).toContain('<section class="print-chapter" dir="rtl">');
    const off = printDocument(USFM, 'TIT', setup({ dropCapChapters: false, verseNumbers: false }), 'ltr');
    expect(off).not.toContain('class="print-dropcap"');
    expect(off.match(/class="print-verse-number"/g)).toHaveLength(1); // the undrafted verse keeps its number
  });

  it('sets the whole book as one flow through the columns, and numbers each page at the bottom centre', () => {
    const html = printDocument(USFM, 'TIT', setup({ columns: 2 }), 'ltr');
    // One column container holds every chapter; no chapter has columns of its own.
    expect(html.match(/<div class="print-flow"/g)).toHaveLength(1);
    expect(html.indexOf('<div class="print-flow"')).toBeLessThan(html.indexOf('<section class="print-chapter"'));
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(css).toMatch(/\.print-flow \{\s*column-count: var\(--print-columns\);/);
    expect(css).not.toMatch(/\.print-chapter \{[^}]*column-count/);
    expect(css).toMatch(/@bottom-center \{\s*content: counter\(page\);/);
  });

  it('with drop caps off, opens each chapter with a "Chapter N" heading', () => {
    const off = printDocument(USFM, 'TIT', setup({ dropCapChapters: false }), 'ltr');
    expect(off.match(/<h2 class="print-chapter-heading">Chapter (\d+)<\/h2>/g)).toEqual([
      '<h2 class="print-chapter-heading">Chapter 1</h2>',
      '<h2 class="print-chapter-heading">Chapter 2</h2>',
    ]);
  });

  it('states undrafted chapters between two drafted ones as one line, and leaves out those at the ends', () => {
    // Chapters 1 and 9 are undrafted at the ends; 3 alone and 5–7 are undrafted runs between drafted chapters.
    const drafted = new Set([2, 4, 8]);
    const book = ['\\id TIT', ...Array.from({ length: 9 }, (_, i) => `\\c ${i + 1}\n\\p\n\\v 1 ${drafted.has(i + 1) ? `Verse of chapter ${i + 1}.` : '___'}`)].join('\n') + '\n';
    const html = printDocument(book, 'TIT', setup({ dropCapChapters: false }), 'ltr');
    const order = [...html.matchAll(/<h2 class="print-chapter-heading">(Chapter \d+)<\/h2>|<p class="print-chapter-gap" dir="ltr">([^<]+)<\/p>/g)].map((m) => m[1] ?? m[2]);
    expect(order).toEqual([
      'Chapter 2',
      '[ chapter 3 not yet drafted ]',
      'Chapter 4',
      '[ chapters 5–7 not yet drafted ]',
      'Chapter 8',
    ]);
  });
});
