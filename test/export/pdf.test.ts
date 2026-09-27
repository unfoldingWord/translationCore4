// The PDF producer (issue #20): one print document of the whole book, the page
// setup applied as CSS, handed to the desktop bridge; the bridge's bytes are
// the file. A browser has no bridge, so the menu has no PDF item there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDF, printDocument, printStoriesDocument } from '../../src/data/export/pdf';
import { DEFAULT_PAGE_SETUP, type PageSetup } from '../../src/data/export/pageSetup';
import type { BurritoStore, ProjectSummary, Story } from '../../src/data/burritoStore';

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
  vi.unstubAllGlobals();
});

describe('the PDF producer', () => {
  it('shows for a Bible and an OBS project, and only when the desktop bridge exists', () => {
    expect(PDF.appliesTo(bible)).toBe(false); // a browser: no bridge, no menu item
    expect(PDF.appliesTo({ ...bible, flavor: 'textStories' })).toBe(false);
    installBridge();
    expect(PDF.appliesTo(bible)).toBe(true);
    expect(PDF.appliesTo({ ...bible, flavor: 'textStories' })).toBe(true);
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

// The OBS PDF (issue #360): every story in order, the flow layout, the
// pictures toggle, an undrafted frame stated.
describe('the OBS PDF', () => {
  const IMAGE = (n: string) => `![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-${n}.jpg)`;
  const STORIES: Record<number, Story> = {
    1: { number: 1, title: 'La Creación', frames: [{ image: IMAGE('01-01'), text: 'Así fue <como> Dios hizo todo.' }, { image: IMAGE('01-02'), text: '' }], ref: 'Una historia de Génesis 1-2' },
    2: { number: 2, title: '', frames: [{ image: IMAGE('02-01'), text: 'Adán y Eva.' }], ref: null },
  };
  const obs = { name: 'Equipo', flavor: 'textStories', scriptDirection: 'ltr' } as ProjectSummary;
  const obsStore = {
    listStories: vi.fn(async () => [2, 1]),
    readStory: vi.fn(async (n: number) => ({ bytes: '', md5: '', story: STORIES[n] })),
  } as unknown as BurritoStore;
  // Frame 2 of story 1 has no picture (the resolution found none).
  const storyPictures = vi.fn(async (n: number) => (n === 1 ? { '1': '/api/pic/01-01.jpg' } : { '1': '/api/pic/02-01.jpg' }));
  const stubFetch = (ok = true) => {
    const fetch = vi.fn<(uri: string) => Promise<Response>>(async () => new Response(ok ? new Uint8Array([255, 216, 255]) : 'gone', { status: ok ? 200 : 404, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('prints every story in order, each title on its own page, frames whole, and states an undrafted frame', () => {
    const html = printStoriesDocument('Equipo', [STORIES[1], STORIES[2]], {}, setup(), 'ltr');
    const titles = [...html.matchAll(/<h1 class="print-title print-story-title">([^<]+)<\/h1>/g)].map((m) => m[1]);
    expect(titles).toEqual(['La Creación', 'Story 2']); // an untitled story keeps its number
    expect(html.match(/<div class="print-frame">/g)).toHaveLength(3);
    expect(html).toContain('<p class="print-frame-text print-undrafted">[ frame not yet drafted ]</p>');
    expect(html).toContain('Así fue &lt;como&gt; Dios hizo todo.'); // text, never markup
    expect(html).toContain('<p class="print-story-reference">Una historia de Génesis 1-2</p>');
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(css).toMatch(/\.print-story \{ break-before: page; \}/);
    expect(css).toMatch(/\.print-story-title \{\s*break-after: page;/);
    expect(css).toMatch(/\.print-frame \{\s*break-inside: avoid;/);
  });

  it('inlines each resolved picture above its frame text, and names the file <project>-<date>.pdf', async () => {
    const printPdf = installBridge();
    const fetch = stubFetch();
    const file = await PDF.produce({ store: obsStore, project: obs, pageSetup: setup(), storyPictures });
    expect(file.filename).toMatch(/^Equipo-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(['/api/pic/01-01.jpg', '/api/pic/02-01.jpg']);
    const html = printPdf.mock.calls[0][0];
    expect(html.match(/<img class="print-frame-picture" src="data:image\/jpeg;base64,\/9j\/"/g)).toHaveLength(2);
    expect(html.indexOf('print-frame-picture')).toBeLessThan(html.indexOf('Así fue'));
    expect(html.indexOf('La Creación')).toBeLessThan(html.indexOf('Adán y Eva.')); // story 1 before story 2
  });

  it('with pictures off, prints no picture and reads none', async () => {
    const printPdf = installBridge();
    const fetch = stubFetch();
    storyPictures.mockClear();
    await PDF.produce({ store: obsStore, project: obs, pageSetup: setup({ pictures: false }), storyPictures });
    expect(printPdf.mock.calls[0][0]).not.toContain('<img');
    expect(storyPictures).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails, and prints nothing, when a resolved picture cannot be read', async () => {
    const printPdf = installBridge();
    stubFetch(false);
    await expect(PDF.produce({ store: obsStore, project: obs, pageSetup: setup(), storyPictures })).rejects.toThrow(/HTTP 404/);
    expect(printPdf).not.toHaveBeenCalled();
  });
});
