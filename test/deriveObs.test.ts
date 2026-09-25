// #291 (BURRITO-SPEC §10.5, D74): the OBS check items derive from the REAL
// exports of en_obs-tn v13 and en_obs-twl v3 (test/fixtures/resources, the
// sb-zip exports at the bundled pins), keyed `story:frame`, title notes on frame
// 0 included. The counts were taken at vendor time (2026-09-17) from the files
// themselves; this suite must reproduce them through src/data/derive.ts.
import { describe, expect, it } from 'vitest';
import { deriveObsItems, isStoryReference } from '../src/data/derive';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const FIX = path.resolve(process.cwd(), 'test/fixtures/resources');
const read = (p: string): string => fs.readFileSync(path.join(FIX, p), 'utf8');
const obsTn = read('en_obs-tn@v13/OBS.tsv');
const obsTq = read('en_obs-tq@v10/OBS.tsv');

/** The data rows of a TSV, split on tabs — the ground truth the derive must match. */
const rowsOf = (tsv: string): string[][] =>
  tsv.split('\n').filter((line) => line.trim() !== '').slice(1).map((line) => line.split('\t'));

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
});

describe('deriveObsItems — refusals and the locator accessor', () => {
  it('drops a row whose locator is not two integers (R-10.4.1), keeps the rest', () => {
    const header = 'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink';
    const tsv = `${header}\n1:1\taaaa\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god\nfront:intro\tbbbb\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god\n`;
    const items = deriveObsItems(tsv, 'translationWords');
    expect(items.map((i) => i.contextId.checkId)).toEqual(['aaaa']);
  });
});

describe('deriveObsItems — OBS Translation Questions (en_obs-tq v10, #331, R-10.6.3)', () => {
  const rows = rowsOf(obsTq);
  const items = deriveObsItems(obsTq, 'translationQuestions');

  it('derives EVERY question row, story-keyed like the notes, with the question and its response', () => {
    expect(rows).toHaveLength(672);
    expect(items).toHaveLength(rows.length);
    for (const item of items) {
      const r = item.contextId.reference;
      expect(isStoryReference(r)).toBe(true);
      expect(Number.isInteger(r.story) && Number.isInteger(r.frame)).toBe(true);
      expect(item.contextId.tool).toBe('translationQuestions');
      expect((item as { question?: string }).question).toBeTruthy();
      expect((item as { response?: string }).response).toBeTruthy();
    }
    expect(new Set(items.map((i) => i.contextId.reference.story)).size).toBe(50);
  });

  it('scopes to one story: story 1 carries the 22 rows the TSV has for it, and the first is the creation question', () => {
    const one = deriveObsItems(obsTq, 'translationQuestions', 1);
    expect(one).toHaveLength(22);
    expect(one[0]).toMatchObject({ contextId: { checkId: 'es4e', reference: { story: 1, frame: 1 } }, question: 'Where did everything in the universe come from?', response: 'God created everything.' });
    expect(deriveObsItems(obsTq, 'translationQuestions', 51)).toEqual([]);
  });
});
