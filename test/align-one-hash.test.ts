// #795 — the client stamps a verse with the hash the export checks.
//
// The §5.1 record keeps `targetVerseMd5` (I-3). The fold and the aligned export
// compare it with `verseTextMd5` of the STORED verse slot: the slot the journal
// seal made NFC (journal/fold.mjs, src/data/export/weave.mjs). Before #795 the
// client stamped md5Hex of the display text. Each difference between the two
// made the export drop the verse's alignment with no message.
//
// The ways this can fail, written before the fix:
// 1. A verse with inline `\zaln` (an imported aligned book): the display text
//    reads the aligned words, the fold reads only the top level.
// 2. A `\qs … \qs*` poetry verse that holds a `\w` word: same split.
// 3. Text typed in a non-NFC form: the stamp hashes the raw bytes, the seal
//    stores NFC. After a restart the verse reads "invalid" and does not export.
// 4. The new stamp moves a hash that is right today (a plain NFC draft).
// 5. The #794 guard stops holding once the stamp equals the export hash.
// 6. A verse the book indexer lists but the stored slots do not hold (`\v 1` with
//    its text on the next line) has no export hash: a record stamped for it has
//    no `targetVerseMd5`, the journal refuses to seal it, and the align save of
//    the whole book is stuck.
//
// B3 runs the real save path (JournalingStore over the in-memory rig, the align
// writer, a reload from the projected book), not a hand-built seal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { SaveScheduler } from '../src/data/saveScheduler';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { spliceVerse, verseBody } from '../src/data/usfm/splice';
import { parseChapters, verseText } from '../src/data/bookModel';
import { indexBook } from '../src/data/usfm/indexer';
import { md5Hex } from '../src/data/httpStore';
import { bootstrapVerse, cardsInVerseOrder, linkWord, settleDone, stampTargetVerse } from '../src/data/align/edit';
import { verseTextMd5 } from '../journal/fold.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { decompose } from '../journal/skeleton.mjs';
import { holdsInlineAlignment, weaveBook } from '../src/data/export/weave.mjs';
import { AlignmentHelpers } from '../src/data/vendor';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';
import {
  __alignIndexItemsForTests as alignIndexItems,
  __alignSaveForTests,
  __buildAlignmentSessionForTests as buildAlignmentSession,
  __reflowAlignedVersesForTests as reflowAlignedVerses,
  __slotMd5IndexForTests as slotMd5Index,
  alignFileJson,
} from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;

// ---- the inputs ------------------------------------------------------------

/** Plain drafts that are NFC: a client stamp from the display text was right here. */
const PLAIN = [
  'conformance/sample-burrito/ingredients/TIT.usfm',
  'conformance/sample-burrito/ingredients/JON.usfm',
  'test/fixtures/usfm-corpus/sample-TIT-draft.usfm',
  'test/fixtures/usfm-corpus/sample-JON-span.usfm',
  'test/fixtures/usfm-corpus/exotic-partial-book.usfm',
  'test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm',
];
/** Aligned imports: the stored verse still holds `\zaln` (I-1, #553). */
const INLINE = ['test/fixtures/en_ult/TIT.usfm', 'test/fixtures/en_ult/GEN-1.usfm', 'test/fixtures/en_ust/TIT.usfm'];
const TIT = read('conformance/sample-burrito/ingredients/TIT.usfm');
/** The sample Titus as a keyboard or a paste may leave it: decomposed (NFD). */
const TIT_NFD = TIT.normalize('NFD');
/** A poetry verse whose `\qs` holds a `\w` word, and one with a `\qs` over a `\zaln`. */
const QS_PLAIN =
  '\\id PSA x\n\\c 3\n\\q1\n\\v 1 Jehová, cuán numerosos son mis enemigos\n\\q2 \\qs \\w Selah|x-occurrence="1" x-occurrences="1"\\w*\\qs*\n\\v 2 Muchos dicen de mí\n';
const QS_ZALN =
  '\\id PSA x\n\\c 3\n\\q1\n\\v 1 Jehová, cuán numerosos son mis enemigos\n\\q2 \\qs \\zaln-s |x-strong="H1"\\*\\w Selah|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*\\qs*\n\\v 2 Muchos dicen de mí\n';

/** "chapter:verse" of every drafted verse of a book, as the client indexes them. */
const draftedRefs = (raw: string): string[] =>
  indexBook(raw).flatMap((e) => {
    const body = raw.slice(e.start, e.end).trim();
    return body === '' || body === '___' ? [] : [`${e.chapter}:${e.verseKey}`];
  });

/** The export's own hash of the verse as stored: the journal seal's expression. */
const storedHash = (raw: string, ref: string): string => verseTextMd5((decompose(toNfc(raw)).verses as Record<string, string>)[ref]);

/** Refs whose client stamp differs from the export hash of the stored slot. */
const stampMisses = (raw: string): string[] => {
  const stamps = slotMd5Index(raw) as Record<string, string>;
  return draftedRefs(raw).filter((ref) => stamps[ref] !== storedHash(raw, ref));
};

// ---- B1: one stamp ----------------------------------------------------------

describe('#795 the client stamp is the export hash of the stored slot (B1)', () => {
  it('plain NFC drafts: every drafted verse agrees', () => {
    let compared = 0;
    for (const rel of PLAIN) {
      const raw = read(rel);
      expect(stampMisses(raw), rel).toEqual([]);
      compared += draftedRefs(raw).length;
    }
    expect(compared).toBe(23);
  });

  it('inline-\\zaln imports (way 1): every drafted verse agrees', () => {
    let compared = 0;
    for (const rel of INLINE) {
      const raw = read(rel);
      expect(stampMisses(raw), rel).toEqual([]);
      compared += draftedRefs(raw).length;
    }
    expect(compared).toBeGreaterThan(120);
  });

  it('text typed as NFD (way 3): every drafted verse agrees, and the slot hash is the NFC one', () => {
    expect(TIT_NFD).not.toBe(TIT);
    expect(stampMisses(TIT_NFD)).toEqual([]);
    expect(draftedRefs(TIT_NFD)).toEqual(['1:1', '1:2', '1:3', '1:4', '1:5']);
    // The same verses typed NFC or NFD stamp the same: the stored form is NFC.
    expect(slotMd5Index(TIT_NFD)).toEqual(slotMd5Index(TIT));
  });

  it('a \\qs poetry verse (way 2): agrees with a plain \\w inside it and with a \\zaln over it', () => {
    expect(draftedRefs(QS_PLAIN)).toEqual(['3:1', '3:2']);
    expect(stampMisses(QS_PLAIN)).toEqual([]);
    expect(stampMisses(QS_ZALN)).toEqual([]);
    // Control: the display text of the \qs verse is not what the fold hashes.
    const display = verseText((parseChapters(QS_PLAIN) as Record<string, Record<string, unknown>>)['3']['1']);
    expect(display).toContain('Selah');
    expect(md5Hex(display)).not.toBe(storedHash(QS_PLAIN, '3:1'));
  });

  it('a book with no text has no stamps', () => {
    expect(slotMd5Index('')).toEqual({});
    expect(slotMd5Index(null)).toEqual({});
  });
});

// ---- B2: no stored hash moves -----------------------------------------------

describe('#795 a plain NFC draft stamps what it stamped before (B2)', () => {
  it('the new stamp equals md5Hex of the display text, verse by verse', () => {
    // 1:3 of exotic-poetry-footnotes holds inline \zaln, so it is not a plain draft: its old stamp was wrong.
    const inline = (rel: string, ref: string) => rel.endsWith('exotic-poetry-footnotes.usfm') && ref === '1:3';
    const moved: string[] = [];
    let compared = 0;
    for (const rel of PLAIN) {
      const raw = read(rel);
      const chapters = parseChapters(raw) as Record<string, Record<string, unknown>>;
      const stamps = slotMd5Index(raw) as Record<string, string>;
      for (const e of indexBook(raw)) {
        const ref = `${e.chapter}:${e.verseKey}`;
        if (!draftedRefs(raw).includes(ref) || inline(rel, ref)) continue;
        if (stamps[ref] !== md5Hex(verseText(chapters[e.chapter][e.verseKey]))) moved.push(`${rel} ${ref}`);
        compared++;
      }
    }
    expect(moved).toEqual([]);
    expect(compared).toBe(22);
  });
});

// ---- B3: NFD text, through the real save path --------------------------------

const SAMPLE = JSON.parse(read('conformance/sample-burrito/ingredients/checking/alignments/TIT.json'));
const ORIG = SAMPLE.chapters['1']['1'].alignments.flatMap((a: { topWords: Array<Record<string, unknown>> }) =>
  a.topWords.map((t) => ({ tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph, occurrence: t.occurrence, occurrences: t.occurrences })),
);
const SOURCE = { pin: { repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, testament: 'nt' };
const REAL_1_1 = (verseBody(TIT, 1, '1') as string).trim();
/** Verse 1:1 starts as a stub and the translator types its text. */
const STUB_BOOK = spliceVerse(TIT, 1, '1', '___\n');
const sameNfc = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC');

async function setup() {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-10-17T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: STUB_BOOK });
  const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord, reconcile: () => store.reconcileStaged() });
  return { store, sched };
}

/** What buildAlignmentSession returns for an openable verse. */
type Session = { record: AlignmentVerseRecord; targetText: string; targetMd5: string; stale: boolean };

/** Type verse 1:1, align two words in one session, save, then reload from the projected book. */
async function alignThenReload(typed: string) {
  const { store, sched } = await setup();
  // Translate: the typed bytes go into the in-session book as they are, and the draft is saved.
  let bookRaw = store.projectedBook('TIT') as string;
  bookRaw = spliceVerse(bookRaw, 1, '1', typed);
  await store.writeBook('TIT', bookRaw);
  const typedSession = { book: 'TIT', bookRaw, project: {} };

  // Align: open the verse, place two words (what applyAlignEdit does), save.
  const s1 = (await buildAlignmentSession(store, sched, typedSession, '1:1', SOURCE, ORIG)) as Session;
  const bankWord = (rec: AlignmentVerseRecord, w: string) => rec.wordBank.find((b: AlignedWord) => sameNfc(b.word, w)) as AlignedWord;
  let next = linkWord(s1.record, 0, bankWord(s1.record, 'Pablo'));
  next = linkWord(next, 3, bankWord(next, 'apóstol'));
  const record = settleDone(stampTargetVerse(cardsInVerseOrder(next, s1.targetText), s1.targetMd5));
  sched.markDirty('TIT', '1', '1', JSON.stringify(record));
  await sched.flushOnBlur();

  // Reload: what a reopen reads is the projected book (NFC) and the regenerated §5.1 file.
  const projected = store.projectedBook('TIT') as string;
  const { value: disk } = await store.readAlignmentsWithMd5('TIT');
  const reloaded = { book: 'TIT', bookRaw: projected, project: {} };
  const rail = (alignIndexItems(projected, disk) as Array<{ ref: string; status: string }>).find((i) => i.ref === '1:1');
  const s2 = (await buildAlignmentSession(store, sched, reloaded, '1:1', SOURCE, ORIG)) as Session;
  const woven = weaveBook(projected, disk as AlignmentFile, AlignmentHelpers) as string;
  const wovenVerse = woven.slice(woven.indexOf('\\v 1 '), woven.indexOf('\\v 2 '));
  return {
    // The stamp the session wrote is the hash the saved file holds, and the hash the export computes.
    stampIsExportHash: (disk!.chapters['1']['1'] as AlignmentVerseRecord).targetVerseMd5 === verseTextMd5((decompose(projected).verses as Record<string, string>)['1:1']),
    sessionStampIsSaved: s1.targetMd5 === (disk!.chapters['1']['1'] as AlignmentVerseRecord).targetVerseMd5,
    railStatus: rail?.status,
    reopenStale: s2.stale,
    exportHasZaln: wovenVerse.includes('\\zaln-s'),
  };
}

describe('#795 NFD-typed text, aligned and reloaded through the journal seal (B3)', () => {
  const reads = { stampIsExportHash: true, sessionStampIsSaved: true, railStatus: 'todo', reopenStale: false, exportHasZaln: true };

  it('way 3: the verse reads "todo" after the reload, and the export weaves it', async () => {
    const typed = REAL_1_1.normalize('NFD');
    expect(typed).not.toBe(REAL_1_1);
    expect(await alignThenReload(typed)).toEqual(reads);
  }, 60000);

  it('control: the same verse typed as NFC reads "todo" and weaves too', async () => {
    expect(await alignThenReload(REAL_1_1)).toEqual(reads);
  }, 60000);
});

// ---- B5: the #794 guard still holds ------------------------------------------

describe('#795 a record stamped with the export hash does not replace imported alignment (B5)', () => {
  const EN_ULT = read('test/fixtures/en_ult/TIT.usfm');

  it('en_ult Titus 1:1: the stamp equals the export hash, and the export keeps the imported \\zaln byte for byte', () => {
    const stored = decompose(EN_ULT).verses as Record<string, string>;
    expect(holdsInlineAlignment(stored['1:1'])).toBe(true);
    // The precondition that makes the guard the only thing between the record and the markup.
    const stamp = (slotMd5Index(EN_ULT) as Record<string, string>)['1:1'];
    expect(stamp).toBe(verseTextMd5(stored['1:1']));

    const text = verseText((parseChapters(EN_ULT) as Record<string, Record<string, unknown>>)['1']['1']);
    const orig = [
      { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
      { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
    ];
    let record = bootstrapVerse(text, orig, 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34', stamp);
    record = linkWord(record, 0, record.wordBank.find((w) => w.word === 'Paul') as AlignedWord);
    record = linkWord(record, 1, record.wordBank.find((w) => w.word === 'servant') as AlignedWord);
    record = stampTargetVerse(record, stamp);
    const alignments = { schemaVersion: 2, book: 'TIT', chapters: { '1': { '1': record } } } as unknown as AlignmentFile;
    const out = weaveBook(EN_ULT, alignments, AlignmentHelpers) as string;
    expect((decompose(out).verses as Record<string, string>)['1:1']).toBe(stored['1:1']);
    expect(out).toBe(EN_ULT);
  });
});

// ---- B6: a verse with no stored slot ------------------------------------------

/** 1:1 has its text on the line after its number, which `decompose` does not read as a verse
 * marker (journal/skeleton.mjs needs a space or tab after the key). 1:2 is normal. */
const NO_SLOT = '\\id TIT\n\\c 1\n\\p\n\\v 1\nPablo, siervo de Dios\n\\v 2 Pablo, siervo de Dios\n';

/** A sidecar store that counts reads and writes. */
const countingStore = () => {
  let file: AlignmentFile | null = null;
  let md5: string | null = null;
  const calls = { reads: 0, writes: 0 };
  return {
    calls,
    get file() {
      return file;
    },
    readAlignmentsWithMd5: async () => {
      calls.reads++;
      return { value: file, md5 };
    },
    writeAlignments: async (_book: string, data: AlignmentFile, expectMd5?: string | null) => {
      if ((expectMd5 ?? null) !== md5) throw new Error(`stale write: expected ${expectMd5}, disk ${md5}`);
      calls.writes++;
      file = data;
      md5 = `md5-${calls.writes}`;
    },
    reconcileStaged: async () => {},
  };
};

describe('#795 a verse with no stored slot cannot be stamped, so nothing is written for it (B6)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
  };

  it('precondition: the indexer lists 1:1 and drafts it, but the stored slots hold only 1:2', () => {
    expect(draftedRefs(NO_SLOT)).toEqual(['1:1', '1:2']);
    expect(Object.keys(decompose(toNfc(NO_SLOT)).verses)).toEqual(['1:2']);
    expect(slotMd5Index(NO_SLOT)).toEqual({ '1:2': storedHash(NO_SLOT, '1:2') });
  });

  it('Align refuses 1:1 with "no-slot" and writes nothing; 1:2 opens and is stamped with its slot hash', async () => {
    const store = countingStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    const st = { book: 'TIT', bookRaw: NO_SLOT, project: {} };
    expect(await buildAlignmentSession(store, sched, st, '1:1', SOURCE, ORIG)).toEqual({ unavailable: 'no-slot' });

    const open = (await buildAlignmentSession(store, sched, st, '1:2', SOURCE, ORIG)) as Session & { unavailable?: string };
    expect(open.unavailable).toBeUndefined();
    expect(open.targetMd5).toBe(storedHash(NO_SLOT, '1:2'));
    expect(open.record.targetVerseMd5).toBe(storedHash(NO_SLOT, '1:2'));

    await settle();
    expect(store.calls.writes).toBe(0);
    expect(sched.getState()).toBe('saved');
  });

  it('a draft save of both verses stages nothing for 1:1, and still reflows 1:2', async () => {
    const store = countingStore();
    const old = 'Pablo, siervo de Dios';
    const linked = (): AlignmentVerseRecord => {
      let r = bootstrapVerse(old, ORIG, 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34', md5Hex(old));
      r = linkWord(r, 0, r.wordBank.find((w) => w.word === 'Pablo') as AlignedWord);
      return stampTargetVerse(r, md5Hex(old));
    };
    // Both verses hold a record stamped for the old text; the draft now says "esclavo", so a reflow stages each.
    let json = alignFileJson(null, 'TIT');
    json = spliceAlignRecord(json, '1', '1', JSON.stringify(linked()));
    json = spliceAlignRecord(json, '1', '2', JSON.stringify(linked()));
    await store.writeAlignments('TIT', JSON.parse(json), null);
    const before = JSON.stringify(store.file!.chapters['1']['1']);
    const writesBefore = store.calls.writes;

    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    await reflowAlignedVerses({ store, sched, book: 'TIT', bookRaw: NO_SLOT.replace(/siervo/g, 'esclavo') }, ['1:1', '1:2']);
    await settle();

    // 1:2 is the control: it has a slot, so the reflow restamped it with the slot hash.
    const slot2 = storedHash(NO_SLOT.replace(/siervo/g, 'esclavo'), '1:2');
    expect((store.file!.chapters['1']['2'] as AlignmentVerseRecord).targetVerseMd5).toBe(slot2);
    // 1:1 has no slot: its record keeps its bytes, and nothing carries an undefined stamp.
    expect(JSON.stringify(store.file!.chapters['1']['1'])).toBe(before);
    expect(store.calls.writes - writesBefore).toBe(1);
  });
});
