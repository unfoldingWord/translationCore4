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
  uncoveredByChange,
} from '../src/data/gatewayChange';
import type { StoredDecisionFile } from '../src/data/gatewayChange';
import { pinKey } from '../src/data/resolve';
import type { Coverage } from '../src/data/resolve';
import type { DecisionFile, LanguageSet, ResourcesFile } from '../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

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

describe('official review round 7: an affected book NEITHER rung covers BLOCKS the change', () => {
  it('uncoveredByChange names it; a covered affected book is not named', () => {
    // The change moves to French primary + French fallback (a degenerate but
    // legal shape). French covers TIT only — RUT has stored decisions from
    // the Spanish era and would resolve to NEITHER rung after the change.
    const next = {
      schemaVersion: 2,
      languageSets: { primary: FR, fallback: FR },
      resources: {},
    } as ResourcesFile;
    const COV: Coverage = { [pinKey(FR.translationNotes)]: ['TIT'] };
    const affected = [
      { tool: 'translationNotes', book: 'TIT' },
      { tool: 'translationNotes', book: 'RUT' },
    ] as never;
    expect(uncoveredByChange(affected, next, COV)).toEqual([
      { tool: 'translationNotes', book: 'RUT' },
    ]);
  });
});

describe('consequences are counted before the change is committed', () => {
  // Affectedness is judged against the POST-CHANGE resolution (D30 ladder),
  // so the counting takes the same coverage map the resolver uses. The French
  // suite covers TIT + JON; English covers the canon.
  const COV: Coverage = {
    [pinKey(FR.translationNotes)]: ['TIT', 'JON'],
    [pinKey(FR.translationWordsLinks)]: ['TIT', 'JON'],
    [pinKey(EN.translationNotes)]: ['TIT', 'JON', 'HEB', 'PSA', 'RUT'],
    [pinKey(EN.translationWordsLinks)]: ['BIBLE'],
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
    [pinKey(FR.translationNotes)]: ['TIT', 'JON', 'RUT', 'PSA'],
    [pinKey(EN.translationNotes)]: ['TIT', 'JON', 'RUT', 'PSA', 'HEB'],
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
  it('both application write paths backfill installed coverage before persistence', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/state.jsx'), 'utf8');
    const preview = source.slice(
      source.indexOf('previewGatewayChange: async'),
      source.indexOf('commitGatewayChange: async'),
    );
    const direct = source.slice(
      source.indexOf('setProjectGateway: async'),
      source.indexOf('runPreflight: async'),
    );

    expect(preview).toContain(
      'backfillCoverage(applyGatewayChange(current, proposedPrimary), coverage).resources',
    );
    expect(direct).toContain('backfillCoverage(');
    expect(direct).toContain('coverage,');
  });
});

describe('#288 OBS gateway changes', () => {
  const obsSet = (base: LanguageSet, token: string): LanguageSet => ({
    ...base,
    obs: pin(`${base.gatewayLanguage.owner}/${base.gatewayLanguage.languageId}_obs`, token),
    'obs-tn': pin(`${base.gatewayLanguage.owner}/${base.gatewayLanguage.languageId}_obs-tn`, token),
    'obs-twl': pin(`${base.gatewayLanguage.owner}/${base.gatewayLanguage.languageId}_obs-twl`, token),
  });
  const oldPrimary = obsSet(ES, 'old');
  const nextPrimary = obsSet(FR, 'next');
  const fallback = obsSet(EN, 'fallback');

  it('counts OBS decisions against the collection slot and keeps the fallback unchanged', () => {
    const prior = oldPrimary['obs-tn']!;
    const decisionFile = {
      ...file(prior.repoPath, prior.version!, 3),
      book: 'OBS',
      resource: { repoPath: prior.repoPath, sha: prior.sha, version: prior.version },
    } as DecisionFile;
    const consequences = consequencesOfGatewayChange(
      [{ tool: 'translationNotes', book: 'OBS', file: decisionFile }],
      { primary: nextPrimary, fallback },
      {},
      'obs',
    );
    expect(consequences).toMatchObject({ decisionsAtRisk: 3, harmless: false });

    const before = { schemaVersion: 2, languageSets: { primary: oldPrimary, fallback }, resources: {} } as ResourcesFile;
    const after = applyGatewayChange(before, nextPrimary);
    expect(after.languageSets.fallback).toBe(fallback);
    expect(before.languageSets.primary).toBe(oldPrimary); // cancel = do not apply; preview cannot mutate it
  });

  it('treats an absent primary OBS member as fallback, but blocks when neither set has it', () => {
    const affected = [{ tool: 'translationNotes', book: 'OBS' }] as const;
    const primaryWithoutNotes = { ...nextPrimary, 'obs-tn': undefined } as unknown as LanguageSet;
    const withFallback = { schemaVersion: 2, languageSets: { primary: primaryWithoutNotes, fallback }, resources: {} } as ResourcesFile;
    expect(uncoveredByChange(affected, withFallback, {}, 'obs')).toEqual([]);
    const fallbackWithoutNotes = { ...fallback, 'obs-tn': undefined } as unknown as LanguageSet;
    expect(uncoveredByChange(affected, {
      ...withFallback, languageSets: { primary: primaryWithoutNotes, fallback: fallbackWithoutNotes },
    }, {}, 'obs')).toEqual([{ tool: 'translationNotes', book: 'OBS' }]);
  });
});
