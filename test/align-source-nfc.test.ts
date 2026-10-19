// #793 — alignment source words are NFC, everywhere (D109).
//
// A saved record holds NFC words: the journal seal makes every content string
// NFC (I-4). The Hebrew of hbo_uhb is not NFC. A verse that was never saved
// used to get its source words as the resource has them, so the same verse had
// two spellings of one word, and the suggestion engine (which keys its memory
// by exact text) was trained on one and asked about the other. Inputs are the
// pinned resource's own Jonah (test/fixtures/README.md).
//
// The ways this can fail, written before the fix:
//   1. A fresh bootstrap holds a word the seal would change (the reported defect).
//   2. The engine's memory, trained on saved verses, has no key for a fresh
//      verse's word that the memory does hold (the suggestion miss).
//   3. The fix normalizes too much: a word that is already NFC changes, or a
//      field that is not text (`strong`, `morph`, an occurrence) changes.
//   4. The test misses the window: Jonah has no non-NFC word, so 1 cannot show.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usfmjs } from '../src/data/vendor';
import { md5Hex } from '../src/data/httpStore';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { linksFor, sessionInputFor, trainingVerseOf } from '../src/data/align/suggest';
import { predictLinks, trainModel } from '../src/data/align/suggestEngine';
import { normalizeEvent } from '../src/data/journal/runtime';
import type { AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

// Real node builtins via the runtime (see align-tokenize.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SOURCE = 'dcs::unfoldingWord/hbo_uhb@v3.0.0';
type Verse = { verseObjects: Array<Record<string, unknown>> };
const jonah = (usfmjs.toJSON(fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/hbo_uhb/JON.usfm'), 'utf8')) as unknown as {
  chapters: Record<string, Record<string, Verse>>;
}).chapters;
const verseObjects = (ch: string, v: string) => jonah[ch][v].verseObjects;

// The event shape journalingStore.alignmentEvents publishes, sealed as the journal seals it.
const seal = (record: AlignmentVerseRecord): AlignmentVerseRecord =>
  normalizeEvent({
    v: 1, op: 'align.verse.set', actor: 'test-actor', ts: '', base: null, generation: '',
    book: 'JON', chapter: '1', verse: '1', ...record,
  } as never) as unknown as AlignmentVerseRecord;

const topWordsOf = (r: AlignmentVerseRecord) => r.alignments.flatMap((a) => a.topWords);

// Every Jonah verse, with a one-word draft: the source side is what these tests read.
const verseKeys = Object.entries(jonah).flatMap(([ch, vs]) => Object.keys(vs).filter((v) => /^\d/.test(v)).map((v) => [ch, v] as const));

describe('#793 source words of a fresh bootstrap equal those of the saved verse', () => {
  it('the resource holds many non-NFC words of Jonah, so the comparison can fail (failure mode 4)', () => {
    const words = verseKeys.flatMap(([ch, v]) => verseObjects(ch, v).filter((o) => o.tag === 'w').map((o) => o.text as string));
    expect(words.length).toBeGreaterThan(600);
    expect(words.filter((w) => w !== w.normalize('NFC')).length).toBeGreaterThan(200);
  });

  it('every Jonah verse: the fresh source words are the sealed source words, field for field (failure modes 1 and 3)', () => {
    for (const [ch, v] of verseKeys) {
      const fresh = bootstrapVerse('draft', verseObjects(ch, v), SOURCE, md5Hex('draft'));
      const sealed = seal(fresh);
      expect(topWordsOf(fresh), `JON ${ch}:${v}`).toEqual(topWordsOf(sealed));
    }
  });

  it('a word that is already NFC, and every non-text field, is left as it is (failure mode 3)', () => {
    const [ch, v] = verseKeys[0];
    const objects = verseObjects(ch, v);
    const fresh = topWordsOf(bootstrapVerse('draft', objects, SOURCE, md5Hex('draft')));
    const original = objects.filter((o) => o.tag === 'w') as Array<{ text: string; lemma: string; strong: string; morph: string }>;
    expect(fresh.length).toBe(original.length);
    fresh.forEach((w, i) => {
      expect(w.word).toBe(original[i].text.normalize('NFC'));
      expect(w.lemma).toBe(original[i].lemma.normalize('NFC'));
      expect(w.strong).toBe(original[i].strong);
      expect(w.morph).toBe(original[i].morph);
      expect(typeof w.occurrence).toBe('number');
      expect(typeof w.occurrences).toBe('number');
    });
  });
});

describe('#793 suggestion memory trained on saved verses finds a fresh verse\'s words', () => {
  // One English-free target: each Hebrew word (in NFC) gets one invented gloss, so
  // a correct suggestion is known without any translation. Verse text = its glosses.
  const gloss = new Map<string, string>();
  // Letters only: the target tokenizer splits a letter from a digit.
  const letters = (n: number): string => (n < 26 ? '' : letters(Math.floor(n / 26) - 1)) + String.fromCharCode(97 + (n % 26));
  const glossOf = (word: string) => {
    const key = word.normalize('NFC');
    if (!gloss.has(key)) gloss.set(key, `gloss${letters(gloss.size)}`);
    return gloss.get(key) as string;
  };
  const draftOf = (ch: string, v: string) =>
    topWordsOf(bootstrapVerse('draft', verseObjects(ch, v), SOURCE, md5Hex('draft'))).map((w) => glossOf(w.word)).join(' ');
  const alignedAndSealed = (ch: string, v: string) => {
    const text = draftOf(ch, v);
    let r = bootstrapVerse(text, verseObjects(ch, v), SOURCE, md5Hex(text));
    r.alignments.forEach((a, i) => {
      const word = r.wordBank.find((b) => b.word === glossOf(a.topWords[0].word)) as AlignedWord;
      if (word) r = linkWord(r, i, word);
    });
    return { text, record: seal(stampTargetVerse(r, md5Hex(text))) };
  };

  const TRAIN = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const FRESH = '9';
  const training = TRAIN.map((v) => {
    const { text, record } = alignedAndSealed('1', v);
    return trainingVerseOf(`JON 1:${v}`, record, text);
  }).filter((t): t is NonNullable<typeof t> => t !== null);
  const freshText = draftOf('1', FRESH);
  const fresh = bootstrapVerse(freshText, verseObjects('1', FRESH), SOURCE, md5Hex(freshText));

  // The Math.random seed of align-suggest.test.ts: the booster is stochastic by design.
  beforeEach(() => {
    let a = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  // The words the memory holds and the fresh verse asks about, by their NFC form.
  const trained = new Set(training.flatMap((t) => t.source.map((s) => s.text.normalize('NFC'))));
  const shared = sessionInputFor(fresh, freshText).source.filter((s) => trained.has(s.text.normalize('NFC')));

  it('the fixture verses share words that the resource holds as non-NFC (failure mode 4)', () => {
    expect(training.length).toBe(TRAIN.length);
    const inResource = verseObjects('1', FRESH).filter((o) => o.tag === 'w').map((o) => o.text as string);
    expect(inResource.filter((w) => trained.has(w.normalize('NFC')) && w !== w.normalize('NFC'))).not.toEqual([]);
  });

  it('every shared word is a key of the memory, spelled the same', () => {
    const keys = new Set(training.flatMap((t) => t.source.map((s) => s.text)));
    expect(shared.filter((s) => !keys.has(s.text)).map((s) => s.text.normalize('NFC'))).toEqual([]);
  });

  it('the engine answers a fresh verse as it answers the same verse after a save, and right', async () => {
    const model = await trainModel('ot', training);
    const asked = predictLinks(model, sessionInputFor(fresh, freshText));
    const askedSaved = predictLinks(model, sessionInputFor(seal(fresh), freshText));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked).toEqual(askedSaved);
    const links = linksFor(fresh, freshText, asked);
    expect(links.filter((l) => l.word.word !== glossOf(l.source.word))).toEqual([]);
  }, 120_000); // training is CPU work: about 3 s alone, 15 s when the whole suite runs in parallel
});
