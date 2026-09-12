// #134 — a verse's alignment record is read under the PROJECT-frame reference,
// the key it is written under.
//
// The §5.1 sidecar is keyed by the draft's chapter:verse (project frame).
// Mapping that reference into the eng frame is a LOOKUP for the original-
// language text, never the record's identity (test/alignmentFrame.test.ts).
// The save path (applyAlignEdit → spliceAlignRecord) writes under the project
// ref. The read in buildAlignmentSession went through an object NAMED `mapped`
// whose chapter/verse were in fact the project-frame parts — correct, but read
// as the eng key by a source review (#134). This suite pins the round trip so
// the key can never drift to the mapped reference, and the session build now
// takes only the project ref.
//
// The project frame and the verse come from the versification fixtures: rsc
// ends Jonah 1 at verse 16 where eng has 17, so rsc JON 2:1 is eng JON 1:17.
// The original-language verse objects are the pinned Hebrew Jonah fixture.
import { describe, expect, it } from 'vitest';
import { mapReference } from '../src/data/mapReference';
import { RESOURCE_FRAME } from '../src/data/projectFrame';
import { usfmjs } from '../src/data/vendor';
import { SCHEME_NAMES, type SchemeDoc, type SchemeName } from '../src/data/versification';
import { __alignSaveForTests, __buildAlignmentSessionForTests, alignFileJson } from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const schemes = Object.fromEntries(
  SCHEME_NAMES.map((n) => [n, JSON.parse(fs.readFileSync(path.join(FIXTURES, 'vrs', `${n}.json`), 'utf8')) as SchemeDoc]),
) as Record<SchemeName, SchemeDoc>;

const { spliceAlignRecord } = __alignSaveForTests;
const buildAlignmentSession = __buildAlignmentSessionForTests;

const PROJECT_FRAME: SchemeName = 'rsc';
const BOOK = 'JON';
const REF = '2:1'; // the project-frame draft reference the translator aligns

/** A store with the platform's compare-and-swap over one alignment file. */
const makeStore = () => {
  let file: { schemaVersion: number; book: string; chapters: Record<string, Record<string, unknown>> } | null = null;
  let md5: string | null = null;
  let writes = 0;
  return {
    get file() {
      return file;
    },
    readAlignmentsWithMd5: async () => ({ value: file, md5 }),
    writeAlignments: async (_book: string, data: typeof file, expectMd5?: string | null) => {
      if ((expectMd5 ?? null) !== md5) throw new Error(`stale write: expected ${expectMd5}, disk ${md5}`);
      file = data;
      md5 = `md5-${++writes}`;
    },
  };
};

/** The draft: an rsc-framed Jonah whose chapter 2 opens with the fish verse. */
const bookRaw = ['\\id JON', '\\c 1', '\\p', '\\v 16 ___', '\\c 2', '\\p', '\\v 1 Y Jehová tenía preparado un gran pez que tragase a Jonás.', ''].join(
  '\n',
);

/** eng-framed Hebrew verse objects for the mapped reference (the aligner's input). */
const origObjectsFor = (chapter: number, verse: number | string) => {
  const json = usfmjs.toJSON(fs.readFileSync(path.join(FIXTURES, 'hbo_uhb', 'JON.usfm'), 'utf8')) as {
    chapters: Record<string, Record<string, { verseObjects: Array<Record<string, unknown>> }>>;
  };
  return json.chapters[String(chapter)][String(verse)].verseObjects;
};

const source = { testament: 'ot', pin: { repoPath: 'unfoldingWord/hbo_uhb', version: 'v3.0.0' }, usfmText: '' };
const st = { book: BOOK, bookRaw, project: { scriptDirection: 'ltr' } };

/** What openAlign does before the session build: project ref → source ref. */
const mappedFor = async () => {
  const [chapter, verse] = REF.split(':');
  const out = await mapReference({ from: PROJECT_FRAME, to: RESOURCE_FRAME, book: BOOK, chapter: Number(chapter), verse, schemes });
  if (!out.ok) throw new Error('fixture mapping failed');
  return { chapter, verse, reference: out.reference };
};

describe('#134 — the alignment record round-trips under the project-frame key on a cross-frame project', () => {
  it('the fixtures make the mapped key differ from the project key', async () => {
    const mapped = await mappedFor();
    expect(mapped.reference).toEqual({ book: BOOK, chapter: 1, verse: 17 });
    expect(`${mapped.reference.chapter}:${mapped.reference.verse}`).not.toBe(REF);
  });

  it('save an alignment, rebuild the session, the same record comes back', async () => {
    const mapped = await mappedFor();
    const origObjects = origObjectsFor(mapped.reference.chapter, mapped.reference.verse);
    expect(origObjects.length).toBeGreaterThan(0);
    const store = makeStore();

    // First open: nothing stored, the session bootstraps a record.
    const first = await buildAlignmentSession(store, null, st, REF, source, origObjects);
    expect(first.unavailable).toBeUndefined();
    expect(first.record.wordBank.length).toBeGreaterThan(0);

    // The translator places one word; the save path keys the record by the
    // PROJECT ref, exactly as applyAlignEdit → spliceAlignRecord does.
    const [word, ...rest] = first.record.wordBank;
    const saved = {
      ...first.record,
      alignments: first.record.alignments.map((a: { bottomWords: unknown[] }, i: number) => (i === 0 ? { ...a, bottomWords: [word] } : a)),
      wordBank: rest,
    };
    const [chapter, verse] = REF.split(':');
    const { md5 } = await store.readAlignmentsWithMd5();
    await store.writeAlignments(BOOK, JSON.parse(spliceAlignRecord(alignFileJson(store.file, BOOK), chapter, verse, JSON.stringify(saved))), md5);
    expect(store.file?.chapters[chapter][verse]).toEqual(saved);

    // Reopen: the record read back is the one just written.
    const second = await buildAlignmentSession(store, null, st, REF, source, origObjects);
    expect(second.record).toEqual(saved);
    expect(second.record.wordBank).toHaveLength(first.record.wordBank.length - 1);
  });

  it('negative control: the old read key — the mapped reference — holds nothing for this verse', async () => {
    const mapped = await mappedFor();
    const origObjects = origObjectsFor(mapped.reference.chapter, mapped.reference.verse);
    const store = makeStore();
    const first = await buildAlignmentSession(store, null, st, REF, source, origObjects);
    const [chapter, verse] = REF.split(':');
    const { md5 } = await store.readAlignmentsWithMd5();
    await store.writeAlignments(BOOK, JSON.parse(spliceAlignRecord(alignFileJson(store.file, BOOK), chapter, verse, JSON.stringify(first.record))), md5);
    // The file has the record under 2:1 and nothing under the eng key 1:17 —
    // reading under the mapped key would have bootstrapped afresh and shown
    // the translator an empty alignment.
    expect(store.file?.chapters[String(mapped.reference.chapter)]?.[String(mapped.reference.verse)]).toBeUndefined();
    expect(store.file?.chapters[chapter][verse]).toEqual(first.record);
  });
});
