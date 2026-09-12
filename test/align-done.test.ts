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
  unlinkWord,
  isFullyAligned,
  settleDone,
  markDone,
  reflowAlignment,
  stampTargetVerse,
  alignmentIsStale,
} from '../src/data/align/edit';
import { __alignVerseStatusForTests as alignVerseStatus } from '../src/state.jsx';
import type { AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

const ORIG = [
  { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const TEXT = 'Pablo siervo';

const bankWord = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;
const placedWord = (r: AlignmentVerseRecord, i: number) => r.alignments[i].bottomWords[0];

/** Pablo→Παῦλος placed; "siervo" still in the bank. */
const halfAligned = () => {
  const r = bootstrapVerse(TEXT, ORIG, SOURCE);
  return stampTargetVerse(linkWord(r, 0, bankWord(r, 'Pablo')), TEXT);
};

describe('#271 isFullyAligned — tC3’s areAlgnmentsComplete', () => {
  it('true only when the bank is empty and no source group is left without a target word', () => {
    const half = halfAligned();
    expect(isFullyAligned(half)).toBe(false);
    const full = linkWord(half, 1, bankWord(half, 'siervo'));
    expect(isFullyAligned(full)).toBe(true);
    // A bootstrap (nothing placed) is not aligned even if the bank were empty.
    expect(isFullyAligned({ ...bootstrapVerse(TEXT, ORIG, SOURCE), wordBank: [] })).toBe(false);
  });
});

describe('#271 settleDone — all aligned is done; any edit takes it back', () => {
  it('placing the last word sets done; the record was not carrying the field before', () => {
    const half = settleDone(halfAligned());
    expect('done' in half).toBe(false);
    const full = settleDone(linkWord(half, 1, bankWord(half, 'siervo')));
    expect(full.done).toBe(true);
  });

  it('unlinking a word after done removes the field — absent, never false', () => {
    const half = halfAligned();
    const full = settleDone(linkWord(half, 1, bankWord(half, 'siervo')));
    const again = settleDone(unlinkWord(full, 1, placedWord(full, 1)));
    expect('done' in again).toBe(false);
    expect(JSON.stringify(again)).not.toContain('"done"');
  });

  it('a Mark valid with words in the bank is taken back by the next edit', () => {
    const marked = markDone(halfAligned(), TEXT);
    expect(marked.done).toBe(true);
    const edited = settleDone(unlinkWord(marked, 0, placedWord(marked, 0)));
    expect('done' in edited).toBe(false);
  });
});

describe('#271 markDone — Mark valid restamps and flags', () => {
  it('sets done with words still in the bank, and the record vouches for the current text', () => {
    const stale = halfAligned(); // stamped against TEXT
    const newText = 'Pablo, siervo';
    expect(alignmentIsStale(stale, newText)).toBe(true);
    const marked = markDone(stale, newText);
    expect(marked.done).toBe(true);
    expect(marked.wordBank.length).toBe(1);
    expect(alignmentIsStale(marked, newText)).toBe(false);
    // A record flagged for re-review (a span create/break, #63) is re-reviewed by Mark valid.
    const flagged = markDone({ ...stale, invalid: true }, newText);
    expect(flagged.invalid).toBe(false);
    expect(alignVerseStatus(flagged, newText).status).toBe('valid');
  });
});

describe('#271 the #213 reflow recomputes done', () => {
  it('a reflow that drops a placed word removes done; one that keeps every word placed sets it', () => {
    const half = halfAligned();
    const full = settleDone(linkWord(half, 1, bankWord(half, 'siervo')));
    expect(full.done).toBe(true);
    // "siervo" becomes "esclavo": its link drops, the bank is not empty — not done.
    const dropped = reflowAlignment(full, 'Pablo esclavo');
    expect(dropped).not.toBeNull();
    expect('done' in dropped!).toBe(false);
    // Only punctuation changed: every word still placed — still done.
    const kept = reflowAlignment(full, 'Pablo, siervo.');
    expect(kept!.done).toBe(true);
  });
});

describe('#271 the rail’s status reads valid from done only', () => {
  it('fully placed but not done → todo; done → valid; done but stale → invalid; done + invalid flag → invalid', () => {
    const half = halfAligned();
    const fullNoFlag = linkWord(half, 1, bankWord(half, 'siervo')); // no settleDone: a legacy record
    expect(alignVerseStatus(fullNoFlag, TEXT).status).toBe('todo');
    expect(alignVerseStatus(settleDone(fullNoFlag), TEXT).status).toBe('valid');
    expect(alignVerseStatus(markDone(half, TEXT), TEXT).status).toBe('valid'); // words in the bank, marked valid
    expect(alignVerseStatus(markDone(half, TEXT), 'Pablo siervo de Dios').status).toBe('invalid'); // stale
    expect(alignVerseStatus({ ...markDone(half, TEXT), invalid: true }, TEXT).status).toBe('invalid');
    expect(alignVerseStatus(undefined, TEXT).status).toBe('todo');
    expect(alignVerseStatus(undefined, '').status).toBe('undrafted');
  });
});
