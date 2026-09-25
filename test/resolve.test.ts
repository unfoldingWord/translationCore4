// (tool, book) resolution + check-session preflight — the five D30 constraints
// as executable rules (BURRITO-SPEC §5.3; INCREMENT-2 C2.1/C2.2).
import { describe, expect, it } from 'vitest';
import {
  resolveToolBook,
  preflightToolBook,
  resolutionRecord,
  recordMatchesResolution,
  pinKey,
} from '../src/data/resolve';
import type { Coverage } from '../src/data/resolve';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';

// Deterministic fake sha per (repo, version) — D58: identity is the sha, so
// the fixtures derive one from the same (repo, version) distinctions the
// tests were written with.
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};

const pin = (repo: string, version: string): ResourcePin => ({
  repoPath: `git.door43.org/${repo}`,
  version,
  sha: sha40(`${repo.toLowerCase()}@${version}`),
  flavor: 'parascriptural/x-bcvnotes',
});

const set = (lang: string, owner: string, org: string, v: string) => ({
  gatewayLanguage: { languageId: lang, owner },
  translationNotes: pin(`${org}/${lang}_tn`, v),
  translationWordsLinks: pin(`${org}/${lang}_twl`, v),
  translationWords: pin(`${org}/${lang}_tw`, v),
  translationAcademy: pin(`${org}/${lang}_ta`, v),
});

// Real-shaped fixture: es-419 primary (partial coverage — the D17 driver),
// English fallback (whole canon).
const RESOURCES: ResourcesFile = {
  schemaVersion: 2,
  languageSets: {
    primary: set('es-419', 'Es-419_gl', 'Es-419_gl', 'v66'),
    fallback: set('en', 'unfoldingWord', 'unfoldingWord', 'v86'),
  },
  resources: {},
};

// es-419 covers only its 4 released books; English covers the canon.
// Local coverage is keyed by the exact pin identity (repoPath + sha).
const COVERAGE: Coverage = {
  [pinKey(RESOURCES.languageSets.primary.translationNotes)]: ['3JN', 'JON', 'RUT', 'TIT'],
  [pinKey(RESOURCES.languageSets.primary.translationWordsLinks)]: ['3JN', 'JON', 'RUT', 'TIT'],
  [pinKey(RESOURCES.languageSets.fallback.translationNotes)]: ['TIT', 'JON', 'HEB', 'PSA'],
  [pinKey(RESOURCES.languageSets.fallback.translationWordsLinks)]: ['TIT', 'JON', 'HEB', 'PSA'],
};

const allLocal = () => true;
const noneLocal = () => false;

describe('D30.1 — the resolution unit is (tool, book)', () => {
  it('resolves per tool AND per book, not per project', () => {
    const tn = resolveToolBook(RESOURCES, 'translationNotes', 'TIT', COVERAGE);
    const heb = resolveToolBook(RESOURCES, 'translationNotes', 'HEB', COVERAGE);
    expect(tn.rung).toBe('primary');
    expect(heb.rung).toBe('fallback'); // same tool, different book, different rung
  });
});

describe('D30.2 — the automatic ladder is exactly two rungs', () => {
  it('neither rung covers the book → no resolution (the tool is not offered)', () => {
    const r = resolveToolBook(RESOURCES, 'translationNotes', 'REV', COVERAGE);
    expect(r.rung).toBeNull();
    expect(r.pin).toBeNull();
    expect(resolutionRecord(r)).toBeNull();
  });

  it('there is no third rung to fall to — a hypothetical extra set is never consulted', () => {
    const withExtra = {
      ...RESOURCES,
      languageSets: { ...RESOURCES.languageSets, other: set('fr', 'fr_gl', 'fr_gl', 'v31') },
    } as unknown as ResourcesFile;
    const cov: Coverage = {
      ...COVERAGE,
      [pinKey(pin('fr_gl/fr_tn', 'v31'))]: ['REV'],
    };
    // REV exists ONLY in the extra set; the ladder must still refuse it.
    expect(resolveToolBook(withExtra, 'translationNotes', 'REV', cov).rung).toBeNull();
  });
});

describe('D30.4 / D30.5 — missing pinned version: fetch when online, first-class unavailable when offline', () => {
  const opts = (online: boolean, isLocal: () => boolean) => ({ coverage: COVERAGE, isLocal, online });

  it('no resources.json at all → unpinned (distinct from unavailable)', () => {
    expect(preflightToolBook(null, 'translationNotes', 'TIT', opts(true, allLocal)).state)
      .toBe('unpinned');
  });

  it('pins local and complete, but the book is in neither → not-covered (distinct again)', () => {
    expect(preflightToolBook(RESOURCES, 'translationNotes', 'REV', opts(true, allLocal)).state)
      .toBe('not-covered');
  });

  it('offline with unknown coverage (nothing fetched yet) is unavailable, not a false not-covered verdict', () => {
    expect(preflightToolBook(RESOURCES, 'translationNotes', 'REV', {
      coverage: {}, isLocal: noneLocal, online: false,
    }).state)
      .toBe('unavailable');
  });
});

describe('D17 — a resolution change is a warned update, never silent', () => {
  it('a stored §5.2 record that no longer matches the resolution is detectable', () => {
    const now = resolveToolBook(RESOURCES, 'translationNotes', 'TIT', COVERAGE);
    // D58: the match is (repoPath + sha); the version label is not compared.
    expect(recordMatchesResolution(
      { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v66', sha: sha40('es-419_gl/es-419_tn@v66') }, now,
    )).toBe(true);
    // Same repo at a different commit → changed; and a language switch → changed.
    expect(recordMatchesResolution(
      { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v67', sha: sha40('es-419_gl/es-419_tn@v67') }, now,
    )).toBe(false);
    expect(recordMatchesResolution(
      { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: sha40('unfoldingword/en_tn@v86') }, now,
    )).toBe(false);
    // A tC3-era record with no sha never matches — the warned update, the safe direction.
    expect(recordMatchesResolution(
      { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v66' }, now,
    )).toBe(false);
    expect(recordMatchesResolution(null, now)).toBe(false);
  });
});
