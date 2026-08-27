// #110 (epic #104, D64 / BURRITO-SPEC §5.3 1.10): OPTIONAL per-set help slots
// `translationQuestions` and `simplifiedText`. The slots resolve per (slot,
// book) over the same primary→fallback ladder as the checking tools; an
// ABSENT slot covers no book and never breaks the set's completeness.
import { describe, expect, it } from 'vitest';
import { resolveSetSlot } from '../src/data/resolve';
import { languageSetFromInstalled, pinsPreferringInstalled } from '../src/data/installed';
import { GATEWAYS } from '../src/data/gateways';
import type { ResourcesFile, LanguageSet, ResourcePin } from '../src/data/burritoStore';

const pin = (repo: string, extra: Partial<ResourcePin> = {}): ResourcePin => ({
  repoPath: `git.door43.org/o/${repo}`,
  sha: 'a'.repeat(40),
  flavor: 'parascriptural/x-bcvquestions',
  ...extra,
});

const set = (over: Partial<LanguageSet> = {}): LanguageSet => ({
  gatewayLanguage: { languageId: 'es-419', owner: 'o' },
  translationNotes: pin('es_tn'),
  translationWordsLinks: pin('es_tw'),
  translationWords: pin('es_tw'),
  translationAcademy: pin('es_ta'),
  ...over,
});

const resources = (primary: LanguageSet, fallback: LanguageSet): ResourcesFile => ({
  schemaVersion: 2,
  languageSets: { primary, fallback },
  resources: {},
});

describe('D64 — optional tq + simplifiedText slots resolve over the two-rung ladder', () => {
  const enTq = pin('en_tq', { books: ['BIBLE'] });
  const esTq = pin('es_tq', { books: ['TIT'] });
  const fallbackSet = set({
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    translationQuestions: enTq,
    simplifiedText: pin('en_ust', { flavor: 'scripture/textTranslation', books: ['BIBLE'] }),
  });

  it('a primary pin that covers the book wins the rung', () => {
    const r = resolveSetSlot(resources(set({ translationQuestions: esTq }), fallbackSet), 'translationQuestions', 'TIT', {});
    expect(r.rung).toBe('primary');
    expect(r.pin?.repoPath).toContain('es_tq');
    expect(r.usedFallback).toBe(false);
  });

  it('an uncovered book falls through to the English fallback', () => {
    const r = resolveSetSlot(resources(set({ translationQuestions: esTq }), fallbackSet), 'translationQuestions', 'MRK', {});
    expect(r.rung).toBe('fallback');
    expect(r.usedFallback).toBe(true);
  });

  it('an ABSENT optional slot covers no book — the rung is skipped, never an error', () => {
    const r = resolveSetSlot(resources(set(), fallbackSet), 'translationQuestions', 'TIT', {});
    expect(r.rung).toBe('fallback'); // primary omits tq entirely
    const none = resolveSetSlot(resources(set(), set()), 'translationQuestions', 'TIT', {});
    expect(none.rung).toBeNull();
    expect(none.pin).toBeNull();
  });

  it('simplifiedText resolves the same way', () => {
    const r = resolveSetSlot(resources(set(), fallbackSet), 'simplifiedText', 'JON', {});
    expect(r.rung).toBe('fallback');
    expect(r.pin?.flavor).toBe('scripture/textTranslation');
  });
});

describe('D64 — languageSetFromInstalled includes the optional slots only when installed', () => {
  const rec = (repo: string) => ({
    repoPath: `git.door43.org/es-419_gl/${repo}`,
    sha: 'b'.repeat(40),
    flavor: 'x',
  });
  const required = {
    a: rec('es-419_tn'),
    b: rec('es-419_tw'),
    c: rec('es-419_ta'),
  };
  const gw = { id: 'es-419', org: 'es-419_gl' };

  it('a suite without tq/simplified is still a complete set (no new requirement)', () => {
    const s = languageSetFromInstalled(required as never, gw);
    expect(s).not.toBeNull();
    expect(s?.translationQuestions).toBeUndefined();
    expect(s?.simplifiedText).toBeUndefined();
  });

  it('installed _tq and _gst repos land in the optional slots', () => {
    const s = languageSetFromInstalled({ ...required, d: rec('es-419_tq'), e: rec('es-419_gst') } as never, gw);
    expect(s?.translationQuestions?.repoPath).toContain('es-419_tq');
    expect(s?.simplifiedText?.repoPath).toContain('es-419_gst');
  });

  it("a multi-language org never pins ANOTHER language's tq/gst (2026-08-27 review)", () => {
    const bcs = (repo: string) => ({ repoPath: `git.door43.org/translationCore-Create-BCS/${repo}`, sha: 'e'.repeat(40), flavor: 'x' });
    const installed = {
      a: bcs('bn_tn'), b: bcs('bn_tw'), c: bcs('bn_ta'),
      d: bcs('hi_tq'), e: bcs('hi_gst'), // the OTHER language's repos, same org
      f: bcs('bn_tq'),
    };
    const s = languageSetFromInstalled(installed as never, { id: 'bn', org: 'translationCore-Create-BCS' });
    expect(s?.translationQuestions?.repoPath).toContain('bn_tq');
    expect(s?.simplifiedText).toBeUndefined(); // hi_gst must NOT fill Bengali's slot
  });

  it('English `_ust` also satisfies the simplified slot', () => {
    const en = (repo: string) => ({ repoPath: `git.door43.org/unfoldingWord/${repo}`, sha: 'c'.repeat(40), flavor: 'x' });
    const s = languageSetFromInstalled(
      { a: en('en_tn'), b: en('en_tw'), c: en('en_ta'), d: en('en_ust') } as never,
      { id: 'en', org: 'unfoldingWord' },
    );
    expect(s?.simplifiedText?.repoPath).toContain('en_ust');
  });
});

describe('D64 — pinsPreferringInstalled covers the optional slots', () => {
  it('a newer installed tq replaces the pinned identity like the required slots do', () => {
    const stored = resources(
      set({ translationQuestions: pin('es_tq', { version: 'v1' }) }),
      set(),
    );
    const installed = {
      k: { repoPath: 'git.door43.org/o/es_tq', sha: 'd'.repeat(40), version: 'v2', flavor: 'parascriptural/x-bcvquestions' },
    };
    const out = pinsPreferringInstalled(
      stored as unknown as { languageSets: Record<string, Record<string, unknown>> },
      installed as never,
    );
    const tq = (out.languageSets as unknown as Record<string, LanguageSet>).primary.translationQuestions;
    expect(tq?.version).toBe('v2');
    expect(tq?.sha).toBe('d'.repeat(40));
  });
});

describe('D64 — gateway config records per-language availability', () => {
  it('every gateway row carries hasTq and hasSimplified booleans', () => {
    for (const g of GATEWAYS) {
      expect(typeof g.hasTq).toBe('boolean');
      expect(typeof g.hasSimplified).toBe('boolean');
    }
  });
  it('the shipped English gateway has both (evidence 2026-08-27)', () => {
    const en = GATEWAYS.find((g) => g.id === 'en');
    expect(en?.hasTq).toBe(true);
    expect(en?.hasSimplified).toBe(true);
  });
});
