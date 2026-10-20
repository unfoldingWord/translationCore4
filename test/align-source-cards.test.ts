// #790 (D107) — Align repairs the source cards from the pinned original-language verse, as tC3 did.
//
// A stored §5.1 record holds the source words of the verse it was made against. The open used
// to show those cards as stored: the sample's 1:1 holds 10 cards for 11 source words, and the
// pinned UGNT v0.34 verse has 17. The open and every Align write now fit the cards to the pinned
// verse (src/data/align/source.mjs): a card whose source word the pin does not hold drops with its
// links, a pinned word on no card gets an empty card, and cards and `topWords` follow the pinned
// verse. The aligned export fits each record before it weaves (test/export/usfm.test.ts).
//
// The ways this can fail, written before the code:
// 1. the open shows 10 cards for the sample, or a card with a source word the pin does not hold (S1, S2);
// 2. a fit that drops a link does not flag the verse, so the translator never reviews it (S2, S3, S6);
// 3. a card for a source word that appears twice (a second card of the same word, or one card that
//    holds two copies of a key that NFC made equal) drops a good link, or keeps two cards on one word
//    (S3, S5, S7);
// 4. a card with a dropped word keeps the claims of its other words, so a pinned word has no card (S6);
// 5. the identity is wider or narrower than tC3's: strong, lemma and morph decide, or NFC does not (S4);
// 6. the open writes (B2), or an edit and Mark valid do not save the fitted record or the stamp (B2, B3);
// 7. a split or a merge puts source words out of the pinned order (B4);
// 8. a `done` record gains empty cards with no review, or an unchanged record is flagged (S1, S8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, mergeAlignments, splitAlignment } from '../src/data/align/edit';
import { fitSourceCards } from '../src/data/align/source.mjs';
import { needsReview } from '../src/data/align/review.mjs';
import { weaveBook } from '../src/data/export/weave.mjs';
import { SaveScheduler } from '../src/data/saveScheduler';
import { invalidateAlignments } from '../src/data/upgrade';
import { AlignmentHelpers, usfmjs } from '../src/data/vendor';
import { extractVerseFromZalnUsfm, origWordsFromAlignments } from './helpers/zaln';
import { decompose } from '../journal/skeleton.mjs';
import {
  __alignIndexItemsForTests as alignIndexItems,
  __alignSaveForTests,
  __alignSessionAfterEditForTests as alignSessionAfterEdit,
  __buildAlignmentSessionForTests as buildAlignmentSession,
  __markedValidRecordForTests as markedValidRecord,
  __reflowAlignedVersesForTests as reflowAlignedVerses,
} from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const RAW: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const FILE: AlignmentFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const STORED = FILE.chapters['1']['1'];
const UGNT_TEXT: string = fs.readFileSync(path.resolve(__dirname, '../conformance/fixtures/el-x-koine_ugnt/TIT-1-1.usfm'), 'utf8');
const UGNT = (usfmjs.toJSON(UGNT_TEXT) as unknown as { chapters: Record<string, Record<string, { verseObjects: Array<Record<string, unknown>> }>> }).chapters['1']['1'].verseObjects;
const REPO = 'git.door43.org/unfoldingWord/el-x-koine_ugnt';
const REVISION = 'fc95b2b8aad08bb65ab54628ab685413a1139e97';
const SOURCE = { testament: 'nt', pin: { repoPath: REPO, version: 'v0.34', sha: REVISION }, usfmText: '' };
const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const SV_OLD = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.33';

type VO = Array<Record<string, unknown>>;
type Word = { word: string; occurrence: number | string; occurrences: number | string };
const keyOf = (w: Word): string => `${w.word.normalize('NFC')}|${Number(w.occurrence)}|${Number(w.occurrences)}`;
/** The pinned verse's source words, as the open makes them (`bootstrapVerse` on the verse's objects alone). */
const pinnedOf = (objects: VO): AlignedWord[] => bootstrapVerse([], objects, '', '').alignments.flatMap((a) => a.topWords);
const PINNED = pinnedOf(UGNT);
const topKeys = (r: AlignmentVerseRecord): string[] => r.alignments.flatMap((a) => a.topWords).map(keyOf);
const links = (r: AlignmentVerseRecord): string[] =>
  r.alignments.filter((a) => a.bottomWords.length).map((a) => `${a.topWords.map((w) => w.word).join('+')}=${a.bottomWords.map((w) => w.word).join('+')}`);
const cardsOf = (r: AlignmentVerseRecord): string[] => r.alignments.map((a) => a.topWords.map((w) => `${w.word}/${w.occurrence}`).join('+'));
const bankWords = (r: AlignmentVerseRecord): string[] => r.wordBank.map((w) => w.word);

const fileOf = (record: AlignmentVerseRecord): AlignmentFile => ({ schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': record } } });
const makeStore = (file: AlignmentFile | null) => ({
  writeAlignments: vi.fn(),
  readAlignmentsWithMd5: async () => ({ value: file, md5: 'm1' }),
});
const open = (record: AlignmentVerseRecord, source: typeof SOURCE = SOURCE, sched: SaveScheduler | null = null, store = makeStore(fileOf(record))) =>
  buildAlignmentSession(store, sched, { book: 'TIT', bookRaw: RAW, project: { scriptDirection: 'ltr' } }, '1:1', source, UGNT);
const railOf = (record: AlignmentVerseRecord, overlay?: { ref: string; stale: boolean }): string =>
  (alignIndexItems(RAW, fileOf(record), overlay) as Array<{ ref: string; status: string }>).find((i) => i.ref === '1:1')!.status;
const bankWord = (r: AlignmentVerseRecord, word: string, occurrence = 1): AlignedWord =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occurrence) as AlignedWord;
/** The sample record with the stored Παῦλος as 1 of 2: the pin has it as 1 of 1. */
const otherVersion = (): AlignmentVerseRecord => ({
  ...STORED,
  sourceVersion: SV_OLD,
  alignments: STORED.alignments.map((a, i) => (i === 0 ? { ...a, topWords: a.topWords.map((w) => ({ ...w, occurrences: 2 })) } : a)),
});
const done = (r: AlignmentVerseRecord): AlignmentVerseRecord => ({ ...r, done: true });

describe('#790 preconditions: the sample and the pinned verse are what the cases say', () => {
  it('the sample holds 10 cards for 11 source words; the pinned verse holds 17 words', () => {
    expect(STORED.alignments).toHaveLength(10);
    expect(STORED.alignments.flatMap((a) => a.topWords)).toHaveLength(11);
    expect(links(STORED)).toHaveLength(6);
    expect(PINNED).toHaveLength(17);
    expect(topKeys(STORED)).toEqual(PINNED.slice(0, 11).map(keyOf));
  });
});

describe('#790 B1 the source-fit table', () => {
  it('S1 (AC1) the sample: one card for each source word the stored cards lack, the 6 links kept, no banner', async () => {
    const s = await open(STORED);
    expect(s.record.alignments).toHaveLength(16);
    expect(topKeys(s.record)).toEqual(PINNED.map(keyOf));
    expect(links(s.record)).toEqual(links(STORED));
    const ekl = s.record.alignments.flatMap((a: { topWords: AlignedWord[] }) => a.topWords).find((w: AlignedWord) => w.word === 'ἐκλεκτῶν');
    expect(ekl.morph).toBe('Gr,NS,,,,GMP,'); // the pin's morph; the stored one is Gr,AR,,,,GMP,
    expect(s.stale).toBe(false);
    expect(s.record.invalid).not.toBe(true);
    expect(s.sourceWords?.map(keyOf)).toEqual(PINNED.map(keyOf));
    expect(railOf(STORED, { ref: '1:1', stale: s.stale === true })).toBe('todo');
  });

  it('S2 (AC2) another source version: a card with a word the pin lacks drops with its link; banner, flag, and a red rail row for the open verse', async () => {
    const stored = otherVersion();
    const s = await open(stored);
    expect(s.record.alignments).toHaveLength(16);
    expect(topKeys(s.record)).toEqual(PINNED.map(keyOf));
    expect(links(s.record)).toHaveLength(5);
    expect(bankWords(s.record)).toContain('Pablo');
    expect(s.stale).toBe(true);
    expect(s.record.invalid).toBe(true);
    // The rail holds no source text: with no open verse it judges the stored record (todo); the open overlay adds red.
    expect(railOf(stored)).toBe('todo');
    expect(railOf(stored, { ref: '1:1', stale: true })).toBe('invalid');
    expect(railOf(stored, { ref: '1:2', stale: true })).toBe('todo');
  });

  it('S3 a second card of the same source word drops: its link goes to the bank and the verse needs review', async () => {
    const y = bankWord(STORED, 'y');
    const stored: AlignmentVerseRecord = {
      ...STORED,
      alignments: [...STORED.alignments, { topWords: [STORED.alignments[2].topWords[0]], bottomWords: [y] }],
      wordBank: STORED.wordBank.filter((w) => w !== y),
    };
    expect(needsReview(stored, (decompose(RAW).verses as Record<string, string>)['1:1'])).toBe(false);
    const s = await open(stored);
    expect(s.record.alignments).toHaveLength(16);
    expect(topKeys(s.record)).toEqual(PINNED.map(keyOf));
    expect(s.record.alignments.flatMap((a: { bottomWords: AlignedWord[] }) => a.bottomWords).map((w: AlignedWord) => w.word)).not.toContain('y');
    expect(bankWords(s.record)).toContain('y');
    expect(s.stale).toBe(true);
    expect(s.record.invalid).toBe(true);
  });

  it('S4 identity: the NFC of the word, its occurrence and its occurrences; strong, lemma and morph do not count', async () => {
    const stored: AlignmentVerseRecord = {
      ...STORED,
      alignments: STORED.alignments.map((a, i) => {
        if (i === 0) return { ...a, topWords: a.topWords.map((w) => ({ ...w, word: w.word.normalize('NFD') })) };
        if (i === 1) return { ...a, topWords: a.topWords.map((w) => ({ ...w, strong: 'G99999' })) };
        return a;
      }),
    };
    expect(stored.alignments[0].topWords[0].word).not.toBe('Παῦλος');
    const s = await open(stored);
    expect(s.record.alignments).toHaveLength(16);
    expect(links(s.record)).toEqual(links(STORED));
    expect(s.stale).toBe(false);
    expect(s.record.invalid).not.toBe(true);
    // The kept cards hold the pin's words: NFC, and the pin's strong.
    expect(s.record.alignments[0].topWords[0].word).toBe('Παῦλος'.normalize('NFC'));
    expect(s.record.alignments[1].topWords[0].strong).toBe(PINNED[1].strong);
    expect(s.record.alignments[1].topWords[0].strong).not.toBe('G99999');
  });

  it('S6 a group with one missing word: the whole group drops, and each of its words has its own card', async () => {
    const stored: AlignmentVerseRecord = {
      ...STORED,
      alignments: STORED.alignments.map((a, i) => (i === 5 ? { ...a, topWords: [a.topWords[0], { ...a.topWords[1], occurrences: 2 }] } : a)),
    };
    const s = await open(stored);
    expect(s.record.alignments).toHaveLength(17);
    expect(s.record.alignments.flatMap((a: { topWords: AlignedWord[] }) => a.topWords)).toHaveLength(17);
    expect(topKeys(s.record)).toEqual(PINNED.map(keyOf));
    expect(bankWords(s.record)).toContain('Jesucristo');
    expect(links(s.record)).toHaveLength(5);
    const jesus = s.record.alignments.find((a: { topWords: AlignedWord[] }) => a.topWords[0].word === 'Ἰησοῦ');
    expect(jesus.topWords).toHaveLength(1);
    expect(jesus.bottomWords).toEqual([]);
    expect(s.stale).toBe(true);
    expect(s.record.invalid).toBe(true);
  });

  it('S6 at the fit: the same group gives 17 cards and 17 words, and counts one dropped card', () => {
    const stored: AlignmentVerseRecord = {
      ...STORED,
      alignments: STORED.alignments.map((a, i) => (i === 5 ? { ...a, topWords: [a.topWords[0], { ...a.topWords[1], occurrences: 2 }] } : a)),
    };
    const out = fitSourceCards(stored, PINNED);
    expect(out.dropped).toBe(1);
    expect(out.reshaped).toBe(true);
    expect(out.record.alignments).toHaveLength(17);
    expect(out.record.alignments.flatMap((a) => a.topWords)).toHaveLength(17);
    expect(out.record.invalid).toBe(true);
  });

  it('S8 (owner decision 2) a `done` record that only gains empty cards needs review; done stays; Mark valid clears the flag', async () => {
    const stored = done(STORED);
    const out = fitSourceCards(stored, PINNED);
    expect(out.dropped).toBe(0);
    expect(out.reshaped).toBe(true);
    expect(out.record.invalid).toBe(true);
    const s = await open(stored);
    expect(s.record.alignments).toHaveLength(16);
    expect(s.stale).toBe(true);
    expect(s.record.invalid).toBe(true);
    expect(s.record.done).toBe(true);
    expect(railOf(stored, { ref: '1:1', stale: s.stale === true })).toBe('invalid');
    const valid = markedValidRecord(s);
    expect(valid.invalid).toBe(false);
    expect(valid.done).toBe(true);
    expect(valid.alignments).toHaveLength(16);
    // The guard: the same record without `done` is not flagged (S1).
    expect(fitSourceCards(STORED, PINNED).record.invalid).toBe(false);
  });
});

/** The JON fixture's verse objects, by chapter and verse (a source verse the UHB holds in two Unicode forms). */
const JON = (usfmjs.toJSON(fs.readFileSync(path.resolve(__dirname, 'fixtures/hbo_uhb/JON.usfm'), 'utf8')) as unknown as {
  chapters: Record<string, Record<string, { verseObjects: VO }>>;
}).chapters;
const objectsOf = (chapter: string, verses: string[]): VO => verses.flatMap((v) => JON[chapter][v].verseObjects);
/** A record that `bootstrapVerse` builds on the objects, with one target word on every card. */
const fullyLinked = (objects: VO): AlignmentVerseRecord => {
  const cards = bootstrapVerse([], objects, '', '').alignments;
  return {
    alignments: cards.map((a, i) => ({ ...a, bottomWords: [{ word: `t${i}`, occurrence: 1, occurrences: 1 }] })),
    wordBank: [],
    invalid: false,
    targetVerseMd5: '',
    sourceVersion: '',
  };
};

describe('#790 B1 a key that NFC doubles (the UHB holds one word in two Unicode forms)', () => {
  const SPAN = objectsOf('4', ['6', '7']);
  const SPAN_WORDS = pinnedOf(SPAN);

  it('S5 JON 4:6-7: a fully linked record fits with no card dropped', () => {
    const record = fullyLinked(SPAN);
    expect(record.alignments).toHaveLength(30);
    const out = fitSourceCards(record, SPAN_WORDS);
    expect(out.dropped).toBe(0);
    expect(out.record.alignments.filter((a) => a.bottomWords.length)).toHaveLength(30);
    expect(out.record.invalid).toBe(false);
  });

  it('S5 every verse and every adjacent pair of the fixture fits with no card dropped', () => {
    let verses = 0;
    let pairs = 0;
    for (const chapter of Object.keys(JON)) {
      const numbers = Object.keys(JON[chapter]).filter((v) => /^\d+$/.test(v)).map(Number).sort((a, b) => a - b);
      for (const n of numbers) {
        verses++;
        const single = objectsOf(chapter, [String(n)]);
        expect(fitSourceCards(fullyLinked(single), pinnedOf(single)).dropped, `${chapter}:${n}`).toBe(0);
        if (!numbers.includes(n + 1)) continue;
        pairs++;
        const pair = objectsOf(chapter, [String(n), String(n + 1)]);
        expect(fitSourceCards(fullyLinked(pair), pinnedOf(pair)).dropped, `${chapter}:${n}-${n + 1}`).toBe(0);
      }
    }
    expect(verses).toBe(48);
    expect(pairs).toBe(44);
  });

  it('S7 a merged card with two words of one NFC key keeps both, at their own places', () => {
    const keys = SPAN_WORDS.map(keyOf);
    const doubled = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(new Set(doubled).size).toBe(1);
    const first = keys.indexOf(doubled[0]);
    const second = keys.lastIndexOf(doubled[0]);
    expect([first, second]).toEqual([17, 28]);
    const record = fullyLinked(SPAN);
    const merged = { topWords: [record.alignments[first].topWords[0], record.alignments[second].topWords[0]], bottomWords: [{ word: 'tm', occurrence: 1, occurrences: 1 }] };
    const stored: AlignmentVerseRecord = { ...record, alignments: record.alignments.map((a, i) => (i === first ? merged : a)).filter((_, i) => i !== second) };
    const out = fitSourceCards(stored, SPAN_WORDS);
    expect(out.dropped).toBe(0);
    expect(out.record.alignments).toHaveLength(29);
    expect(out.record.alignments.flatMap((a) => a.topWords)).toHaveLength(30);
    const card = out.record.alignments.find((a) => a.topWords.length === 2)!;
    expect(card.topWords).toEqual([SPAN_WORDS[17], SPAN_WORDS[28]]);
    expect(card.bottomWords.map((w) => w.word)).toEqual(['tm']);
  });
});

describe('#790 B2 (AC3) opening writes nothing; one edit saves the fitted record', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const cases: Array<[string, () => AlignmentVerseRecord, boolean]> = [
    ['S1 the sample', () => STORED, false],
    ['S2 another source version', otherVersion, true],
  ];
  it.each(cases)('%s: no store write, no staged record; one link saves 16 cards and 17 source words', async (_name, make, flagged) => {
    const stored = make();
    const store = makeStore(fileOf(stored));
    const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    const markDirty = vi.spyOn(sched, 'markDirty');
    const s = await open(stored, SOURCE, sched, store);
    expect(s.record.alignments).toHaveLength(16); // the open did fit the cards
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(0);
    expect(markDirty).not.toHaveBeenCalled();
    expect(store.writeAlignments).not.toHaveBeenCalled();
    expect(sched.getState()).toBe('saved');

    const edited = alignSessionAfterEdit(s, linkWord(s.record, 4, bankWord(s.record, 'según')), false);
    expect(edited.record.alignments).toHaveLength(16);
    expect(edited.record.alignments.flatMap((a: { topWords: AlignedWord[] }) => a.topWords)).toHaveLength(17);
    expect(topKeys(edited.record)).toEqual(PINNED.map(keyOf));
    expect(edited.record.invalid === true).toBe(flagged);
    expect(edited.stale).toBe(flagged);
  });
});

describe('#790 B3 (AC4) sourceVersion names the pin that Align last fitted the cards to', () => {
  const fitted = (): AlignmentVerseRecord => ({ ...STORED, sourceVersion: SV_OLD });

  it('(a) an Align edit stamps the pin', async () => {
    const s = await open(fitted());
    expect(s.record.sourceVersion).toBe(SV_OLD); // the open stamps nothing
    const edited = alignSessionAfterEdit(s, linkWord(s.record, 4, bankWord(s.record, 'según')), false);
    expect(edited.record.sourceVersion).toBe(SV);
  });

  it('(b) Mark valid stamps the pin, fits the cards and clears the flag', async () => {
    const s = await open(fitted());
    const valid = markedValidRecord(s);
    expect(valid.sourceVersion).toBe(SV);
    expect(valid.invalid).toBe(false);
    expect(valid.done).toBe(true);
    expect(valid.alignments).toHaveLength(16);
  });

  it('(c) a reflow and the original-language upgrade keep the value the record holds (owner decision 3)', async () => {
    const record = fitted();
    const upgraded = invalidateAlignments(fileOf(record)).file!.chapters['1']['1'];
    expect(upgraded.sourceVersion).toBe(SV_OLD);
    vi.useFakeTimers();
    try {
      const store = makeStore(fileOf(record));
      const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
      const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
      const markDirty = vi.spyOn(sched, 'markDirty');
      const edited = RAW.replace('siervo', 'esclavo');
      await reflowAlignedVerses({ store, sched, book: 'TIT', bookRaw: edited, beforeRaw: RAW }, ['1:1']);
      expect(markDirty).toHaveBeenCalledTimes(1);
      const staged = JSON.parse(markDirty.mock.calls[0][3] as string) as AlignmentVerseRecord;
      expect(staged.sourceVersion).toBe(SV_OLD);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(d) a pin with no version stamps the sha after the @', async () => {
    const s = await open(fitted(), { ...SOURCE, pin: { repoPath: REPO, sha: REVISION } as never });
    const edited = alignSessionAfterEdit(s, linkWord(s.record, 4, bankWord(s.record, 'según')), false);
    expect(edited.record.sourceVersion).toBe(`dcs::unfoldingWord/el-x-koine_ugnt@${REVISION}`);
  });
});

describe('#790 B4 (AC5) cards and topWords follow the pinned verse after a split or a merge', () => {
  /** A tC3 record: cards by their first source word, with a group that has a gap, [κατὰ ἐκλεκτῶν] in κατὰ's place and [πίστιν] after it. */
  const tc3 = (): AlignmentVerseRecord => {
    const al = STORED.alignments;
    const group = { topWords: [al[6].topWords[0], al[8].topWords[0]], bottomWords: [] };
    return { ...STORED, alignments: [...al.slice(0, 6), group, al[7], al[9]] };
  };
  const GROUP = 6;

  it('the open keeps the group before πίστιν; a split gives κατὰ | πίστιν | ἐκλεκτῶν', async () => {
    const s = await open(tc3());
    const at = cardsOf(s.record);
    expect(at.slice(6, 9)).toEqual(['κατὰ/1+ἐκλεκτῶν/1', 'πίστιν/1', 'Θεοῦ/2']);
    const split = alignSessionAfterEdit(s, splitAlignment(s.record, GROUP), false);
    expect(cardsOf(split.record).slice(6, 10)).toEqual(['κατὰ/1', 'πίστιν/1', 'ἐκλεκτῶν/1', 'Θεοῦ/2']);
    expect(at).toHaveLength(15);
  });

  it('a merge of the group with the next card gives κατὰ+πίστιν+ἐκλεκτῶν', async () => {
    const s = await open(tc3());
    const merged = alignSessionAfterEdit(s, mergeAlignments(s.record, GROUP, GROUP + 1), false);
    expect(cardsOf(merged.record).slice(6, 8)).toEqual(['κατὰ/1+πίστιν/1+ἐκλεκτῶν/1', 'Θεοῦ/2']);
  });

  it('records the behaviour: two interleaved groups weave with no skip, and unweaving gives the same linked groups', () => {
    const top = (word: string, occurrence = 1) => PINNED.find((w) => w.word === word && Number(w.occurrence) === occurrence) as AlignedWord;
    const bank = (word: string) => STORED.wordBank.find((w) => w.word === word) as AlignedWord;
    const dios2 = STORED.alignments[9].bottomWords;
    const record: AlignmentVerseRecord = {
      ...STORED,
      alignments: [
        ...STORED.alignments.slice(0, 6),
        { topWords: [top('κατὰ'), top('ἐκλεκτῶν')], bottomWords: [bank('según')] },
        { topWords: [top('πίστιν'), top('Θεοῦ', 2)], bottomWords: [bank('fe'), ...dios2] },
      ],
      wordBank: STORED.wordBank.filter((w) => w.word !== 'según' && w.word !== 'fe'),
    };
    const slot = (decompose(RAW).verses as Record<string, string>)['1:1'];
    expect(needsReview(record, slot)).toBe(false);
    const skips: Array<{ ref: string; reason: string }> = [];
    const out = weaveBook(RAW, fileOf(record), AlignmentHelpers, (skip: { ref: string; reason: string }) => skips.push(skip));
    expect(skips).toEqual([]);
    const woven = (decompose(out).verses as Record<string, string>)['1:1'];
    expect((woven.match(/\\zaln-s/g) ?? []).length).toBe(12);
    const back = extractVerseFromZalnUsfm(woven, origWordsFromAlignments(record.alignments));
    const groups = back.alignments
      .filter((a) => a.bottomWords.length)
      .map((a) => `${a.topWords.map((w) => w.word).join('+')}=${a.bottomWords.map((w) => w.word).join('+')}`);
    expect(groups).toHaveLength(7);
    expect(groups).toEqual(expect.arrayContaining(['κατὰ+ἐκλεκτῶν=según', 'πίστιν+Θεοῦ=fe+Dios']));
  });
});
