// #271 (D73) — a verse's alignment is done when every word is placed, or when
// the translator marks it valid; any later alignment edit takes it back.
//
// The fact is the §5.1 record's optional `done` flag: set by settleDone after
// an edit that leaves the verse fully aligned, set by markDone (Mark valid)
// with words still in the bank, removed by settleDone on every other edit
// and by the #213 reflow. The rail reads `valid` from the flag alone, and a
// stale record is not valid whatever the flag says.
import { describe, expect, it } from 'vitest';
import {
  bootstrapVerse,
  linkWord,
  isFullyAligned,
  settleDone,
  markDone,
  reflowAlignment,
  stampTargetVerse,
  alignmentIsStale,
} from '../src/data/align/edit';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { __alignVerseStatusForTests as alignVerseStatus } from '../src/state.jsx';
import { verseTextMd5 } from '../journal/fold.mjs';
import type { AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

const ORIG = [
  { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const TEXT = 'Pablo siervo';
/** The hash a record stamps for a plain one-line verse: the export's own. */
const MD5 = verseTextMd5(TEXT);

/** A plain one-line verse as the reflow compares it (#789): its slot, the export's words and hash. */
const verse = (text: string) => ({ slot: text, words: verseWords(text), md5: verseTextMd5(text) });

const bankWord = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;

/** Pablo→Παῦλος placed; "siervo" still in the bank. */
const halfAligned = () => {
  const r = bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, MD5);
  return stampTargetVerse(linkWord(r, 0, bankWord(r, 'Pablo')), MD5);
};

describe('#271 isFullyAligned — tC3’s areAlgnmentsComplete', () => {
  it('true only when the bank is empty and no source group is left without a target word', () => {
    const half = halfAligned();
    expect(isFullyAligned(half)).toBe(false);
    const full = linkWord(half, 1, bankWord(half, 'siervo'));
    expect(isFullyAligned(full)).toBe(true);
    // A bootstrap (nothing placed) is not aligned even if the bank were empty.
    expect(isFullyAligned({ ...bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, MD5), wordBank: [] })).toBe(false);
  });
});

describe('#271 settleDone — all aligned is done', () => {
  it('placing the last word sets done; the record was not carrying the field before', () => {
    const half = settleDone(halfAligned());
    expect('done' in half).toBe(false);
    const full = settleDone(linkWord(half, 1, bankWord(half, 'siervo')));
    expect(full.done).toBe(true);
  });
});

describe('#271 markDone — Mark valid restamps and flags', () => {
  it('sets done with words still in the bank, and the record vouches for the current text', () => {
    const stale = halfAligned(); // stamped against TEXT
    const newText = 'Pablo, siervo';
    expect(alignmentIsStale(stale, verseTextMd5(newText))).toBe(true);
    const marked = markDone(stale, verseTextMd5(newText));
    expect(marked.done).toBe(true);
    expect(marked.wordBank.length).toBe(1);
    expect(alignmentIsStale(marked, verseTextMd5(newText))).toBe(false);
    // A record flagged for re-review (a span create/break, #63) is re-reviewed by Mark valid.
    const flagged = markDone({ ...stale, invalid: true }, verseTextMd5(newText));
    expect(flagged.invalid).toBe(false);
    expect(alignVerseStatus(flagged, newText, newText).status).toBe('valid');
  });
});

describe('#271 the #213 reflow recomputes done', () => {
  it('a reflow that drops a placed word removes done; one that keeps every word placed sets it', () => {
    const half = halfAligned();
    const full = settleDone(linkWord(half, 1, bankWord(half, 'siervo')));
    expect(full.done).toBe(true);
    // "siervo" becomes "esclavo": its link drops, the bank is not empty — not done.
    const dropped = reflowAlignment(full, verse(TEXT), verse('Pablo esclavo'));
    expect(dropped).not.toBeNull();
    expect('done' in dropped!).toBe(false);
    // Only punctuation changed: every word still placed — still done.
    const kept = reflowAlignment(full, verse(TEXT), verse('Pablo, siervo.'));
    expect(kept!.done).toBe(true);
  });
});

// The third argument of the status is the verse's stored slot text (#796, `needsReview`).
describe('#271 the rail’s status reads valid from done only', () => {
  it('fully placed but not done → todo; done → valid; done but stale → invalid; done + invalid flag → invalid', () => {
    const half = halfAligned();
    const fullNoFlag = linkWord(half, 1, bankWord(half, 'siervo')); // no settleDone: a legacy record
    expect(alignVerseStatus(fullNoFlag, TEXT, TEXT).status).toBe('todo');
    expect(alignVerseStatus(settleDone(fullNoFlag), TEXT, TEXT).status).toBe('valid');
    expect(alignVerseStatus(markDone(half, MD5), TEXT, TEXT).status).toBe('valid'); // words in the bank, marked valid
    expect(alignVerseStatus(markDone(half, MD5), 'Pablo siervo de Dios', 'Pablo siervo de Dios').status).toBe('invalid'); // stale
    expect(alignVerseStatus({ ...markDone(half, MD5), invalid: true }, TEXT, TEXT).status).toBe('invalid');
    expect(alignVerseStatus(undefined, TEXT, TEXT).status).toBe('todo');
    expect(alignVerseStatus(undefined, '', undefined).status).toBe('undrafted');
  });

  // #796 slice 3 (D105 point 4): a record with no link and not `done` vouches for nothing, so a
  // changed text leaves it `todo`; the `invalid` flag is the one thing it can still carry.
  it('a record with no link and not done reads todo whatever the text; flagged invalid, it reads invalid', () => {
    const bootstrap = bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, MD5);
    expect(alignVerseStatus(bootstrap, 'Pablo siervo de Dios', 'Pablo siervo de Dios').status).toBe('todo');
    expect(alignVerseStatus({ ...bootstrap, invalid: true }, TEXT, TEXT).status).toBe('invalid');
  });
});
