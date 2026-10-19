// #796 slice 3 — one review rule for the rail, the banner and Mark valid.
//
// Three places decided "this alignment needs review" with three rules. The rail
// read `invalid` OR the hash. The banner read the hash OR "the open rebuilt the
// words". The Mark valid gate read the banner. None read the word clause alone,
// and `stampTargetVerse` wrote `invalid: false` on every edit, so one link on an
// upgraded (D72) record cleared the flag with no review (F14a).
//
// `needsReview` (src/data/align/review.mjs) is now the one rule. Each scenario below
// runs the three consumers on the same record and the same text:
//   rail   — `__alignIndexItemsForTests` status is 'invalid'
//   banner — `__buildAlignmentSessionForTests().stale`
//   gate   — MarkValidBar's rule: `record.done === true && !stale && record.invalid !== true`
// The records of S1-S5 carry `done: true`, so the gate would be on if nothing flagged
// them. S0 is the sample as it is, and S0d is the same record with `done: true`: the
// control that shows the gate column can turn on.
//
// The ways this can fail, written before the code:
// 1. a record whose words differ from the verse, with the current hash, shows no
//    red dot (S2, S3 rail) or no banner;
// 2. an upgraded record (`invalid: true`) with the current hash opens with no banner (S4);
// 3. one edit on an `invalid` record clears the flag, the rail or the banner (B2);
// 4. the rule flags a record that matches its verse (S0, S0d);
// 5. the open drops the `invalid` flag of a span record (#63, no link), so the editor's
//    bootstrap record (`invalid: false`) is what the first edit saves (B2, the span record).
import { describe, expect, it } from 'vitest';
import { bookModel } from '../src/data/bookModel.js';
import { bootstrapVerse, finalizeEdit, linkWord, markDone, reconcileToWords, stampTargetVerse } from '../src/data/align/edit';
import { needsReview } from '../src/data/align/review.mjs';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { invalidateAlignments } from '../src/data/upgrade';
import { decompose } from '../journal/skeleton.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import {
  __alignIndexItemsForTests as alignIndexItems,
  __alignSessionAfterEditForTests as alignSessionAfterEdit,
  __buildAlignmentSessionForTests as buildAlignmentSession,
} from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const RAW: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const FILE: AlignmentFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const STORED = FILE.chapters['1']['1'];
const SOURCE = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';

const T1 = (bookModel(RAW).byChapter as Record<string, Array<{ n: string; text: string }>>)['1'].find((v) => v.n === '1')!.text;
const RAW_EDITED = RAW.replace(T1, T1.replace('siervo', 'esclavo'));
const slotOf = (raw: string): string => (decompose(raw).verses as Record<string, string>)['1:1'];
const md5Of = (raw: string): string => verseTextMd5(slotOf(raw)) as string;

const ORIG = STORED.alignments.flatMap((a) => a.topWords).map((t) => ({
  tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph,
  occurrence: t.occurrence, occurrences: t.occurrences,
}));

const fileOf = (record: AlignmentVerseRecord): AlignmentFile => ({ schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': record } } });
const storeOf = (file: AlignmentFile) => ({ writeAlignments: () => {}, readAlignmentsWithMd5: async () => ({ value: file, md5: 'm1' }) });

type Consumers = { rail: boolean; banner: boolean; gate: boolean };

/** The three consumers, on one record and one book text. */
async function consumers(record: AlignmentVerseRecord, raw: string): Promise<Consumers> {
  const file = fileOf(record);
  const items = alignIndexItems(raw, file) as Array<{ ref: string; status: string }>;
  const session = await buildAlignmentSession(storeOf(file), null, { book: 'TIT', bookRaw: raw, project: {} }, '1:1', SOURCE, ORIG);
  return {
    rail: items.find((i) => i.ref === '1:1')?.status === 'invalid',
    banner: session.stale === true,
    gate: session.record.done === true && !session.stale && session.record.invalid !== true,
  };
}

const bankWord = (r: AlignmentVerseRecord, word: string): AlignedWord => r.wordBank.find((w) => w.word === word) as AlignedWord;
const done = (r: AlignmentVerseRecord): AlignmentVerseRecord => ({ ...r, done: true });

/** S2: "escogidos" is on no card and not in the bank; the hash is current. */
const s2 = (): AlignmentVerseRecord => done({ ...STORED, wordBank: STORED.wordBank.filter((w) => w.word !== 'escogidos') });
/** S3: "Pablo" is on a card and in the bank too; the hash is current. */
const s3 = (): AlignmentVerseRecord => {
  const placed = STORED.alignments.flatMap((a) => a.bottomWords).find((w) => w.word === 'Pablo') as AlignedWord;
  return done({ ...STORED, wordBank: [...STORED.wordBank, { ...placed }] });
};
/** S4: what the D72 upgrade does to the sample record: `invalid: true`, the hash current. */
const s4 = (): AlignmentVerseRecord => done(invalidateAlignments(FILE).file!.chapters['1']['1']);
/** S5: Mark valid with nothing placed, in the old text. */
const s5 = (): AlignmentVerseRecord => markDone(bootstrapVerse(verseWords(slotOf(RAW)), ORIG, SV, md5Of(RAW)), md5Of(RAW));

describe('#796 slice 3 B1 the rail, the banner and the gate read one rule', () => {
  it('preconditions: the sample record matches its verse, and each scenario is what its name says', () => {
    expect(STORED.targetVerseMd5).toBe(md5Of(RAW));
    expect(reconcileToWords(STORED, verseWords(slotOf(RAW))).changed).toBe(false);
    // S2 and S3 keep the current hash and differ from the verse by words alone.
    expect(s2().targetVerseMd5).toBe(md5Of(RAW));
    expect(reconcileToWords(s2(), verseWords(slotOf(RAW))).changed).toBe(true);
    expect(s3().targetVerseMd5).toBe(md5Of(RAW));
    expect(reconcileToWords(s3(), verseWords(slotOf(RAW))).changed).toBe(true);
    expect(s4().invalid).toBe(true);
    expect(s4().targetVerseMd5).toBe(md5Of(RAW));
    expect(s5().done).toBe(true);
    expect(md5Of(RAW_EDITED)).not.toBe(md5Of(RAW));
  });

  const table: Array<[string, () => AlignmentVerseRecord, string, Consumers]> = [
    ['S0 the sample as it is', () => STORED, RAW, { rail: false, banner: false, gate: false }],
    ['S0d control: the sample, marked done', () => done(STORED), RAW, { rail: false, banner: false, gate: true }],
    ['S1 the text was edited, no reflow', () => done(STORED), RAW_EDITED, { rail: true, banner: true, gate: false }],
    ['S2 a word on no card and not in the bank, current hash', s2, RAW, { rail: true, banner: true, gate: false }],
    ['S3 a word in the bank and on a card, current hash', s3, RAW, { rail: true, banner: true, gate: false }],
    ['S4 invalidateAlignments, current hash', s4, RAW, { rail: true, banner: true, gate: false }],
    ['S5 Mark valid with nothing placed, then a text edit', s5, RAW_EDITED, { rail: true, banner: true, gate: false }],
  ];
  it.each(table)('%s', async (_name, make, raw, expected) => {
    expect(await consumers(make(), raw)).toEqual(expected);
  });
});

describe('#796 slice 3 B2 an edit keeps `invalid` until Mark valid (acceptance criterion 3)', () => {
  it('S4: one link and finalizeEdit keep invalid:true, the rail and the banner; Mark valid clears all three', async () => {
    const file = fileOf(s4());
    const open = await buildAlignmentSession(storeOf(file), null, { book: 'TIT', bookRaw: RAW, project: {} }, '1:1', SOURCE, ORIG);
    expect(open.stale).toBe(true);
    expect(open.record.invalid).toBe(true);

    // One link: a bank word to a card that has none (what applyAlignEdit runs).
    const card = open.record.alignments.findIndex((a: { bottomWords: AlignedWord[] }) => a.bottomWords.length === 0);
    const edited = alignSessionAfterEdit(open, linkWord(open.record, card, bankWord(open.record, 'según')), false);
    expect(edited.record.invalid).toBe(true);
    expect(edited.stale).toBe(true);
    // Saved, the rail still reads the record as work.
    const rail = (record: AlignmentVerseRecord) =>
      (alignIndexItems(RAW, fileOf(record)) as Array<{ ref: string; status: string }>).find((i) => i.ref === '1:1')?.status;
    expect(rail(edited.record)).toBe('invalid');
    // The same edit through the bare pipeline: the flag is the record's, not the session's.
    expect(finalizeEdit(linkWord(open.record, card, bankWord(open.record, 'según')), open.words, open.targetMd5).invalid).toBe(true);

    // Mark valid (markAlignValid's record pipeline): the one place the flag clears.
    const marked = markDone(reconcileToWords(edited.record, open.words).record, open.targetMd5);
    expect(marked.invalid).toBe(false);
    expect(rail(marked)).toBe('valid');
  });

  it('the span record (#63): the open carries its `invalid`, one link keeps it, Mark valid clears it', async () => {
    // journalingStore.spanInvalidRecords writes `align.verse.set` with `alignments: []`,
    // `wordBank: []`, the new key's text hash and `invalid: true`, and no `sourceVersion`.
    // The projection spreads the event, so this is the sidecar record as it is stored.
    const span = { alignments: [], wordBank: [], targetVerseMd5: md5Of(RAW), invalid: true } as unknown as AlignmentVerseRecord;
    const file = fileOf(span);
    const rail = (record: AlignmentVerseRecord) =>
      (alignIndexItems(RAW, fileOf(record)) as Array<{ ref: string; status: string }>).find((i) => i.ref === '1:1')?.status;
    // The record has no link, so the open builds the editor's record from the bootstrap,
    // whose flag is false: the carry in `openedRecord` is the only thing that keeps the stored one.
    const open = await buildAlignmentSession(storeOf(file), null, { book: 'TIT', bookRaw: RAW, project: {} }, '1:1', SOURCE, ORIG);
    expect(open.stale).toBe(true);
    expect(open.record.invalid).toBe(true);
    expect(rail(span)).toBe('invalid');

    // One link: the first bank word to the first card, what applyAlignEdit runs.
    const card = open.record.alignments.findIndex((a: { bottomWords: AlignedWord[] }) => a.bottomWords.length === 0);
    const edited = alignSessionAfterEdit(open, linkWord(open.record, card, open.record.wordBank[0]), false);
    expect(edited.record.alignments[card].bottomWords).toHaveLength(1);
    expect(edited.record.invalid).toBe(true);
    expect(edited.stale).toBe(true);
    expect(rail(edited.record)).toBe('invalid');

    const marked = markDone(reconcileToWords(edited.record, open.words).record, open.targetMd5);
    expect(marked.invalid).toBe(false);
    expect(rail(marked)).toBe('valid');
  });
});

describe('#796 slice 3 needsReview, step by step', () => {
  const slot = slotOf(RAW);
  const never = () => {
    throw new Error('this step must not run');
  };

  it('1 invalid is true: yes, with no hash and no words made, and with no slot', () => {
    expect(needsReview({ ...STORED, invalid: true }, slot, { wordsOf: never, md5Of: never })).toBe(true);
    expect(needsReview({ ...STORED, invalid: true }, undefined, { wordsOf: never, md5Of: never })).toBe(true);
  });

  it('2 a record with no link and not done: no, with no hash and no words made, and with no slot', () => {
    const bare = bootstrapVerse(verseWords(slot), ORIG, SV, 'stale-hash');
    expect(needsReview(bare, slot, { wordsOf: never, md5Of: never })).toBe(false);
    expect(needsReview(bare, undefined, { wordsOf: never, md5Of: never })).toBe(false);
    // Done, or a link, makes it vouch.
    expect(needsReview(done(bare), slot)).toBe(true);
    expect(needsReview({ ...STORED, targetVerseMd5: 'stale-hash' }, slot)).toBe(true);
  });

  it('3 no slot: yes for a record that vouches', () => {
    expect(needsReview(STORED, undefined, { wordsOf: never, md5Of: never })).toBe(true);
  });

  it('4 a hash that is not the slot\'s: yes, with no words made', () => {
    expect(needsReview({ ...STORED, targetVerseMd5: 'stale-hash' }, slot, { wordsOf: never })).toBe(true);
  });

  it('5 the words: the sample matches; one word more or fewer, a count change and a doubled word do not', () => {
    expect(needsReview(STORED, slot)).toBe(false);
    expect(needsReview({ ...STORED, wordBank: STORED.wordBank.slice(1) }, slot)).toBe(true);
    expect(needsReview(s3(), slot)).toBe(true);
    // A record with no `wordBank` key holds only its placed words, so it differs from the verse.
    const noBank: Partial<AlignmentVerseRecord> = { ...STORED };
    delete noBank.wordBank;
    expect(needsReview(noBank as AlignmentVerseRecord, slot)).toBe(true);
  });

  it('stampTargetVerse stamps the hash and leaves `invalid` as it is', () => {
    expect(stampTargetVerse({ ...STORED, invalid: true }, 'h')).toMatchObject({ invalid: true, targetVerseMd5: 'h' });
    expect(stampTargetVerse({ ...STORED, invalid: false }, 'h')).toMatchObject({ invalid: false, targetVerseMd5: 'h' });
  });
});
