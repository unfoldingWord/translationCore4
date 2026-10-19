// #796 slice 1 — timing for the word list the Align editor now uses.
//
// Opt-in: it reads the rig's cached en_ult v91 export. Run with
//   TC4_ALIGN_BENCH=1 npx vitest run test/align-bench.test.ts
// Genesis is read from the zip and made plain with `cleanAlignmentMarkersFromString`
// on each verse slot, as a drafted book is stored (I-1). It measures:
//   1. one edit on the longest verse: the record pipeline after the mutation
//      (median of 200 runs);
//   2. the open of that verse: its words, and the bootstrap built on them
//      (median of 200 runs);
//   3. the Align rail, `alignIndexItems`, with 10 records and with one record per
//      verse (5 cold runs each; a run is cold when the book text is new), and the
//      warm rebuild of the same two files on a book text the memo already holds
//      (#796 slice 3: the rail reads the words of a vouching record, once per verse).
// The numbers of the base (463cbf9, before this slice) are in BASE. The slice must
// stay within 1.2 times the base edit. The open and rail numbers are reported, not
// asserted: slice 1 did not change the rail's work (it still hashed each verse's slot
// once), so no second pipeline existed to compare it with in the same run, and a number
// measured in another session varies from run to run on the same code. Slice 3 makes one
// word list per vouching record, once per verse, on a cold rail build; the warm rebuild
// stays on the slot memo. Its numbers were taken against the slice 1 head, in the same
// session, one run of each in turn.
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { bootstrapVerse, finalizeEdit, linkWord } from '../src/data/align/edit';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { wordTokens } from '../src/data/align/tokenize';
import { usfmjs } from '../src/data/vendor';
import { decompose, recompose } from '../journal/skeleton.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { __alignIndexItemsForTests as alignIndexItems } from '../src/state.jsx';
import { UsfmFileConversionHelpers } from 'word-aligner-lib';
import { weaveBook } from '../src/data/export/weave.mjs';
import { AlignmentHelpers } from '../src/data/vendor';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const RUN = process.env.TC4_ALIGN_BENCH === '1';
const ZIP = process.env.TC4_ULT_ZIP ?? path.resolve(process.cwd(), 'dev-env/resources-cache/en_ult-v91-unwrapped.zip');

/** Milliseconds measured at the base, 463cbf9: the median of four runs on the longest
 * verse of Genesis (24:14). The rail runs ranged 9.4-11.8 and 16.7-17.4 ms (reported
 * below, not asserted). The base ran `wordTokens` over the plain slot as it is stored,
 * so its 63 words held the two marker names `ts` and `p` that the slot ends with
 * (`\ts\*` and `\p`); `verseWords` parses first and counts 61. The edit gain is the
 * old per-card re-tokenization, not those two words. */
const BASE = { edit: 2.93, openWords: 0.093, openBootstrap: 0.39 };

const clean = (slot: string): string => UsfmFileConversionHelpers.cleanAlignmentMarkersFromString(slot);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (fn: () => void, runs: number): number => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
};

type VO = { tag?: string; type?: string; text?: string; content?: string; strong?: string; lemma?: string; morph?: string; occurrence?: string | number; occurrences?: string | number; children?: VO[] };

/** The original-language words of an aligned verse, from its `\zaln` milestones. */
const origOf = (alignedSlot: string): Array<Record<string, unknown>> => {
  const objects = (usfmjs.toJSON(`\\v 1 ${alignedSlot}`, { chunk: true }) as unknown as { verses: Record<string, { verseObjects: VO[] }> }).verses['1'].verseObjects;
  const out: Array<Record<string, unknown>> = [];
  const walk = (list: VO[]) => {
    for (const o of list) {
      if (o.tag === 'zaln' || (o.type === 'milestone' && o.content)) {
        out.push({ tag: 'w', type: 'word', text: o.content, strong: o.strong, lemma: o.lemma, morph: o.morph, occurrence: o.occurrence, occurrences: o.occurrences });
      }
      if (o.children) walk(o.children);
    }
  };
  walk(objects);
  return out;
};

describe.skipIf(!RUN)('#796 bench — Genesis, en_ult v91', () => {
  it('measures the edit, the open and the rail', () => {
    const raw = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(ZIP)))['ingredients/GEN.usfm']);
    const { skeleton, verses: stored } = decompose(toNfc(raw) as string) as { skeleton: string; verses: Record<string, string> };
    const plainSlots: Record<string, string> = Object.fromEntries(Object.entries(stored).map(([k, s]) => [k, clean(s)]));
    const book = recompose(skeleton, plainSlots) as string;
    const refs = Object.keys(plainSlots).filter((k) => !k.startsWith('0:') && wordTokens(plainSlots[k]).length > 0);

    // 1 and 2 — the longest verse.
    const longest = refs.reduce((best, r) => (wordTokens(plainSlots[r]).length > wordTokens(plainSlots[best]).length ? r : best));
    const slot = plainSlots[longest];
    const md5 = verseTextMd5(slot) as string;
    const orig = origOf(stored[longest]);
    const words = verseWords(slot); // what the session holds as `words`
    const wordCount = words.length;

    let record = bootstrapVerse(words, orig, 'dcs::unfoldingWord/hbo_uhb@v0.0.0', md5);
    record.wordBank.forEach((w, i) => {
      if (i % 3 === 0) record = linkWord(record, i % record.alignments.length, w);
    });
    const banked = record.wordBank[0] as AlignedWord;
    const next: AlignmentVerseRecord = linkWord(record, 0, banked);
    expect(next).not.toBe(record);

    const edit = time(() => { finalizeEdit(next, words, md5); }, 200);
    const openWords = time(() => { verseWords(slot); }, 200);
    const openBootstrap = time(() => { bootstrapVerse(verseWords(slot), orig, 'dcs::unfoldingWord/hbo_uhb@v0.0.0', md5); }, 200);

    // 3 — the rail.
    const recordFor = (ref: string): AlignmentVerseRecord => {
      // The verse's own words, as a record saved since #796 holds them, so that a record matches its verse.
      const words = verseWords(plainSlots[ref]).map((w) => ({ word: w.word, occurrence: w.occurrence, occurrences: w.occurrences }));
      return {
        alignments: [{ topWords: [], bottomWords: words.slice(0, 1) }], wordBank: words.slice(1), invalid: false,
        targetVerseMd5: verseTextMd5(plainSlots[ref]) as string, sourceVersion: 'dcs::unfoldingWord/hbo_uhb@v0.0.0',
      };
    };
    const fileFor = (list: string[]): AlignmentFile => {
      const chapters: AlignmentFile['chapters'] = {};
      for (const ref of list) {
        const [c, v] = ref.split(':');
        (chapters[c] ??= {})[v] = recordFor(ref);
      }
      return { schemaVersion: 1, book: 'GEN', chapters };
    };
    const rail = (file: AlignmentFile) => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const cold = book.replace('\\id GEN', `\\id GEN cold${i}`);
        const t0 = performance.now();
        alignIndexItems(cold, file);
        samples.push(performance.now() - t0);
      }
      return median(samples);
    };
    // One string for every warm run: the slot memo compares the book text with `!==`, which is a
    // pointer check for the same string and a full compare of 1.5 MB for an equal copy. The
    // app holds one `bookRaw` string, so a copy per measure would time the compare, not the memo.
    const warm = book.replace('\\id GEN', '\\id GEN warm');
    const railWarm = (file: AlignmentFile) => {
      alignIndexItems(warm, file); // fills the slot memo
      return time(() => { alignIndexItems(warm, file); }, 5);
    };
    const file10 = fileFor(refs.slice(0, 10));
    const fileAll = fileFor(refs);
    const rail10 = rail(file10);
    const railAll = rail(fileAll);
    const warm10 = railWarm(file10);
    const warmAll = railWarm(fileAll);

    const fixed = (n: number) => n.toFixed(3);
    console.log(
      `[align bench] verse ${longest} (${wordCount} words): edit ${fixed(edit)} ms, open words ${fixed(openWords)} ms, open bootstrap ${fixed(openBootstrap)} ms; ` +
        `rail 10 records ${fixed(rail10)} ms, rail ${refs.length} records ${fixed(railAll)} ms; ` +
        `warm rail 10 records ${fixed(warm10)} ms, warm rail ${refs.length} records ${fixed(warmAll)} ms`,
    );
    expect(edit).toBeLessThanOrEqual(BASE.edit * 1.2);
  }, 30 * 60 * 1000);

  // #796 slice 5 — the aligned export of the whole book: one record per verse (the rail's `recordFor`
  // shape: one placed word each, on one card that holds one source word; a card with no source
  // word makes `merge` throw, so every verse would be refused). Reported, not asserted. The same case ran on the
  // base (weave.mjs read only the flag and the hash) and on the branch (it asks `needsReview` too);
  // the base ignores the fourth argument, so `reported` counts only on the branch. Median of 3
  // weaves of the 1.5 MB book, each run in turn in one session (267a147, the slice 3 head, vs the
  // slice 5 branch): the base 3635, 3272, 2605 and 2709 ms; the branch 2667, 2675 and 2675 ms. All
  // 1533 verses weave on both, none reported. If the line does not print, add --disable-console-intercept.
  it('measures weaveBook on Genesis, one record per verse', () => {
    const raw = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(ZIP)))['ingredients/GEN.usfm']);
    const { skeleton, verses: stored } = decompose(toNfc(raw) as string) as { skeleton: string; verses: Record<string, string> };
    const plainSlots: Record<string, string> = Object.fromEntries(Object.entries(stored).map(([k, s]) => [k, clean(s)]));
    const book = recompose(skeleton, plainSlots) as string;
    const refs = Object.keys(plainSlots).filter((k) => !k.startsWith('0:') && wordTokens(plainSlots[k]).length > 0);
    const TOP: AlignedWord = { word: 'בְּ', strong: 'H9003', lemma: 'בְּ', morph: 'He,R', occurrence: 1, occurrences: 1 };
    const chapters: AlignmentFile['chapters'] = {};
    for (const ref of refs) {
      const [c, v] = ref.split(':');
      const words = verseWords(plainSlots[ref]).map((w) => ({ word: w.word, occurrence: w.occurrence, occurrences: w.occurrences }));
      (chapters[c] ??= {})[v] = {
        alignments: [{ topWords: [TOP], bottomWords: words.slice(0, 1) }], wordBank: words.slice(1), invalid: false,
        targetVerseMd5: verseTextMd5(plainSlots[ref]) as string, sourceVersion: 'dcs::unfoldingWord/hbo_uhb@v0.0.0',
      };
    }
    const file: AlignmentFile = { schemaVersion: 1, book: 'GEN', chapters };
    const reasons: Record<string, number> = {};
    const report = (skip: { reason: string }) => { reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1; };
    let out = '';
    const ms = time(() => { out = weaveBook(book, file, AlignmentHelpers, report) as string; }, 3);
    const outVerses = decompose(out).verses as Record<string, string>;
    const woven = refs.filter((r) => outVerses[r] !== plainSlots[r]).length;
    console.log(`[align bench] weaveBook GEN: ${refs.length} records, ${ms.toFixed(0)} ms (median of 3), ${woven} woven, reported ${JSON.stringify(reasons)}`);
    expect(woven).toBeGreaterThan(0);
  }, 30 * 60 * 1000);
});
