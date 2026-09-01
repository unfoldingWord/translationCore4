// C2.11/C2.12 — alignment editing and the bootstrap (J5).
// Real libraries, real USFM: the same word-aligner the conformance harness uses.
import { describe, expect, it } from 'vitest';
import {
  bootstrapVerse,
  tokenizeTargetVerse,
  linkWord,
  unlinkWord,
  stampTargetVerse,
  alignmentIsStale,
  allTargetWords,
} from '../src/data/align/edit';
import type { AlignedWord } from '../src/data/align/zaln';

const ORIG = [
  { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const TARGET = 'Pablo, siervo de Dios y de Dios';
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';

const boot = () => bootstrapVerse(TARGET, ORIG, SOURCE);
const wordIn = (words: AlignedWord[], w: string, occ = 1) =>
  words.find((x) => x.word === w && Number(x.occurrence) === occ) as AlignedWord;

describe('tokenizeTargetVerse — the bootstrap needs word tokens, not plain text', () => {
  it('emits \\w tokens carrying occurrence and occurrences', () => {
    const out = tokenizeTargetVerse(TARGET);
    expect(out).toContain('\\w Pablo|x-occurrence="1" x-occurrences="1"\\w*');
    // "Dios" appears twice: second occurrence numbered, total recorded on both.
    expect(out).toContain('\\w Dios|x-occurrence="1" x-occurrences="2"\\w*');
    expect(out).toContain('\\w Dios|x-occurrence="2" x-occurrences="2"\\w*');
  });

  it('preserves punctuation and spacing between words', () => {
    expect(tokenizeTargetVerse('Pablo, siervo')).toContain(', ');
  });
});

describe('C2.12 bootstrap — an unaligned verse starts usable, not empty', () => {
  const record = boot();

  it('offers one alignment per original word, each with no target words yet', () => {
    expect(record.alignments).toHaveLength(ORIG.length);
    expect(record.alignments.every((a) => a.bottomWords.length === 0)).toBe(true);
    expect(record.alignments[0].topWords[0].word).toBe('Παῦλος');
  });

  it('banks every target word — 7 for this verse', () => {
    expect(record.wordBank).toHaveLength(7);
    expect(record.wordBank.map((w) => w.word)).toContain('Pablo');
  });

  it('I-2: every occurrence crossing the boundary is an INTEGER, not a string', () => {
    // word-aligner hands occurrences back as strings; unnormalized they break
    // the whole alignment stack (PLATFORM-NOTES #2).
    for (const w of allTargetWords(record)) {
      expect(typeof w.occurrence).toBe('number');
      expect(typeof w.occurrences).toBe('number');
    }
    for (const a of record.alignments) {
      for (const w of a.topWords) expect(typeof w.occurrence).toBe('number');
    }
  });

  it('records the draft it was built against, and is not stale against it', () => {
    expect(record.targetVerseMd5).toMatch(/^[0-9a-f]{32}$/);
    expect(record.sourceVersion).toBe(SOURCE);
    expect(record.invalid).toBe(false);
    expect(alignmentIsStale(record, TARGET)).toBe(false);
  });

  it('distinguishes repeated words by occurrence — both "Dios" are bankable', () => {
    const dios = record.wordBank.filter((w) => w.word === 'Dios');
    expect(dios).toHaveLength(2);
    expect(dios.map((w) => w.occurrence).sort()).toEqual([1, 2]);
    expect(dios.every((w) => w.occurrences === 2)).toBe(true);
  });
});

describe('C2.11 link / unlink — a word is in exactly one place', () => {
  it('linking moves the word out of the bank and into the alignment', () => {
    const record = boot();
    const pablo = wordIn(record.wordBank, 'Pablo');
    const next = linkWord(record, 0, pablo);
    expect(next.alignments[0].bottomWords.map((w) => w.word)).toEqual(['Pablo']);
    expect(next.wordBank.some((w) => w.word === 'Pablo')).toBe(false);
    expect(allTargetWords(next)).toHaveLength(allTargetWords(record).length); // conserved
  });

  it('the two "Dios" occurrences link independently', () => {
    let record = boot();
    record = linkWord(record, 0, wordIn(record.wordBank, 'Dios', 1));
    expect(record.wordBank.filter((w) => w.word === 'Dios')).toHaveLength(1);
    record = linkWord(record, 1, wordIn(record.wordBank, 'Dios', 2));
    expect(record.wordBank.filter((w) => w.word === 'Dios')).toHaveLength(0);
    expect(record.alignments[0].bottomWords[0].occurrence).toBe(1);
    expect(record.alignments[1].bottomWords[0].occurrence).toBe(2);
  });

  it('a word that is not banked cannot be linked (no double-linking)', () => {
    const record = boot();
    const pablo = wordIn(record.wordBank, 'Pablo');
    const once = linkWord(record, 0, pablo);
    const twice = linkWord(once, 1, pablo); // already linked elsewhere
    expect(twice).toBe(once); // unchanged
  });

  it('an out-of-range alignment index is a no-op, not a crash', () => {
    const record = boot();
    expect(linkWord(record, 99, wordIn(record.wordBank, 'Pablo'))).toBe(record);
  });

  it('unlinking returns the word to the bank', () => {
    const record = boot();
    const pablo = wordIn(record.wordBank, 'Pablo');
    const linked = linkWord(record, 0, pablo);
    const back = unlinkWord(linked, 0, pablo);
    expect(back.alignments[0].bottomWords).toHaveLength(0);
    expect(back.wordBank.some((w) => w.word === 'Pablo')).toBe(true);
    expect(allTargetWords(back)).toHaveLength(allTargetWords(record).length);
  });

  it('unlinking a word that is not there is a no-op', () => {
    const record = boot();
    expect(unlinkWord(record, 0, wordIn(record.wordBank, 'Pablo'))).toBe(record);
  });

  it('edits never mutate the record they were given', () => {
    const record = boot();
    const bankBefore = record.wordBank.length;
    linkWord(record, 0, wordIn(record.wordBank, 'Pablo'));
    expect(record.wordBank).toHaveLength(bankBefore);
  });
});

describe('I-3 — the draft hash makes a later edit detectable', () => {
  it('a changed verse makes the alignment stale', () => {
    const record = boot();
    expect(alignmentIsStale(record, TARGET.replace('Pablo', 'Saulo'))).toBe(true);
  });

  it('re-stamping after an intentional edit clears staleness', () => {
    const edited = TARGET.replace('Pablo', 'Saulo');
    const restamped = stampTargetVerse(boot(), edited);
    expect(alignmentIsStale(restamped, edited)).toBe(false);
    expect(restamped.invalid).toBe(false);
  });
});

// #129 — phrase alignment (merge/split) and the one-step move for drag.
import { mergeAlignments, splitAlignment, moveWord } from '../src/data/align/edit';

describe('#129 merge / split — phrase alignments stay original-anchored', () => {
  it('merge concatenates topWords and bottomWords in index order at the lower index', () => {
    let rec = boot();
    rec = linkWord(rec, 0, wordIn(rec.wordBank, 'Pablo'));
    rec = linkWord(rec, 1, wordIn(rec.wordBank, 'siervo'));
    const merged = mergeAlignments(rec, 1, 0);
    expect(merged.alignments).toHaveLength(1);
    expect(merged.alignments[0].topWords.map((w) => w.word)).toEqual(['Παῦλος', 'δοῦλος']);
    expect(merged.alignments[0].bottomWords.map((w) => w.word)).toEqual(['Pablo', 'siervo']);
    // No word entered or left the verse.
    expect(allTargetWords(merged)).toHaveLength(allTargetWords(rec).length);
  });

  it('merge with an out-of-range or identical index changes nothing', () => {
    const rec = boot();
    expect(mergeAlignments(rec, 0, 0)).toBe(rec);
    expect(mergeAlignments(rec, 0, 99)).toBe(rec);
  });

  it('split restores single-word groups, linked words staying on the first', () => {
    let rec = boot();
    rec = linkWord(rec, 0, wordIn(rec.wordBank, 'Pablo'));
    rec = mergeAlignments(rec, 0, 1);
    const split = splitAlignment(rec, 0);
    expect(split.alignments).toHaveLength(2);
    expect(split.alignments[0].topWords.map((w) => w.word)).toEqual(['Παῦλος']);
    expect(split.alignments[0].bottomWords.map((w) => w.word)).toEqual(['Pablo']);
    expect(split.alignments[1].bottomWords).toHaveLength(0);
  });

  it('split on a single-word group changes nothing', () => {
    const rec = boot();
    expect(splitAlignment(rec, 0)).toBe(rec);
  });
});

describe('#129 moveWord — a drag between cards is one record step', () => {
  it('moves a placed word from one alignment to another, bank untouched', () => {
    let rec = boot();
    rec = linkWord(rec, 0, wordIn(rec.wordBank, 'Pablo'));
    const bankBefore = rec.wordBank.length;
    const moved = moveWord(rec, 0, 1, { word: 'Pablo', occurrence: 1, occurrences: 1 });
    expect(moved.alignments[0].bottomWords).toHaveLength(0);
    expect(moved.alignments[1].bottomWords.map((w) => w.word)).toEqual(['Pablo']);
    expect(moved.wordBank).toHaveLength(bankBefore);
  });

  it('a move to a missing target or onto itself changes nothing', () => {
    let rec = boot();
    rec = linkWord(rec, 0, wordIn(rec.wordBank, 'Pablo'));
    const w = { word: 'Pablo', occurrence: 1, occurrences: 1 };
    expect(moveWord(rec, 0, 0, w)).toBe(rec);
    expect(moveWord(rec, 0, 99, w)).toBe(rec);
  });
});
