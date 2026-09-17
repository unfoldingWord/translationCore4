// #291 (BURRITO-SPEC §10.5, D74): the OBS check items derive from the REAL
// exports of en_obs-tn v13 and en_obs-twl v3 (test/fixtures/resources, the
// sb-zip exports at the bundled pins), keyed `story:frame`, title notes on frame
// 0 included. The counts were taken at vendor time (2026-09-17) from the files
// themselves; this suite must reproduce them through src/data/derive.ts.
import { describe, expect, it } from 'vitest';
import {
  deriveObsItems,
  isStoryReference,
  locatorOf,
  mergeKey,
  mergeSavedDecisions,
  referenceParts,
  type CheckItem,
} from '../src/data/derive';
import { EN_HELPS } from '../src/data/installedSuite';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const FIX = path.resolve(process.cwd(), 'test/fixtures/resources');
const read = (p: string): string => fs.readFileSync(path.join(FIX, p), 'utf8');
const obsTn = read('en_obs-tn@v13/OBS.tsv');
const obsTwl = read('en_obs-twl@v3/OBS.tsv');

/** The data rows of a TSV, split on tabs — the ground truth the derive must match. */
const rowsOf = (tsv: string): string[][] =>
  tsv.split('\n').filter((line) => line.trim() !== '').slice(1).map((line) => line.split('\t'));

const revisionOf = (p: string): string => {
  const meta = JSON.parse(read(p)) as { identification: { primary: { dcs?: Record<string, { revision: string }> } } };
  return Object.values(meta.identification.primary.dcs ?? {})[0]?.revision ?? '';
};

describe('fixture provenance — the OBS exports are the bundled pins', () => {
  it('each vendored metadata.json carries the pinned tag commit SHA', () => {
    expect(revisionOf('en_obs-tn@v13/metadata.json')).toBe(EN_HELPS['obs-tn'].sha);
    expect(revisionOf('en_obs-twl@v3/metadata.json')).toBe(EN_HELPS['obs-twl'].sha);
  });
});

describe('deriveObsItems — OBS Translation Notes (en_obs-tn v13)', () => {
  const rows = rowsOf(obsTn);
  const items = deriveObsItems(obsTn, 'translationNotes');

  it('derives EVERY note row as a check, story-keyed, nothing dropped', () => {
    expect(rows).toHaveLength(2325);
    expect(items).toHaveLength(rows.length);
    for (const item of items) {
      const r = item.contextId.reference;
      expect(isStoryReference(r)).toBe(true);
      expect(r.bookId).toBeUndefined();
      expect(r.chapter).toBeUndefined();
      expect(r.verse).toBeUndefined();
      expect(Number.isInteger(r.story)).toBe(true);
      expect(Number.isInteger(r.frame)).toBe(true);
      expect(item.contextId.tool).toBe('translationNotes');
      expect(item.contextId.occurrence).toBe(1);
    }
    expect(new Set(items.map((i) => i.contextId.reference.story)).size).toBe(50);
  });

  it('keeps the title notes on frame 0 — none of them carries a SupportReference', () => {
    const titleRows = rows.filter((r) => r[0].endsWith(':0'));
    expect(titleRows).toHaveLength(58);
    expect(titleRows.every((r) => r[3] === '')).toBe(true);
    const titles = items.filter((i) => i.contextId.reference.frame === 0);
    expect(titles).toHaveLength(titleRows.length);
    const creation = titles.find((i) => i.contextId.reference.story === 1);
    expect(creation?.contextId.checkId).toBe('i6lj');
    expect(creation?.contextId.quoteString).toBe('The Creation');
    expect(creation?.contextId.groupId).toBe('');
  });

  it('scopes to one story when asked, exactly the rows of that story', () => {
    const story1 = deriveObsItems(obsTn, 'translationNotes', 1);
    expect(story1).toHaveLength(rows.filter((r) => r[0].startsWith('1:')).length);
    expect(story1.every((i) => i.contextId.reference.story === 1)).toBe(true);
    expect(deriveObsItems(obsTn, 'translationNotes', 51)).toEqual([]);
  });

  it('keeps the tA module of a linked note as groupId and the quote as a word array', () => {
    const linked = items.find((i) => i.contextId.checkId === 'zzmo');
    expect(linked?.contextId.groupId).toBe('figs-quotations');
    expect(linked?.contextId.reference).toEqual({ story: 1, frame: 2 });
    expect(Array.isArray(linked?.contextId.quote)).toBe(true);
  });
});

describe('deriveObsItems — OBS Translation Words Links (en_obs-twl v3)', () => {
  const rows = rowsOf(obsTwl);
  const items = deriveObsItems(obsTwl, 'translationWords');

  it('derives every link row, story-keyed; Occurrence is 1 in every row (R-10.5.1)', () => {
    expect(rows).toHaveLength(2381);
    expect(items).toHaveLength(rows.length);
    expect(new Set(rows.map((r) => r[4]))).toEqual(new Set(['1']));
    expect(items.every((i) => i.contextId.occurrence === 1)).toBe(true);
    expect(items.every((i) => isStoryReference(i.contextId.reference))).toBe(true);
    expect(items.some((i) => i.contextId.reference.frame === 0)).toBe(false);
  });

  it('resolves the TWLink to the shared Translation Words article slug and category', () => {
    const god = items.find((i) => i.contextId.checkId === 'aoaa');
    expect(god?.contextId.reference).toEqual({ story: 1, frame: 1 });
    expect(god?.contextId.groupId).toBe('god');
    expect(god?.category).toBe('kt');
    expect(god?.contextId.quoteString).toBe('God');
    expect(deriveObsItems(obsTwl, 'translationWords', 1)).toHaveLength(35);
  });
});

describe('deriveObsItems — refusals and the locator accessor', () => {
  it('negative control: a foreign header is refused, never guess-parsed', () => {
    expect(() => deriveObsItems('Reference\tID\tNote\n1:1\tx\ty\n', 'translationNotes')).toThrow(/Refusing to guess-parse/);
  });

  it('drops a row whose locator is not two integers (R-10.4.1), keeps the rest', () => {
    const header = 'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink';
    const tsv = `${header}\n1:1\taaaa\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god\nfront:intro\tbbbb\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god\n`;
    const items = deriveObsItems(tsv, 'translationWords');
    expect(items.map((i) => i.contextId.checkId)).toEqual(['aaaa']);
  });

  it('referenceParts and locatorOf read both reference forms', () => {
    expect(referenceParts({ story: 3, frame: 0 })).toEqual({ c: 3, v: 0 });
    expect(referenceParts({ bookId: 'tit', chapter: 1, verse: '9-10' })).toEqual({ c: 1, v: '9-10' });
    expect(locatorOf({ story: 12, frame: 4 })).toBe('12:4');
    expect(locatorOf({ bookId: 'tit', chapter: 2, verse: 1 })).toBe('2:1');
  });

  it('a saved story decision re-attaches to its derived twin by story and frame', () => {
    const derived = deriveObsItems(obsTwl, 'translationWords', 1);
    const twin = derived.find((i) => i.contextId.checkId === 'aoaa') as CheckItem;
    const saved: CheckItem = { ...twin, selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }], status: 'valid' };
    expect(mergeKey(saved.contextId)).toBe('aoaa|1|1|God|1');
    const merged = mergeSavedDecisions(derived, [saved]);
    expect(merged.find((i) => i.contextId.checkId === 'aoaa')?.selections).toEqual(saved.selections);
    expect(merged.filter((i) => i.selections !== false)).toHaveLength(1);
  });
});
