// Source-package rows (J3, C2.2) built from the platform's LIVE catalog shape.
// The fixture below is the real `GET /gitea/remote-repos/git.door43.org/
// unfoldingword` payload, trimmed to the fields packageRows reads
// [VERIFIED live 2026-08-03 against the 0.18.5 rig: 66 repos, 17 tc-ready].
import { describe, expect, it } from 'vitest';
import { packageRows } from '../src/state.jsx';

type Repo = { name: string; flavor: string; topics: string[]; book_codes: string[]; description?: string };

// Real values, including the two traps: en_tw and en_ta share the catalog
// flavor `x-peripheralArticles`, and en_twl carries `x-bcvarticles`.
const CATALOG: Repo[] = [
  { name: 'en_tn', flavor: 'x-bcvnotes', topics: ['tc-ready'], book_codes: ['tit', 'jon', 'heb'], description: 'unfoldingWord® Translation Notes' },
  { name: 'en_tq', flavor: 'x-bcvquestions', topics: ['tc-ready'], book_codes: ['tit', 'jon'], description: 'unfoldingWord® Translation Questions' },
  { name: 'en_tw', flavor: 'x-peripheralArticles', topics: ['tc-ready'], book_codes: ['bible'], description: 'unfoldingWord® Translation Words' },
  { name: 'en_ta', flavor: 'x-peripheralArticles', topics: ['tc-ready'], book_codes: ['intro', 'process', 'translate', 'checking'], description: 'unfoldingWord® Translation Academy' },
  { name: 'en_twl', flavor: 'x-bcvarticles', topics: ['tc-ready'], book_codes: ['tit', 'jon'], description: 'Links from the original language words' },
  { name: 'en_ult', flavor: 'textTranslation', topics: ['tc-ready'], book_codes: ['tit', 'jon'], description: 'unfoldingWord® Literal Text' },
  { name: 'en_ust', flavor: 'textTranslation', topics: ['tc-ready'], book_codes: ['tit', 'jon'], description: 'unfoldingWord® Simplified Text' },
  { name: 'en_t4t', flavor: 'textTranslation', topics: ['tc-ready'], book_codes: ['gen', 'jon'], description: 'Translation For Translators' },
  { name: 'en_obs', flavor: 'textStories', topics: ['tc-ready', 'obs'], book_codes: ['obs'], description: 'Open Bible Stories' },
  { name: 'en_obs-tn', flavor: 'x-notes', topics: ['tc-ready', 'obs'], book_codes: ['obs'], description: 'OBS notes' },
  { name: 'ContentTechs', flavor: '', topics: [], book_codes: [], description: 'Not a resource' },
];

const rowsFor = (book: string) => packageRows(CATALOG, book);
const roleOf = (rows: ReturnType<typeof packageRows>, repo: string) =>
  rows.find((r) => r.repo === repo)?.name;

describe('packageRows — role assignment against the real catalog shape', () => {
  const rows = rowsFor('TIT');

  it('labels tW correctly even though the catalog gives it the tA flavor', () => {
    // The trap: both report x-peripheralArticles. Flavor alone mislabels tW.
    expect(roleOf(rows, 'en_tw')).toBe('Translation Words + Links');
    expect(roleOf(rows, 'en_ta')).toBe('Translation Academy');
  });

  it('never offers <lang>_twl — D34 pins <lang>_tw, whose export carries the links', () => {
    expect(rows.some((r) => r.repo === 'en_twl')).toBe(false);
  });

  it('offers notes, questions and the source texts with the right roles', () => {
    expect(roleOf(rows, 'en_tn')).toBe('Translation Notes');
    expect(roleOf(rows, 'en_tq')).toBe('Translation Questions');
    expect(roleOf(rows, 'en_ult')).toBe('Source text');
  });

  it('skips repos without the tc-ready topic and OBS resources', () => {
    expect(rows.some((r) => r.repo === 'ContentTechs')).toBe(false);
    expect(rows.some((r) => r.repo.startsWith('en_obs'))).toBe(false);
  });
});

describe('packageRows — coverage comes from the platform, so rows never over-promise', () => {
  it('a book-scoped resource that does not cover the book is not offered', () => {
    // en_tq covers tit+jon only; HEB must not offer it, but tN (which covers
    // heb) must still appear.
    const heb = rowsFor('HEB');
    expect(heb.some((r) => r.repo === 'en_tq')).toBe(false);
    expect(heb.some((r) => r.repo === 'en_tn')).toBe(true);
    // en_t4t covers gen+jon, not heb.
    expect(heb.some((r) => r.repo === 'en_t4t')).toBe(false);
  });

  it('book-independent resources (tW articles, tA) are offered for every book', () => {
    for (const book of ['TIT', 'HEB', 'REV']) {
      const rows = rowsFor(book);
      expect(rows.some((r) => r.repo === 'en_tw'), `tw for ${book}`).toBe(true);
      expect(rows.some((r) => r.repo === 'en_ta'), `ta for ${book}`).toBe(true);
    }
  });

  it('a book no resource covers yields only the book-independent rows', () => {
    const rev = rowsFor('REV').map((r) => r.repo).sort();
    expect(rev).toEqual(['en_ta', 'en_tw']);
  });

  it('the book match is case-insensitive — the catalog reports lowercase codes', () => {
    expect(rowsFor('tit').some((r) => r.repo === 'en_tn')).toBe(true);
  });
});

describe('packageRows — selection state', () => {
  it('source texts are always included; helps are opt-out', () => {
    const rows = rowsFor('TIT');
    expect(rows.find((r) => r.repo === 'en_ult')?.fixed).toBe(true);
    expect(rows.find((r) => r.repo === 'en_tn')?.fixed).toBe(false);
    expect(rows.every((r) => r.on)).toBe(true); // nothing excluded by default
  });

  it('an excluded key turns that row off without touching the others', () => {
    const rows = packageRows(CATALOG, 'TIT', { 'notes:en_tn': true });
    expect(rows.find((r) => r.repo === 'en_tn')?.on).toBe(false);
    expect(rows.find((r) => r.repo === 'en_tq')?.on).toBe(true);
  });
});
