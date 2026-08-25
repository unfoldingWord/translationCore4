// Per-pin book coverage — issue #16 / D41.
//
// The point of #16 is to separate two cases the resolver could not previously
// tell apart:
//
//   "the pinned resource does not have this book"  -> fall back, correctly
//   "the pinned resource is not downloaded yet"    -> FETCH it, do not substitute
//
// Before coverage was recorded, both looked like "not in the local coverage map"
// and both fell back to English with a warning (B20). These tests drive the three
// resulting states, and the backfill that retires the ambiguity for old pins.
import { describe, expect, it } from 'vitest';
import { backfillCoverage } from '../src/data/coverageBackfill';
import {
  coverageFor,
  covers,
  pinKey,
  preflightToolBook,
  resolveToolBook,
  type Coverage,
} from '../src/data/resolve';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';
import { pinEntryError } from '../conformance/journal/grammar.mjs';

const sha = (s: string): string =>
  s
    .padEnd(40, '0')
    .slice(0, 40)
    .replace(/[^0-9a-f]/g, 'a');

const pin = (repoPath: string, extra: Partial<ResourcePin> = {}): ResourcePin => ({
  repoPath,
  version: 'v1',
  flavor: 'parascriptural/x-bcvarticles',
  sha: sha(repoPath),
  ...extra,
});

const ES_TN = 'git.door43.org/es-419_gl/es-419_tn';
const ES_TWL = 'git.door43.org/es-419_gl/es-419_tw';
const EN_TN = 'git.door43.org/unfoldingWord/en_tn';
const EN_TWL = 'git.door43.org/unfoldingWord/en_tw';

const resources = (primary: Partial<Record<string, ResourcePin>> = {}): ResourcesFile =>
  ({
    schemaVersion: 2,
    languageSets: {
      primary: {
        gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' },
        translationNotes: primary.translationNotes ?? pin(ES_TN),
        translationWordsLinks: primary.translationWordsLinks ?? pin(ES_TWL),
        translationWords: primary.translationWords ?? pin(ES_TWL),
        translationAcademy: pin('git.door43.org/es-419_gl/es-419_ta'),
      },
      fallback: {
        gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
        translationNotes: pin(EN_TN, { books: ['TIT', 'JON', 'MRK'] }),
        translationWordsLinks: pin(EN_TWL, { books: ['TIT', 'JON', 'MRK'] }),
        translationWords: pin(EN_TWL, { books: ['TIT', 'JON', 'MRK'] }),
        translationAcademy: pin('git.door43.org/unfoldingWord/en_ta'),
      },
    },
  }) as unknown as ResourcesFile;

describe('coverageFor — the pin outranks the local scan', () => {
  it("uses the pin's own record even when nothing is installed", () => {
    const p = pin(ES_TN, { books: ['tit', 'jon'] });
    expect(coverageFor({}, p)).toEqual({ books: ['TIT', 'JON'], source: 'pin' });
  });

  it('falls back to the local scan when the pin records nothing', () => {
    const p = pin(ES_TN);
    const local: Coverage = { [pinKey(p)]: ['TIT'] };
    expect(coverageFor(local, p)).toEqual({ books: ['TIT'], source: 'local' });
  });

  it('reports `none` when neither knows — the only genuinely ambiguous state', () => {
    expect(coverageFor({}, pin(ES_TN))).toEqual({ books: [], source: 'none' });
  });

  it('a recorded empty list is not treated as a record', () => {
    // `books: []` cannot be distinguished from "captured nothing", so it must not
    // out-rank a usable local scan.
    const p = pin(ES_TN, { books: [] });
    expect(coverageFor({ [pinKey(p)]: ['TIT'] }, p).source).toBe('local');
  });

  it('malformed legacy coverage degrades to unknown instead of crashing', () => {
    expect(coverageFor({}, pin(ES_TN, { books: 'TIT' as never }))).toEqual({
      books: [],
      source: 'none',
    });
    expect(coverageFor({}, pin(ES_TN, { books: ['TIT', 42] as never }))).toEqual({
      books: [],
      source: 'none',
    });
  });

  it('covers() reads through the same precedence', () => {
    expect(covers({}, pin(ES_TN, { books: ['TIT'] }), 'tit')).toBe(true);
    expect(covers({}, pin(ES_TN, { books: ['TIT'] }), 'JON')).toBe(false);
  });
});

describe('the resolver now tells the two cases apart', () => {
  const isLocal = (installed: ResourcePin[]) => (p: ResourcePin) =>
    installed.some((i) => pinKey(i) === pinKey(p));

  it('covered but NOT downloaded -> fetch the primary, never substitute English', () => {
    // The case #16 exists for. The primary records that it HAS Titus, so the
    // resolver must fetch it rather than quietly checking against English.
    const res = resources({
      translationWordsLinks: pin(ES_TWL, { books: ['TIT', 'JON'] }),
    });
    const pre = preflightToolBook(res, 'translationWords', 'TIT', {
      coverage: {},
      isLocal: isLocal([]),
      online: true,
    });
    expect(pre.state).toBe('fetch');
    expect(pre.resolution?.rung).toBe('primary');
    expect(pre.needs?.repoPath).toBe(ES_TWL);
    expect(pre.unavailablePrimary ?? null).toBeNull(); // nothing was substituted
  });

  it('covered but not downloaded and OFFLINE -> unavailable, still not English', () => {
    const res = resources({
      translationWordsLinks: pin(ES_TWL, { books: ['TIT'] }),
    });
    const pre = preflightToolBook(res, 'translationWords', 'TIT', {
      coverage: {},
      isLocal: isLocal([]),
      online: false,
    });
    expect(pre.state).toBe('unavailable');
    expect(pre.resolution?.rung).toBe('primary');
  });

  it('NOT covered -> fall back with NO warning; nothing is being substituted', () => {
    // The primary genuinely lacks Mark. Falling back is plainly correct, so the
    // B20 banner must not fire — that banner means "you are checking against a
    // substitute", which is not what is happening here.
    const res = resources({
      translationWordsLinks: pin(ES_TWL, { books: ['TIT', 'JON'] }),
    });
    const en = res.languageSets.fallback.translationWordsLinks;
    const pre = preflightToolBook(res, 'translationWords', 'MRK', {
      coverage: {},
      isLocal: isLocal([en]),
      online: true,
    });
    expect(pre.resolution?.rung).toBe('fallback');
    expect(pre.state).toBe('ready');
    expect(pre.unavailablePrimary ?? null).toBeNull();
  });

  it('NO recorded coverage and not local -> the warned fallback still fires', () => {
    // The migration case, and the only one left. Nobody knows whether the
    // primary has this book, so the session opens against English and says so.
    const res = resources(); // primary pins carry no `books`
    const en = res.languageSets.fallback.translationWordsLinks;
    const pre = preflightToolBook(res, 'translationWords', 'TIT', {
      coverage: {},
      isLocal: isLocal([en]),
      online: true,
    });
    expect(pre.resolution?.rung).toBe('fallback');
    expect(pre.unavailablePrimary?.repoPath).toBe(ES_TWL);
  });
});

describe('backfillCoverage — retires the ambiguity for old pins (owner ruling 3c)', () => {
  it('fills a coverage-less pin from the local install', () => {
    const res = resources();
    const local: Coverage = {
      [pinKey(pin(ES_TWL))]: ['TIT', 'JON'],
      [pinKey(pin(ES_TN))]: ['TIT'],
    };
    const out = backfillCoverage(res, local);

    expect(out.changed).toBe(true);
    expect(out.resources.languageSets.primary.translationWordsLinks.books).toEqual(['TIT', 'JON']);
    expect(out.resources.languageSets.primary.translationNotes.books).toEqual(['TIT']);
    expect(out.filled).toContain(`${ES_TWL}@${sha(ES_TWL)}`);
  });

  it('leaves a pin alone when the resource is not local — that is the honest unknown', () => {
    const out = backfillCoverage(resources(), {});
    expect(out.changed).toBe(false);
    expect(out.filled).toEqual([]);
    expect(out.resources.languageSets.primary.translationWordsLinks.books).toBeUndefined();
  });

  it('never overwrites coverage a pin already records', () => {
    // A pin's identity is repoPath + sha, so its contents cannot change: a
    // recorded list is a fact, and re-deriving it from a possibly-partial local
    // install could only lose information.
    //
    // Asserted on the SPECIFIC pin rather than on `changed`: other slots in the
    // fixture legitimately have no coverage and will be filled from the same
    // local map, so `changed` is true for reasons unrelated to this invariant.
    // Both tW slots carry the recorded pin: per D34 the tW tool pins and fetches
    // `<lang>_tw` only, so translationWords and translationWordsLinks name the
    // SAME repo at the same sha — and therefore share a pinKey. Overriding just
    // one would leave the other fillable and put that shared key in `filled`.
    const recorded = pin(ES_TWL, { books: ['TIT', 'JON'] });
    const res = resources({ translationWordsLinks: recorded, translationWords: recorded });
    const out = backfillCoverage(res, { [pinKey(recorded)]: ['TIT'] }); // local knows LESS

    expect(out.resources.languageSets.primary.translationWordsLinks.books).toEqual(['TIT', 'JON']);
    expect(out.resources.languageSets.primary.translationWords.books).toEqual(['TIT', 'JON']);
    expect(out.filled).not.toContain(pinKey(recorded));
  });

  it('widens an incomplete record from a sha-exact local read, never shrinks it', () => {
    // A record captured from a partial copy at the pinned sha (single-book
    // sideload, interrupted install) silently substitutes the fallback for
    // books the resource covers. Books a sha-exact local read proves present
    // are facts about the same commit, so the record heals once the full
    // resource is installed — while the recorded books are always kept.
    const recorded = pin(ES_TWL, { books: ['TIT'] });
    const res = resources({ translationWordsLinks: recorded, translationWords: recorded });
    const out = backfillCoverage(res, { [pinKey(recorded)]: ['TIT', 'JON'] }); // local knows MORE

    expect(out.changed).toBe(true);
    expect(out.resources.languageSets.primary.translationWordsLinks.books).toEqual(['TIT', 'JON']);
    expect(out.filled).toContain(pinKey(recorded));
  });

  it("records the whole-collection form for a 'BIBLE' marker; 'TRANSLATE' has no form", () => {
    // The platform reports whole-collection resources with non-book book_codes
    // (tw: ['BIBLE'], ta: ['TRANSLATE'] — see test/installed.test.ts). The tw
    // marker is recorded as EXACTLY ['BIBLE'] (§5.3 whole-collection form) so
    // the fact travels with the project; ta has no §5.3 form and no consumer,
    // so it stays untouched — and the seal must accept everything produced.
    const res = resources();
    const local: Coverage = {
      [pinKey(pin(ES_TWL))]: ['BIBLE'],
      [pinKey(pin('git.door43.org/es-419_gl/es-419_ta'))]: ['TRANSLATE'],
    };
    const out = backfillCoverage(res, local);
    expect(out.changed).toBe(true);
    expect(out.resources.languageSets.primary.translationWords.books).toEqual(['BIBLE']);
    expect(out.resources.languageSets.primary.translationAcademy.books).toBeUndefined();
    for (const [slot, entry] of Object.entries(out.resources.languageSets.primary)) {
      expect(pinEntryError(`languageSets.primary.${slot}`, entry)).toBeNull();
    }
  });

  it('a marker beside book codes records the marker alone — never a mixed list', () => {
    // The §5.3 form is EXACTLY ['BIBLE']; a mixed list refuses at the seal, and
    // recording only the book codes would falsely SHRINK the coverage.
    const local: Coverage = { [pinKey(pin(ES_TWL))]: ['BIBLE', 'TIT'] };
    const out = backfillCoverage(resources(), local);
    expect(out.resources.languageSets.primary.translationWordsLinks.books).toEqual(['BIBLE']);
  });

  it('the whole-collection record travels: another machine fetches the primary, not the fallback', () => {
    // The 2026-08-25 follow-up review, finding 1: machine A backfills the
    // marker; machine B has NO local copy of the primary tW. #16's whole point
    // is that the record answers where the local scan cannot — the resolver
    // must pick the primary and preflight must FETCH it, never open the
    // warned English fallback.
    const machineA = backfillCoverage(resources(), { [pinKey(pin(ES_TWL))]: ['BIBLE'] });
    const en = machineA.resources.languageSets.fallback.translationWordsLinks;
    const pre = preflightToolBook(machineA.resources, 'translationWords', 'TIT', {
      coverage: {}, // machine B: primary not installed, nothing scanned
      isLocal: (p) => pinKey(p) === pinKey(en), // only the English suite is local
      online: true,
    });
    expect(pre.resolution?.rung).toBe('primary');
    expect(pre.state).toBe('fetch');
    expect(pre.needs?.repoPath).toBe(ES_TWL);
    expect(pre.unavailablePrimary ?? null).toBeNull(); // nothing substituted, nothing to warn
  });

  it('every pin the backfill produces passes the §5.3 entry validator (the seal contract)', () => {
    const local: Coverage = {
      [pinKey(pin(ES_TWL))]: ['TIT', 'JON'],
      [pinKey(pin(ES_TN))]: ['TIT'],
    };
    const out = backfillCoverage(resources(), local);
    for (const [slot, entry] of Object.entries(out.resources.languageSets.primary)) {
      expect(pinEntryError(`languageSets.primary.${slot}`, entry)).toBeNull();
    }
  });

  it('is idempotent — a second pass changes nothing', () => {
    const local: Coverage = {
      [pinKey(pin(ES_TWL))]: ['TIT', 'JON'],
      [pinKey(pin(ES_TN))]: ['TIT'],
    };
    const first = backfillCoverage(resources(), local);
    const second = backfillCoverage(first.resources, local);
    expect(second.changed).toBe(false);
    expect(second.filled).toEqual([]);
  });

  it('backfilling then resolving removes the warning', () => {
    // The end-to-end point of 3c: after one open with the resource present, an
    // old project stops seeing the B20 banner for that pin.
    const local: Coverage = { [pinKey(pin(ES_TWL))]: ['TIT', 'JON'] };
    const before = preflightToolBook(resources(), 'translationWords', 'MRK', {
      coverage: {},
      isLocal: () => false,
      online: true,
    });
    expect(before.unavailablePrimary?.repoPath).toBe(ES_TWL);

    const after = backfillCoverage(resources(), local);
    const pre = preflightToolBook(after.resources, 'translationWords', 'MRK', {
      coverage: {},
      isLocal: () => false,
      online: true,
    });
    // Now the pin says it has no Mark, so the fallback is correct and unwarned.
    expect(pre.resolution?.rung).toBe('fallback');
    expect(pre.unavailablePrimary ?? null).toBeNull();
  });
});

describe('whole-collection resources cover every book (2026-08-25 review, finding 1)', () => {
  // The platform reports the tw articles with book_codes ['BIBLE'] — the
  // resource is not book-partitioned. Fresh installs would otherwise resolve
  // tN to primary but tW to rung null (Translation Words unavailable), because
  // 'BIBLE' matches no literal book code.
  it('a fresh tW install (local BIBLE marker) resolves to primary', () => {
    const twPin = pin(ES_TWL);
    const res = resources({ translationWordsLinks: twPin, translationWords: twPin });
    const local: Coverage = { [pinKey(twPin)]: ['BIBLE'] };
    const r = resolveToolBook(res, 'translationWords', 'TIT', local);
    expect(r.rung).toBe('primary');
    expect(r.pin?.repoPath).toBe(ES_TWL);
  });

  it('covers() reads the marker as every book', () => {
    const p = pin(ES_TWL);
    const local: Coverage = { [pinKey(p)]: ['BIBLE'] };
    for (const book of ['TIT', 'JON', 'GEN', 'REV']) {
      expect(covers(local, p, book)).toBe(true);
    }
  });

  it('a preflight with the marker is ready when local, never not-covered', () => {
    const twPin = pin(ES_TWL);
    const res = resources({ translationWordsLinks: twPin, translationWords: twPin });
    const local: Coverage = { [pinKey(twPin)]: ['BIBLE'] };
    const pre = preflightToolBook(res, 'translationWords', 'TIT', {
      coverage: local,
      isLocal: (p) => pinKey(p) === pinKey(twPin),
      online: true,
    });
    expect(pre.state).toBe('ready');
    expect(pre.unavailablePrimary ?? null).toBeNull();
  });
});

describe('coverage is keyed by pin identity, not by repo path', () => {
  it('local coverage from another commit cannot backfill an older pin', () => {
    const older = pin(ES_TWL);
    const installed = { ...older, sha: sha('newer-commit') };
    const res = resources({ translationWordsLinks: older, translationWords: older });
    const out = backfillCoverage(res, { [pinKey(installed)]: ['MRK'] });

    expect(out.changed).toBe(false);
    expect(out.resources.languageSets.primary.translationWordsLinks.books).toBeUndefined();
    expect(coverageFor({ [pinKey(installed)]: ['MRK'] }, older).source).toBe('none');
  });

  it('two commits of one repo do not share a recorded coverage', () => {
    // repoPath alone collides across shas. The recorded list lives ON the pin,
    // so a re-pin cannot inherit the previous commit's coverage.
    const older = pin(ES_TWL, { books: ['TIT'] });
    const newer: ResourcePin = { ...pin(ES_TWL), sha: sha('newer-commit') };
    expect(pinKey(older)).not.toBe(pinKey(newer));
    expect(coverageFor({}, older)).toEqual({ books: ['TIT'], source: 'pin' });
    expect(coverageFor({}, newer)).toEqual({ books: [], source: 'none' });
  });

  it('resolveToolBook honours the per-pin record', () => {
    const res = resources({ translationWordsLinks: pin(ES_TWL, { books: ['JON'] }) });
    expect(resolveToolBook(res, 'translationWords', 'JON', {}).rung).toBe('primary');
    expect(resolveToolBook(res, 'translationWords', 'TIT', {}).rung).toBe('fallback');
  });

  it('does not fetch a pin whose recorded coverage excludes the book', () => {
    const res = resources({
      translationNotes: pin(ES_TN, { books: ['TIT'] }),
    });
    const pre = preflightToolBook(res, 'translationNotes', 'REV', {
      coverage: {},
      isLocal: () => false,
      online: true,
    });

    expect(pre.state).toBe('not-covered');
    expect(pre.needs).toBeNull();
  });
});
