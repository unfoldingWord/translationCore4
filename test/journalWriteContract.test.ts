// Issue #79 — the client write-contract test (owner-confirmed scope,
// 2026-08-24). §8.1 says "Journals are permanent history. There is no
// compaction, rewriting, or pruning in v: 1." The tC4 client never touches the
// disk itself: writeJournalFile → ServerApi.writeIngredient is one whole-file
// HTTP POST per segment (src/data/journal/journalStore.ts, keepBak: false), and
// the on-disk syscalls live in pankosmia-web (Rust, upstream). So the
// immutability guarantee tC4 can prove is the WRITER'S contract, asserted by
// spying the ServerApi across a batch of ordinary mutations:
//   - each segment path (checking/journal/<actor>/segments/…) is POSTed
//     exactly once — no path written twice in the run;
//   - every segment write goes to a FRESH path — never one already present on
//     the server at the moment of the write;
//   - no segment path is ever routed through deleteIngredient, and no second,
//     DIFFERING write is issued to an accepted segment path;
//   - idempotent replay of a torn/absent segment to the SAME bytes is allowed
//     (R-8.1.5/R-8.1.8) and must not trip the contract.
// Server byte-stability is out of scope here — J20/J23b in the conformance
// journal suite already prove committed segment bytes stay untouched.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment } from '../src/data/journal/seal';
import type { Decision, ResourcesFile } from '../src/data/burritoStore';
import { md5Hex } from '../src/data/httpStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';

const TIT_USFM = (v2: string): string =>
  [
    '\\id TIT prueba',
    '\\h Tito',
    '\\mt Tito',
    '\\c 1',
    '\\p',
    '\\v 1 Pablo, siervo de Dios.',
    `\\v 2 ${v2}`,
    '',
  ].join('\n');

// D58: a §5.3 pin carries its sha identity; same fixture derivation as the
// sibling journaling suites.
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};
const PIN = (repo: string, version: string, flavor: string) => ({
  sha: sha40(`${repo}@${version}`),
  repoPath: `git.door43.org/unfoldingWord/${repo}`,
  version,
  flavor,
});
const RUNG = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: PIN('en_tn', 'v86', 'parascriptural/x-bcvnotes'),
  translationWordsLinks: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationWords: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationAcademy: PIN('en_ta', 'v86', 'peripheral/x-peripheralArticles'),
};
const PINS: ResourcesFile = {
  schemaVersion: 2,
  languageSets: { primary: { ...RUNG }, fallback: { ...RUNG } },
} as unknown as ResourcesFile;

const RESOLUTION = {
  repoPath: 'git.door43.org/unfoldingWord/en_tw',
  version: 'v87',
  sha: sha40('en_tw@v87'),
  languageSet: 'fallback',
};

const decisionOf = (checkId: string): Decision =>
  ({
    contextId: {
      checkId,
      occurrenceNote: '',
      reference: { bookId: 'tit', chapter: 1, verse: 1 },
      tool: 'translationWords',
      groupId: 'god',
      quote: 'Θεοῦ',
      quoteString: 'Θεοῦ',
      glQuote: '',
      occurrence: 1,
    },
    category: 'kt',
    selections: false,
    comments: false,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
    modifiedTimestamp: '2026-08-24T12:00:00.000Z',
  }) as unknown as Decision;

const alignmentFileFor = (verseText: string) => ({
  schemaVersion: 1,
  book: 'TIT',
  chapters: {
    '1': {
      '1': {
        alignments: [
          {
            topWords: [
              { word: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N,,,,,NMS,', occurrence: 1, occurrences: 1 },
            ],
            bottomWords: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }],
          },
        ],
        wordBank: [],
        targetVerseMd5: md5Hex(verseText),
        sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
      },
    },
  },
});

// ---------------------------------------------------------------------------
// The ServerApi spy and the contract checker
// ---------------------------------------------------------------------------
const SEGMENT_RE = /^checking\/journal\/[a-z0-9-]+\/segments\/[^/]+$/;

interface RecordedWrite {
  repo: string;
  ipath: string;
  payload: string;
  /** The server's bytes at this path AT THE MOMENT of the write (undefined =
   * the path was free — a fresh path). Read from the rig before delegating. */
  prior: string | undefined;
}
interface RecordedDelete {
  repo: string;
  ipath: string;
}

/** Instrument one ServerApi instance: every writeIngredient/deleteIngredient
 * call is recorded (with the server's prior bytes for writes), then delegated
 * unchanged. The spy sits on the exact surface journalStore.writeJournalFile
 * uses — nothing in src/ is stubbed. */
const spyApi = (
  api: ServerApi,
  rig: JournalingRig,
): { writes: RecordedWrite[]; deletes: RecordedDelete[] } => {
  const writes: RecordedWrite[] = [];
  const deletes: RecordedDelete[] = [];
  const origWrite = api.writeIngredient.bind(api);
  const origDelete = api.deleteIngredient.bind(api);
  (api as { writeIngredient: ServerApi['writeIngredient'] }).writeIngredient = async (
    repo,
    ipath,
    payload,
    opts,
  ) => {
    writes.push({ repo, ipath, payload, prior: rig.repos.get(repo)?.files.get(ipath) });
    return origWrite(repo, ipath, payload, opts);
  };
  (api as { deleteIngredient: ServerApi['deleteIngredient'] }).deleteIngredient = async (
    repo,
    ipath,
  ) => {
    deletes.push({ repo, ipath });
    return origDelete(repo, ipath);
  };
  return { writes, deletes };
};

/** The §8.1 client write-contract over a recorded run. A violation is:
 *   - any journal path routed through deleteIngredient;
 *   - a second, DIFFERING write to a segment path whose existing bytes are a
 *     VALID (= accepted) segment.
 * NOT a violation (the two sanctioned replay branches):
 *   - a byte-identical rewrite (R-8.1.5 idempotent accept);
 *   - replacing INVALID (torn) bytes with the exact staged bytes (R-8.1.8). */
const contractViolations = async (
  writes: RecordedWrite[],
  deletes: RecordedDelete[],
): Promise<string[]> => {
  const violations: string[] = [];
  for (const d of deletes)
    if (d.ipath.startsWith('checking/journal/'))
      violations.push(`journal path routed through deleteIngredient: ${d.ipath}`);
  for (const w of writes) {
    if (!SEGMENT_RE.test(w.ipath)) continue;
    if (w.prior === undefined) continue; // fresh path
    if (w.prior === w.payload) continue; // R-8.1.5 idempotent replay
    if ((await validateSegment(w.prior)).ok)
      violations.push(`second, differing write to accepted segment ${w.ipath}`);
    // differing bytes over an INVALID prior = the R-8.1.8 torn-segment
    // republish — allowed, and exercised by the replay test below.
  }
  return violations;
};

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-08-24T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const spy = spyApi(api, rig);
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  return { rig, kv, api, store, spy };
};

const segmentWrites = (writes: RecordedWrite[]): RecordedWrite[] =>
  writes.filter((w) => SEGMENT_RE.test(w.ipath));

/** The ordinary-mutation batch from the acceptance criterion: a create, a few
 * verse edits, an alignment write, a decision write. */
const runBatch = async (store: JournalingStore): Promise<void> => {
  await store.createProject({
    content_name: 'Prueba',
    content_abbr: 'prueba',
    content_language_code: 'es',
    add_book: false,
    versification: 'eng',
  });
  await store.writeResources(PINS, null);
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr' });
  await store.addBook({
    book_code: 'TIT',
    book_title: 'Tito',
    book_abbr: 'TIT',
    add_cv: true,
    initialUsfm: TIT_USFM('___'),
  });
  await store.writeBook('TIT', TIT_USFM('Primera edición.'));
  await store.writeBook('TIT', TIT_USFM('Segunda edición.'));
  await store.writeAlignments('TIT', alignmentFileFor('Pablo, siervo de Dios.') as never);
  await store.upsertDecision('translationWords', 'TIT', decisionOf('contract-check'), RESOLUTION);
};

describe('issue #79: the journal writer client write-contract', () => {
  // AGENTS.md negative control: prove the spy and the checker actually see a
  // violation before trusting their silence. The rig is deliberately abused
  // THROUGH the spied ServerApi — both prohibited operations must be flagged.
  it('negative control: the checker flags a differing overwrite and a delete of an accepted segment', async () => {
    const { rig, store, spy } = await setup();
    await runBatch(store);
    const accepted = segmentWrites(spy.writes).map((w) => w.ipath);
    expect(accepted.length).toBeGreaterThan(0);
    const target = accepted[0];
    // A compaction-shaped abuse: rewrite an accepted segment with different
    // bytes, then delete another one — exactly what the writer must never do.
    const api2 = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const abuse = spyApi(api2, rig);
    await api2.writeIngredient(REPO, target, '{"container":1,"body":"{}","sha256":"not-it"}', {
      updateIngredients: false,
      keepBak: false,
    });
    await api2.deleteIngredient(REPO, accepted[accepted.length - 1]);
    const violations = await contractViolations(abuse.writes, abuse.deletes);
    expect(violations.some((v) => v.includes('differing write to accepted segment'))).toBe(true);
    expect(violations.some((v) => v.includes('routed through deleteIngredient'))).toBe(true);
  });

  it('a batch of ordinary mutations POSTs each segment exactly once, always to a fresh path, and never deletes one', async () => {
    const { store, spy } = await setup();
    await runBatch(store);

    const segs = segmentWrites(spy.writes);
    // Vacuity floor: the batch really journaled, and every mutation kind in
    // the criterion (create, verse edit, alignment, decision, plus the pins
    // and settings writes) published its op.
    const ops = new Set<string>();
    for (const w of segs) {
      const verdict = await validateSegment(w.payload);
      expect(verdict.ok, `the writer POSTed an invalid segment to ${w.ipath}`).toBe(true);
      if (verdict.ok) for (const event of verdict.events) ops.add(event.op);
    }
    for (const op of [
      'book.add',
      'text.verse.set',
      'align.verse.set',
      'check.decision.set',
      'resource.pin.set',
      'settings.set',
    ])
      expect([...ops], `no segment carries ${op}`).toContain(op);

    // Each segment path exactly once — no path written twice in the run.
    const paths = segs.map((w) => w.ipath);
    expect(new Set(paths).size, `a segment path was written twice: ${paths.join(', ')}`).toBe(
      paths.length,
    );
    // Always a fresh path — never one already present on the server.
    for (const w of segs)
      expect(w.prior, `segment write to a path already on the server: ${w.ipath}`).toBeUndefined();
    // No deleteIngredient of any journal path, no differing rewrite.
    expect(await contractViolations(spy.writes, spy.deletes)).toEqual([]);
    // The batch issued no journal deletes at all (the writer has no delete
    // operation for journal files — only derived sidecars may ever be removed).
    expect(spy.deletes.filter((d) => d.ipath.startsWith('checking/journal/'))).toEqual([]);
  });

  it('idempotent replay of a torn segment republishes the SAME bytes and does not trip the contract', async () => {
    const { rig, kv, store, spy } = await setup();
    await runBatch(store);

    // Lose the publish RESPONSE of the next edit: the segment lands on the
    // server, but the stage-key delete after the confirmed accept fails, so
    // the staged intent survives (same window as the round-6 B1 regression).
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (key: string): Promise<void> => {
      if (lostResponses > 0 && key.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(key);
    };
    await expect(store.writeBook('TIT', TIT_USFM('Vida torn.'))).rejects.toThrow(/lost response/);

    // Now TEAR the published segment on the server: truncated bytes under the
    // perfect filename (the R-8.1.8 recovery precondition).
    const files = rig.repos.get(REPO)!.files;
    const tornPath = [...files.keys()].find(
      (p) => SEGMENT_RE.test(p) && (files.get(p) ?? '').includes('Vida torn.'),
    );
    expect(tornPath).toBeDefined();
    const sealed = files.get(tornPath!)!;
    files.set(tornPath!, sealed.slice(0, Math.floor(sealed.length / 2)));

    // The user retries the same save. replay-before-diff republishes the EXACT
    // staged bytes onto the torn path, then the diff finds nothing new.
    const before = segmentWrites(spy.writes).length;
    await store.writeBook('TIT', TIT_USFM('Vida torn.'));

    const replays = segmentWrites(spy.writes)
      .slice(before)
      .filter((w) => w.ipath === tornPath);
    expect(replays, 'the torn segment must be republished exactly once').toHaveLength(1);
    // The replay wrote the EXACT originally sealed bytes over the torn prior.
    expect(replays[0].payload).toBe(sealed);
    expect(replays[0].prior).not.toBe(sealed); // it really was torn at write time
    // …and the contract holds: a torn-bytes republish is the sanctioned
    // R-8.1.8 branch, not a differing write to an ACCEPTED segment.
    expect(await contractViolations(spy.writes, spy.deletes)).toEqual([]);
    // No OTHER segment path was written twice across the whole run.
    const paths = segmentWrites(spy.writes).map((w) => w.ipath);
    const duplicated = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(duplicated).toEqual([tornPath]);
  });
});
