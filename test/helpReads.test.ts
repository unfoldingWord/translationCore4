// Round 31 (2026-08-28 adversarial review): only a true NOT-FOUND means "the
// installed resource has nothing for this book". A transport, server, or
// parse failure must reach settleHelp's stated, retryable error state — the
// old blanket catch told the translator the content was ABSENT (D30
// violation) and stranded the tab with no retry.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mapReference = vi.fn();
vi.mock('../src/data/mapReference', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mapReference: (...args: unknown[]) => mapReference(...args),
}));

beforeEach(() => {
  // Braces matter: mockReset() returns the mock, and a beforeEach that
  // RETURNS a function registers it as a cleanup hook vitest then calls bare.
  mapReference.mockReset();
});
import { __helpReadsForTests } from '../src/state.jsx';

const { readTextIngredient, loadSimplifiedHelp } = __helpReadsForTests;

const notFound = () => Object.assign(new Error('404'), { isNotFound: true });

describe('round 31 — readTextIngredient (the tN/tQ/twl TSV read)', () => {
  it('a NOT-FOUND reads as null (the missing state)', async () => {
    const api = { readIngredient: async () => { throw notFound(); } };
    expect(await readTextIngredient(api, 'repo', 'TIT.tsv')).toBeNull();
  });

  it('a transport failure PROPAGATES — never a false absence claim', async () => {
    const api = { readIngredient: async () => { throw new Error('socket hang up'); } };
    await expect(readTextIngredient(api, 'repo', 'TIT.tsv')).rejects.toThrow(/socket hang up/);
  });
});

describe('round 31 — loadSimplifiedHelp (the UST/GST read)', () => {
  const PIN = { repoPath: 'git.door43.org/unfoldingWord/en_ust', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' };
  const args = (readSourceBook: () => Promise<never>) => ({
    store: { readSourceBook },
    st: { projectPins: { languageSets: {} }, netEnabled: true },
    book: 'TIT',
    coverage: {},
    installed: { '_local_/_sideloaded_/unfoldingword--en_ust': PIN },
    sets: { primary: { simplifiedText: PIN } },
  });

  it('an absent book reads as missing', async () => {
    const slot = await loadSimplifiedHelp(args(async () => { throw notFound(); }) as never);
    expect(slot.state).toBe('missing');
  });

  it('a transport failure PROPAGATES to the stated error state', async () => {
    await expect(
      loadSimplifiedHelp(args(async () => { throw new Error('gateway timeout'); }) as never),
    ).rejects.toThrow(/gateway timeout/);
  });
});

describe('round 35 — readHelpArticle (the tW/tA article read)', () => {
  const { readHelpArticle } = __helpReadsForTests;
  const PIN_TW = { repoPath: 'git.door43.org/unfoldingWord/en_tw', sha: 'b'.repeat(40), flavor: 'x' };
  const set = { translationWords: PIN_TW };

  it('a transport failure PROPAGATES — never a false "article missing" claim', async () => {
    // readTwArticle's first read goes through the api client — reject it.
    const api = { readIngredient: async () => { throw new Error('socket hang up'); } };
    await expect(readHelpArticle(api, 'tw', set, 'kt', 'god')).rejects.toThrow(/socket hang up/);
  });

  it('a confirmed NOT-FOUND reads as null (the missing state)', async () => {
    const api = { readIngredient: async () => { throw notFound(); } };
    expect(await readHelpArticle(api, 'tw', set, 'kt', 'god')).toBeNull();
  });

  it('a set without the slot reads as null — absence, not error', async () => {
    expect(await readHelpArticle({}, 'tw', {}, 'kt', 'god')).toBeNull();
  });
});


describe('round 36 — cross-BOOK mappings are STATED, never rendered as this book at foreign numbers', () => {
  it('a mapping whose target book differs yields a crossBook entry; same-book mappings map normally', async () => {
    const { __mappedSourceReferencesForTests: mapRefs } = await import('../src/state.jsx');
    // LXX-style: EZR 11:1 maps to NEH 1:1 (a DIFFERENT book); EZR 1:1 maps
    // within the book.
    mapReference.mockImplementation(async ({ chapter }) =>
      chapter === 11
        ? { ok: true, mapped: true, reference: { book: 'NEH', chapter: 1, verse: 1 } }
        : { ok: true, mapped: true, reference: { book: 'EZR', chapter, verse: 1 } });
    const st = { bookRaw: '\\id EZR\n\\c 1\n\\p\n\\v 1 uno\n\\c 11\n\\p\n\\v 1 once\n' };
    const refs = (await mapRefs(st, 'EZR', { state: 'ready', name: 'lxx', schemes: {} })) as Record<string, unknown[]>;
    expect(refs['1']).toEqual([{ c: 1, v: '1', pc: '1', pv: '1' }]);
    expect(refs['11']).toEqual([{ crossBook: '11:1', to: 'NEH 1:1' }]);
  });
});

describe('round 36 — the simplified text carries the D41 warned-fallback signal', () => {
  const PIN_PRIMARY = { repoPath: 'git.door43.org/es-419_gl/es-419_gst', sha: 'c'.repeat(40), flavor: 'scripture/textTranslation' };
  const PIN_FALLBACK = { repoPath: 'git.door43.org/unfoldingWord/en_ust', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' };

  it('a fallback-rung resolution with a NON-LOCAL primary reports unavailablePrimary', async () => {
    const slot = await loadSimplifiedHelp({
      store: { readSourceBook: async () => ({ usfm: '\\id TIT\n\\c 1\n\\p\n\\v 1 one\n' }) },
      st: {
        projectPins: {
          languageSets: {
            primary: { gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' }, simplifiedText: PIN_PRIMARY },
            fallback: { gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' }, simplifiedText: PIN_FALLBACK },
          },
        },
        netEnabled: true,
      },
      book: 'TIT',
      // Coverage knows only the fallback pin covers the book -> fallback rung.
      coverage: { [`${PIN_FALLBACK.repoPath}@${PIN_FALLBACK.sha}`]: ['TIT'] },
      installed: { '_local_/_sideloaded_/unfoldingword--en_ust': PIN_FALLBACK },
      sets: { primary: { simplifiedText: PIN_PRIMARY }, fallback: { simplifiedText: PIN_FALLBACK } },
    } as never);
    expect(slot.state).toBe('ready');
    expect(slot.rung).toBe('fallback');
    expect(slot.unavailablePrimary).toEqual(PIN_PRIMARY); // English must not pass silently as es-419
  });
});
