// #787 — a verse opens with a word bank rebuilt from its current text.
//
// buildAlignmentSession used to show a stored §5.1 record as it was, whenever it
// had alignments. After a text change that no reflow handled (a record with
// nothing placed, an `invalid` record, a sync), the bank missed the new words and
// kept the removed ones, and the next edit stamped that record as current. The
// session record is now the stored record reconciled to the text, in memory only.
//
// The ways this can fail, written before the code:
// 1. the bank of a changed verse holds a removed word, or lacks a new one, with or
//    without a matching hash (B1-B3);
// 2. opening a verse writes or stages something (B4);
// 3. an edit on the opened verse saves a record the export cannot weave (B5);
// 4. a record that matches its text opens changed or with its banner on (B6);
// 5. a verse that was never saved opens with its bank out of verse order (B7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookModel } from '../src/data/bookModel.js';
import {
  bootstrapVerse, cardsInVerseOrder, finalizeEdit, linkWord, markDone, reconcileToWords, reflowAlignment, settleDone,
  stampTargetVerse, unlinkWord,
} from '../src/data/align/edit';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { wordTokens } from '../src/data/align/tokenize';
import { weaveBook } from '../src/data/export/weave.mjs';
import { md5Hex } from '../src/data/httpStore';
import { SaveScheduler } from '../src/data/saveScheduler';
import { AlignmentHelpers, usfmjs } from '../src/data/vendor';
import { decompose } from '../journal/skeleton.mjs';
import { __alignSaveForTests, __buildAlignmentSessionForTests as buildAlignmentSession } from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const RAW: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const FILE: AlignmentFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const SOURCE = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';

/** The draft's verses by chapter, as the editor reads them (bookModel). */
const versesOf = (raw: string) =>
  bookModel(raw).byChapter as Record<string, Array<{ n: string; drafted: boolean; text: string }>>;
const T1 = versesOf(RAW)['1'].find((v) => v.n === '1')!.text;
const T2 = T1.replace('siervo', 'esclavo');
const RAW2 = RAW.replace(T1, T2);

/** The aligner's original-language objects, from the Greek words a record holds. */
const origOf = (record: AlignmentVerseRecord) =>
  record.alignments.flatMap((a) => a.topWords).map((t) => ({
    tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph,
    occurrence: t.occurrence, occurrences: t.occurrences,
  }));
const ORIG = origOf(FILE.chapters['1']['1']);

const fileOf = (record: AlignmentVerseRecord): AlignmentFile => ({
  schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': record } },
});
const makeStore = (file: AlignmentFile | null) => ({
  writeAlignments: vi.fn(),
  readAlignmentsWithMd5: async () => ({ value: file, md5: 'm1' }),
});
const open = (file: AlignmentFile | null, raw: string, ref = '1:1', sched: SaveScheduler | null = null, orig: unknown[] = ORIG) =>
  buildAlignmentSession(makeStore(file), sched, { book: 'TIT', bookRaw: raw, project: { scriptDirection: 'ltr' } }, ref, SOURCE, orig);

/** applyAlignEdit's record pipeline (state.jsx), after the mutation. */
const afterEdit = (next: AlignmentVerseRecord, text: string) => finalizeEdit(next, verseWords(text), md5Hex(text));

const key = (w: { word?: string; text?: string; occurrence: unknown }) => `${w.word ?? w.text}/${Number(w.occurrence)}`;
const bankKeys = (r: AlignmentVerseRecord) => r.wordBank.map(key);
const bankWords = (r: AlignmentVerseRecord) => r.wordBank.map((w) => w.word);
const everyWord = (r: AlignmentVerseRecord): AlignedWord[] => [...r.wordBank, ...r.alignments.flatMap((a) => a.bottomWords)];
const multiset = (words: Array<{ word?: string; text?: string; occurrence: unknown; occurrences: unknown }>) =>
  words.map((w) => `${w.word ?? w.text}|${Number(w.occurrence)}|${Number(w.occurrences)}`).sort();

/** The issue's steps 1: open a never-saved 1:1, place "Pablo", then unplace it. The
 * file now holds one card per Greek word, none holding a word. */
const unplacedPablo = (): AlignmentVerseRecord => {
  let r = bootstrapVerse(verseWords(T1), ORIG, SV, md5Hex(T1));
  r = linkWord(r, 0, r.wordBank.find((w) => w.word === 'Pablo')!);
  r = unlinkWord(r, 0, r.alignments[0].bottomWords[0], verseWords(T1));
  return afterEdit(r, T1);
};

describe('#787 a stored record is reconciled to the text when the verse opens', () => {
  it('B1 the issue steps: place and unplace Pablo, change siervo to esclavo, reopen', async () => {
    const stored = unplacedPablo();
    expect(stored.alignments.length).toBeGreaterThan(0);
    expect(stored.alignments.some((a) => a.bottomWords.length)).toBe(false);
    const s = await open(fileOf(stored), RAW2);
    expect(bankWords(s.record)).toContain('esclavo');
    expect(bankWords(s.record)).not.toContain('siervo');
    expect(bankKeys(s.record)).toEqual(wordTokens(T2).map(key));
    expect(s.stale).toBe(true);
  });

  it('B2 Mark valid with nothing placed, then a text edit, then reopen', async () => {
    const done = markDone(bootstrapVerse(verseWords(T1), ORIG, SV, md5Hex(T1)), md5Hex(T1));
    expect(done.done).toBe(true);
    const s = await open(fileOf(done), RAW2);
    expect(bankWords(s.record)).toContain('esclavo');
    expect(bankWords(s.record)).not.toContain('siervo');
    expect(s.stale).toBe(true);
  });

  it('B3 a record whose hash is current but whose words are not opens with the banner and the right words', async () => {
    const damaged = { ...unplacedPablo(), targetVerseMd5: md5Hex(T2) };
    expect(damaged.targetVerseMd5).toBe(md5Hex(T2)); // the hash check alone passes
    expect(bankWords(damaged)).toContain('siervo');
    expect(bankWords(damaged)).not.toContain('esclavo');
    const s = await open(fileOf(damaged), RAW2);
    expect(bankWords(s.record)).not.toContain('siervo');
    expect(bankWords(s.record)).toContain('esclavo');
    expect(s.stale).toBe(true);
  });

  it('keeps the links whose word is still in the text, and drops the ones that are not', async () => {
    let r = bootstrapVerse(verseWords(T1), ORIG, SV, md5Hex(T1));
    r = linkWord(r, 0, r.wordBank.find((w) => w.word === 'Pablo')!);
    r = linkWord(r, 1, r.wordBank.find((w) => w.word === 'siervo')!);
    const s = await open(fileOf(afterEdit(r, T1)), RAW2);
    expect(s.record.alignments.map((a: { bottomWords: AlignedWord[] }) => a.bottomWords.map(key))[0]).toEqual(['Pablo/1']);
    expect(s.record.alignments[1].bottomWords).toEqual([]);
    expect(multiset(everyWord(s.record))).toEqual(multiset(wordTokens(T2)));
  });
});

describe('#787 B4 opening a verse writes nothing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('no store write and no staged record, with or without a scheduler', async () => {
    const stale = fileOf(unplacedPablo());
    const withoutScheduler = makeStore(stale);
    const a = await buildAlignmentSession(withoutScheduler, null, { book: 'TIT', bookRaw: RAW2, project: {} }, '1:1', SOURCE, ORIG);
    expect(a.stale).toBe(true);
    expect(withoutScheduler.writeAlignments).not.toHaveBeenCalled();

    const store = makeStore(stale);
    const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    const markDirty = vi.spyOn(sched, 'markDirty');
    const b = await buildAlignmentSession(store, sched, { book: 'TIT', bookRaw: RAW2, project: {} }, '1:1', SOURCE, ORIG);
    expect(b.stale).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(0);
    expect(markDirty).not.toHaveBeenCalled();
    expect(store.writeAlignments).not.toHaveBeenCalled();
    expect(sched.getState()).toBe('saved');
  });
});

describe('#787 B5 one edit on a reconciled verse saves exactly the verse words, and the export weaves it', () => {
  const weaveVerse = (raw: string, record: AlignmentVerseRecord) =>
    (decompose(weaveBook(raw, fileOf(record), AlignmentHelpers)).verses as Record<string, string>)['1:1'];

  it('the edit keeps bank + placed equal to the text; the weave writes \\zaln-s', async () => {
    const s = await open(fileOf(unplacedPablo()), RAW2);
    const after = afterEdit(linkWord(s.record, 0, s.record.wordBank.find((w: AlignedWord) => w.word === 'Pablo')), s.targetText);
    expect(multiset(everyWord(after))).toEqual(multiset(wordTokens(T2)));
    expect(after.targetVerseMd5).toBe(md5Hex(T2));
    const woven = weaveVerse(RAW2, after);
    expect(woven).toContain('\\zaln-s');
    expect(woven).toContain('esclavo');
  });

  it('control: the same edit on the stored record, with no reconcile (the pipeline before #796), saves siervo and the weave drops the alignment', () => {
    const stored = unplacedPablo();
    const next = linkWord(stored, 0, stored.wordBank.find((w) => w.word === 'Pablo')!);
    const after = settleDone(stampTargetVerse(cardsInVerseOrder(next, verseWords(T2)), md5Hex(T2)));
    expect(multiset(everyWord(after))).not.toEqual(multiset(wordTokens(T2)));
    expect(weaveVerse(RAW2, after)).not.toContain('\\zaln-s');
  });

  it('finalizeEdit repairs that same stored record: the verse words are saved and the weave writes \\zaln-s (#796)', () => {
    const stored = unplacedPablo();
    const after = afterEdit(linkWord(stored, 0, stored.wordBank.find((w) => w.word === 'Pablo')!), T2);
    expect(multiset(everyWord(after))).toEqual(multiset(wordTokens(T2)));
    expect(weaveVerse(RAW2, after)).toContain('\\zaln-s');
  });
});

describe('#787 B6 a record that matches its text opens as it is', () => {
  it('every verse of the conformance sample: the same links, the same words, no banner', async () => {
    const refs = Object.entries(FILE.chapters).flatMap(([c, verses]) => Object.keys(verses).map((v) => [c, v] as const));
    expect(refs.length).toBeGreaterThan(0);
    for (const [c, v] of refs) {
      const stored = FILE.chapters[c][v];
      const s = await open(FILE, RAW, `${c}:${v}`, null, origOf(stored));
      const pairs = (r: AlignmentVerseRecord) =>
        r.alignments.map((a) => [a.topWords.map((t) => t.word), a.bottomWords.map(key)]);
      expect(pairs(s.record), `${c}:${v}`).toEqual(pairs(stored));
      expect(multiset(everyWord(s.record)), `${c}:${v}`).toEqual(multiset(everyWord(stored)));
      expect(s.stale, `${c}:${v}`).toBe(false);
    }
  });
});

describe('#787 B7 a verse that was never saved opens with its bank in verse order', () => {
  const NONE = null;
  const bankOrder = (r: AlignmentVerseRecord) => r.wordBank.map((w) => `${w.word}/${Number(w.occurrence)}/${Number(w.occurrences)}`);
  const drafted = (raw: string) =>
    Object.entries(versesOf(raw)).flatMap(([c, verses]) =>
      verses.filter((v) => v.drafted && v.text).map((v) => [c, v.n, v.text] as const));

  it('every drafted verse of the sample Titus has its words in text order', async () => {
    const list = drafted(RAW);
    expect(list.length).toBeGreaterThan(1);
    for (const [c, v, text] of list) {
      const s = await open(NONE, RAW, `${c}:${v}`);
      expect(bankOrder(s.record), `${c}:${v}`).toEqual(wordTokens(text).map((t) => `${t.text}/${t.occurrence}/${t.occurrences}`));
    }
  });

  it('the sample Jonah span, against the real Hebrew', async () => {
    const jon: string = fs.readFileSync(path.join(SAMPLE, 'JON.usfm'), 'utf8');
    const uhb = usfmjs.toJSON(fs.readFileSync(path.resolve(__dirname, 'fixtures/hbo_uhb/JON.usfm'), 'utf8')) as unknown as {
      chapters: Record<string, Record<string, { verseObjects: Array<Record<string, unknown>> }>>;
    };
    const orig = [...uhb.chapters['2']['9'].verseObjects, ...uhb.chapters['2']['10'].verseObjects];
    const list = drafted(jon);
    expect(list.map(([c, v]) => `${c}:${v}`)).toEqual(['2:9-10']);
    const [c, v, text] = list[0];
    const s = await buildAlignmentSession(makeStore(NONE), null, { book: 'JON', bookRaw: jon, project: {} }, `${c}:${v}`, { ...SOURCE, testament: 'ot' }, orig);
    expect(bankOrder(s.record)).toEqual(wordTokens(text).map((t) => `${t.text}/${t.occurrence}/${t.occurrences}`));
  });
});

describe('#787 reconcileToWords', () => {
  const placedRecord = () => {
    let r = bootstrapVerse(verseWords(T1), ORIG, SV, md5Hex(T1));
    r = linkWord(r, 0, r.wordBank.find((w) => w.word === 'Pablo')!);
    return afterEdit(r, T1);
  };

  it('a record that matches the text is unchanged', () => {
    expect(reconcileToWords(FILE.chapters['1']['1'], verseWords(T1)).changed).toBe(false);
    expect(reconcileToWords(placedRecord(), verseWords(T1)).changed).toBe(false);
  });

  it('a new word, a removed word, a dropped link and a count change are each a change', () => {
    const r = placedRecord();
    expect(reconcileToWords(r, verseWords(T2)).changed).toBe(true);
    expect(reconcileToWords(r, verseWords(T1.replace('Pablo', 'Saulo'))).changed).toBe(true);
    // a second "Pablo": the first one is still placed, but its total is now 2
    expect(reconcileToWords(r, verseWords(`Pablo ${T1}`)).changed).toBe(true);
  });

  it('changes only the words: invalid, done, the hash, the source and every topWords stay', () => {
    const r: AlignmentVerseRecord = { ...placedRecord(), invalid: true, done: true, sourceVersion: 'x', targetVerseMd5: '0'.repeat(32) };
    const out = reconcileToWords(r, verseWords(T2)).record;
    expect(out).toMatchObject({ invalid: true, done: true, sourceVersion: 'x', targetVerseMd5: '0'.repeat(32) });
    expect(out.alignments.map((a) => a.topWords)).toEqual(r.alignments.map((a) => a.topWords));
    expect(multiset(everyWord(out))).toEqual(multiset(wordTokens(T2)));
  });

  // The reflow before #787 never read `wordBank`, so a record without one (placed
  // words only) reflowed fine; reconcileToWords must not throw on it, or one such
  // record skips the rest of a save's reflow.
  it('a record with a placed word and no wordBank key reflows as before and does not throw', () => {
    const partial: Partial<AlignmentVerseRecord> = { ...placedRecord() };
    delete partial.wordBank;
    const noBank = partial as AlignmentVerseRecord;
    expect('wordBank' in noBank).toBe(false);
    expect(() => reconcileToWords(noBank, verseWords(T2))).not.toThrow();
    const out = reflowAlignment(noBank, verseWords(T2), md5Hex(T2))!;
    expect(out).not.toBeNull();
    expect(out.invalid).toBe(false);
    expect(out.alignments[0].bottomWords.map(key)).toEqual(['Pablo/1']);
    expect(bankKeys(out)).toEqual(wordTokens(T2).map(key).filter((k) => k !== 'Pablo/1'));
  });
});
