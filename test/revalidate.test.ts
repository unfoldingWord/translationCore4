// C2.8 — revalidation. Two independent "the ground moved" checks, neither of
// which may ever discard a decision.
import { describe, expect, it } from 'vitest';
import {
  decisionIsStale,
  revalidateAgainstDraft,
  resolutionWarning,
  isLanguageSwitch,
} from '../src/data/revalidate';
import type { CheckItem } from '../src/data/derive';
import type { Resolution } from '../src/data/resolve';

const VERSE = 'Pablo, siervo de Dios y apóstol de Jesucristo, según la fe de los escogidos';

const item = (over: Partial<CheckItem> = {}): CheckItem =>
  ({
    contextId: {
      checkId: 't1g7',
      reference: { bookId: 'tit', chapter: 1, verse: 1 },
      tool: 'translationWords',
      groupId: 'god',
      quote: 'Θεοῦ',
      quoteString: 'Θεοῦ',
      occurrence: 1,
    },
    selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
    comments: false,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
    ...over,
  }) as CheckItem;

describe('I-3 text revalidation — a decision goes stale when its words leave the draft', () => {
  it('selections still present in the verse are NOT stale', () => {
    expect(decisionIsStale(item(), VERSE)).toBe(false);
  });

  it('selections removed by an edit ARE stale', () => {
    const edited = VERSE.replace('Dios', 'Señor');
    expect(decisionIsStale(item(), edited)).toBe(true);
  });

  it('an untouched item cannot be stale — there is nothing to invalidate', () => {
    expect(decisionIsStale(item({ selections: false }), VERSE.replace('Dios', 'X'))).toBe(false);
  });

  it('nothing-to-select cannot be stale either', () => {
    const nts = item({ selections: false, nothingToSelect: true });
    expect(decisionIsStale(nts, VERSE.replace('Dios', 'X'))).toBe(false);
  });

  it('a verse with no draft yet is not evidence of staleness', () => {
    expect(decisionIsStale(item(), undefined)).toBe(false);
  });
});

describe('revalidateAgainstDraft — flags, never deletes', () => {
  const verses = { '1:1': VERSE.replace('Dios', 'Señor'), '1:4': VERSE };

  it('flags the stale item and counts it', () => {
    const { items, invalidated } = revalidateAgainstDraft([item()], verses);
    expect(invalidated).toBe(1);
    expect(items[0].invalidated).toBe(true);
    expect(items[0].status).toBe('invalid');
    // The decision itself survives untouched — only flags were added.
    expect(items[0].selections).toEqual([{ text: 'Dios', occurrence: 1, occurrences: 1 }]);
  });

  it('does not double-count an item already flagged', () => {
    const already = item({ invalidated: true });
    expect(revalidateAgainstDraft([already], verses).invalidated).toBe(0);
  });

  it('leaves items in unedited verses alone', () => {
    const other = item({
      contextId: { ...item().contextId, reference: { bookId: 'tit', chapter: 1, verse: 4 } },
    } as Partial<CheckItem>);
    const { items, invalidated } = revalidateAgainstDraft([other], verses);
    expect(invalidated).toBe(0);
    expect(items[0].invalidated).toBe(false);
  });
});

// Deterministic fake sha per (repo, version) — D58: identity is the sha, so
// the fixtures derive one from the same (repo, version) distinctions the
// tests were written with.
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};

describe('D17 resolution revalidation — a warned update, never silent', () => {
  const resolution = (repoPath: string, version: string): Resolution => ({
    tool: 'translationNotes',
    book: 'TIT',
    rung: 'primary',
    pin: { repoPath, version, sha: sha40(`${repoPath}@${version}`), flavor: '' },
    usedFallback: false,
  });
  const now = resolution('git.door43.org/unfoldingWord/en_tn', 'v89');

  it('agreement produces no warning', () => {
    expect(
      resolutionWarning({ repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89', sha: sha40('git.door43.org/unfoldingWord/en_tn@v89') }, now),
    ).toBeNull();
  });

  it('a version bump warns, and reads as an upgrade rather than a switch', () => {
    const w = resolutionWarning(
      { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: sha40('git.door43.org/unfoldingWord/en_tn@v86') },
      now,
    );
    expect(w).not.toBeNull();
    expect(isLanguageSwitch(w!)).toBe(false);
    expect(w!.current).toEqual({
      repoPath: 'git.door43.org/unfoldingWord/en_tn',
      version: 'v89',
      sha: sha40('git.door43.org/unfoldingWord/en_tn@v89'),
    });
  });

  it('a different resource warns AND reads as a switch', () => {
    const w = resolutionWarning(
      { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v66', languageSet: 'primary' },
      now,
    );
    expect(w).not.toBeNull();
    expect(isLanguageSwitch(w!)).toBe(true);
  });

  it('D59: a sha-less stored record matching a rung by TAG still warns — the label is not identity', () => {
    // A tC3-era record carries owner+repo+label only. The tag is unenforced
    // (D58), so agreeing with a rung pin's label proves nothing: the record
    // reads as drift until the import-boundary tag→sha lookup resolves it.
    const rung = {
      repoPath: 'git.door43.org/unfoldingWord/en_tn',
      version: 'v89',
      sha: sha40('git.door43.org/unfoldingWord/en_tn@v89'),
    };
    const w = resolutionWarning(
      { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89' }, // no sha
      now,
      [rung],
    );
    expect(w).not.toBeNull();
  });

  it('a file with no recorded resource is not a change — there is nothing to compare', () => {
    expect(resolutionWarning(null, now)).toBeNull();
    expect(resolutionWarning({}, now)).toBeNull();
  });

  it('an unresolved tool produces no warning', () => {
    const unresolved = { ...now, pin: null, rung: null } as Resolution;
    expect(
      resolutionWarning({ repoPath: 'git.door43.org/x/y', version: 'v1' }, unresolved),
    ).toBeNull();
  });
});
