// Changing a project's gateway language (D23a / D30.2) — the consequences are
// counted BEFORE the change so the user can decline.
//
// The companion fact these tests encode: partial coverage needs no change at
// all. A project pinned Spanish-primary + English-fallback already uses Spanish
// for the books Spanish covers and English for the rest, per (tool, book).
import { describe, expect, it } from 'vitest';
import {
  consequencesOfGatewayChange,
  describeConsequences,
  applyGatewayChange,
} from '../src/data/gatewayChange';
import type { StoredDecisionFile } from '../src/data/gatewayChange';
import { resolveToolBook } from '../src/data/resolve';
import type { Coverage } from '../src/data/resolve';
import type { DecisionFile, LanguageSet, ResourcesFile } from '../src/data/burritoStore';

// Deterministic fake sha per (repo, version): same inputs → same sha, any
// difference → a different sha, so the D58 sha-identity comparisons preserve
// exactly the (repo, version) distinctions these tests were written with.
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};

const pin = (repo: string, version: string) => ({
  repoPath: `git.door43.org/${repo}`,
  version,
  sha: sha40(`${repo}@${version}`),
  flavor: '',
});

const set = (lang: string, org: string, v: string): LanguageSet => ({
  gatewayLanguage: { languageId: lang, owner: org },
  translationNotes: pin(`${org}/${lang}_tn`, v),
  translationWordsLinks: pin(`${org}/${lang}_tw`, v),
  translationWords: pin(`${org}/${lang}_tw`, v),
  translationAcademy: pin(`${org}/${lang}_ta`, v),
});

const ES = set('es-419', 'Es-419_gl', 'v66');
const EN = set('en', 'unfoldingWord', 'v89');
const FR = set('fr', 'Xenizo', 'v2.0');

const file = (repoPath: string, version: string, decisions: number): DecisionFile =>
  ({
    schemaVersion: 1,
    tool: 'translationNotes',
    book: 'TIT',
    // The resource record's sha derives from the same (repo, version) string
    // the pins use, so "checked against pin X" still matches pin X under D58.
    resource: { repoPath, version, sha: sha40(`${repoPath.replace('git.door43.org/', '')}@${version}`) },
    decisions: Array.from({ length: decisions }, () => ({}) as never),
  }) as DecisionFile;

const stored = (
  book: string,
  repoPath: string,
  version: string,
  decisions: number,
): StoredDecisionFile => ({
  tool: 'translationNotes',
  book,
  file: { ...file(repoPath, version, decisions), book },
});

describe('the case that needs NO change — partial coverage is handled per book', () => {
  // Spanish covers 4 books; English covers the canon.
  const COVERAGE: Coverage = {
    'git.door43.org/Es-419_gl/es-419_tn': ['TIT', 'JON', 'RUT', '3JN'],
    'git.door43.org/unfoldingWord/en_tn': ['TIT', 'JON', 'HEB', 'PSA'],
  };
  const resources = {
    schemaVersion: 2,
    languageSets: { primary: ES, fallback: EN },
    resources: {},
  } as ResourcesFile;

  it('Titus uses Spanish and Hebrews uses English AT THE SAME TIME, with no user action', () => {
    expect(resolveToolBook(resources, 'translationNotes', 'TIT', COVERAGE).pin?.repoPath)
      .toContain('es-419_tn');
    expect(resolveToolBook(resources, 'translationNotes', 'HEB', COVERAGE).pin?.repoPath)
      .toContain('en_tn');
  });

  it('so a user is never forced to switch languages because one book is uncovered', () => {
    // Hebrews resolving to English does not disturb Titus in any way.
    const titus = resolveToolBook(resources, 'translationNotes', 'TIT', COVERAGE);
    expect(titus.rung).toBe('primary');
    expect(titus.usedFallback).toBe(false);
  });
});

describe('consequences are counted before the change is committed', () => {
  // Affectedness is judged against the POST-CHANGE resolution (D30 ladder),
  // so the counting takes the same coverage map the resolver uses. The French
  // suite covers TIT + JON; English covers the canon.
  const COV: Coverage = {
    'git.door43.org/Xenizo/fr_tn': ['TIT', 'JON'],
    'git.door43.org/Xenizo/fr_tw': ['TIT', 'JON'],
    'git.door43.org/unfoldingWord/en_tn': ['TIT', 'JON', 'HEB', 'PSA', 'RUT'],
    'git.door43.org/unfoldingWord/en_tw': ['BIBLE'],
  };

  it('a change that disturbs nothing is harmless and says so', () => {
    // The stored file was checked against exactly what the book still
    // resolves to under the new pins.
    const c = consequencesOfGatewayChange(
      [stored('TIT', 'git.door43.org/unfoldingWord/en_tn', 'v89', 12)],
      { primary: EN, fallback: EN },
      COV,
    );
    expect(c.harmless).toBe(true);
    expect(c.decisionsAtRisk).toBe(0);
    expect(describeConsequences(c, (b) => b).headline).toMatch(/Nothing/);
  });

  it('counts the decisions that would need review, per book', () => {
    const c = consequencesOfGatewayChange(
      [
        stored('TIT', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 30),
        stored('JON', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 17),
      ],
      { primary: FR, fallback: EN }, // Spanish is gone from both rungs
      COV,
    );
    expect(c.harmless).toBe(false);
    expect(c.affected.map((a) => a.book).sort()).toEqual(['JON', 'TIT']);
    expect(c.decisionsAtRisk).toBe(47);
  });

  it('a book the new primary does NOT cover keeps its fallback resolution — untouched', () => {
    // No false alarm: FR does not cover HEB, so HEB still resolves to the
    // unchanged English fallback it was checked against.
    const c = consequencesOfGatewayChange(
      [stored('HEB', 'git.door43.org/unfoldingWord/en_tn', 'v89', 25)],
      { primary: FR, fallback: EN },
      COV,
    );
    expect(c.harmless).toBe(true);
    expect(c.unaffectedBooks).toBe(1);
  });

  it('a book the new primary COVERS is affected even though its old resource stays pinned as fallback', () => {
    // The hole the D58 exact-identity comparison exposed (found by journey
    // J13, 2026-08-22): TIT was checked against the English notes, English
    // stays pinned as the fallback — but French COVERS TIT, so the ladder
    // moves TIT's resolution to French and the checked-against resource is
    // being left. Membership in the pin set is not the question; the
    // post-change resolution is.
    const c = consequencesOfGatewayChange(
      [stored('TIT', 'git.door43.org/unfoldingWord/en_tn', 'v89', 12)],
      { primary: FR, fallback: EN },
      COV,
    );
    expect(c.harmless).toBe(false);
    expect(c.affected.map((a) => a.book)).toEqual(['TIT']);
    expect(c.decisionsAtRisk).toBe(12);
  });

  it('a book with no decisions yet costs nothing', () => {
    const c = consequencesOfGatewayChange(
      [stored('TIT', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 0)],
      { primary: FR, fallback: EN },
      COV,
    );
    expect(c.harmless).toBe(true);
  });

  it('a file with no recorded resource is not claimed to be affected', () => {
    const c = consequencesOfGatewayChange(
      [{ tool: 'translationNotes', book: 'TIT', file: { ...file('', '', 5), resource: undefined } }],
      { primary: FR, fallback: EN },
      COV,
    );
    expect(c.harmless).toBe(true);
    expect(c.unaffectedBooks).toBe(1);
  });
});

describe('the wording the user actually reads', () => {
  const names: Record<string, string> = { TIT: 'Titus', JON: 'Jonah', RUT: 'Ruth', PSA: 'Psalms' };
  const bookName = (c: string) => names[c] ?? c;
  const COVW: Coverage = {
    'git.door43.org/Xenizo/fr_tn': ['TIT', 'JON', 'RUT', 'PSA'],
    'git.door43.org/unfoldingWord/en_tn': ['TIT', 'JON', 'RUT', 'PSA', 'HEB'],
  };

  it('names the books and the count in plain language, and promises nothing is deleted', () => {
    const c = consequencesOfGatewayChange(
      [
        stored('TIT', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 30),
        stored('JON', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 17),
      ],
      { primary: FR, fallback: EN },
      COVW,
    );
    const { headline, detail } = describeConsequences(c, bookName);
    expect(headline).toBe(
      '47 decisions in Titus and Jonah were made against the notes you are leaving.',
    );
    expect(detail).toContain('come back as work');
    expect(detail).toContain('Nothing is deleted');
  });

  it('summarises rather than listing every book when there are many', () => {
    const many = ['TIT', 'JON', 'RUT', 'PSA'].map((b) =>
      stored(b, 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 2),
    );
    const c = consequencesOfGatewayChange(many, { primary: FR, fallback: EN }, COVW);
    expect(describeConsequences(c, bookName).headline).toContain('and 1 more');
  });

  it('uses the singular for one decision', () => {
    const c = consequencesOfGatewayChange(
      [stored('TIT', 'git.door43.org/Es-419_gl/es-419_tn', 'v66', 1)],
      { primary: FR, fallback: EN },
      COVW,
    );
    expect(describeConsequences(c, bookName).headline).toBe(
      '1 decision in Titus were made against the notes you are leaving.',
    );
  });
});

describe('applying the change', () => {
  it('moves ONLY the primary rung — the English fallback never changes here', () => {
    const before = {
      schemaVersion: 2,
      languageSets: { primary: ES, fallback: EN },
      resources: { originalLanguage: {} },
    } as ResourcesFile;
    const after = applyGatewayChange(before, FR);
    expect(after.languageSets.primary.gatewayLanguage.languageId).toBe('fr');
    expect(after.languageSets.fallback).toEqual(EN);
    expect(after.resources).toEqual(before.resources); // untouched
  });
});
