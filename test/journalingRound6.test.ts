// Round-6 review regressions (antagonistic review, 2026-08-23) — the two
// intent-ledger blockers found before the official #62 review:
//   B1. A retried mutation after a LOST PUBLISH RESPONSE must not re-emit the
//       same edit as a second action: replayOwnStagedBeforeDiff must refresh
//       the fold on 'already-published' (not only 'republished'), and must
//       refuse to mutate over a 'conflict'.
//   B2. Pruning a newer converged intent while an older live record shares a
//       resolution key must not roll the overlay (and then the disk) back to
//       the superseded resolution: the prune may not destroy the supersession
//       information the overlay query depends on.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import type { Decision, DecisionFile, ResourcesFile } from '../src/data/burritoStore';
import { md5Hex } from '../src/data/httpStore';
import {
  FAKE_VRS,
  journalingRig,
  memKv,
  tickingNow,
  type JournalingRig,
} from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';

const TIT_USFM = [
  '\\id TIT prueba',
  '\\h Tito',
  '\\mt Tito',
  '\\c 1',
  '\\p',
  '\\v 1 Pablo, siervo de Dios.',
  '\\v 2 ___',
  '',
].join('\n');

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
// Two SUCCESSIVE resolutions of the same (tool, book) — the B2 rollback pair.
const RES_OLD = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v37',
  sha: sha40('es-419_tw@v37'),
  languageSet: 'primary',
};
const RES_NEW = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v38',
  sha: sha40('es-419_tw@v38'),
  languageSet: 'primary',
};

const decision = (checkId: string, comments: string | false = false): Decision =>
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
    comments,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
    modifiedTimestamp: '2026-08-23T12:00:00.000Z',
  }) as unknown as Decision;

const segmentPaths = (rig: JournalingRig, repo = REPO): string[] =>
  [...(rig.repos.get(repo)?.files.keys() ?? [])]
    .filter((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p))
    .sort();

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-08-23T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
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
    initialUsfm: TIT_USFM,
  });
  const restart = (): JournalingStore => {
    forgetSharedClocks();
    forgetProjectQueues();
    return new JournalingStore({ api, kv, now: () => clock.advance(29) });
  };
  return { rig, api, kv, clock, store, restart };
};

describe('round 6 B1: a retry after a lost publish response is idempotent', () => {
  it('the retried edit is not re-emitted as a second action on the old base', async () => {
    const { rig, api, kv, store, restart } = await setup();
    const EDITED = TIT_USFM.replace('___', 'Nueva vida.');

    // The segment write is ACCEPTED by the server but the response is lost —
    // emulated at the exact same crash window: the stage-key delete after the
    // confirmed accept fails, so publish() throws AFTER the segment landed and
    // BEFORE the in-memory fold learned about it.
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (key: string): Promise<void> => {
      if (lostResponses > 0 && key.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(key);
    };
    await expect(store.writeBook('TIT', EDITED)).rejects.toThrow(/lost response/);

    // The segment IS on the server and the staged intent survived.
    const published = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('Nueva vida.'),
    );
    expect(published).toHaveLength(1);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // The user retries the same save. Replay finds the byte-identical segment
    // ('already-published'), which PROVES the fold is stale — the retry must
    // refresh and diff to nothing, never re-emit the edit on the old base.
    await store.writeBook('TIT', EDITED);
    const republished = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('Nueva vida.'),
    );
    expect(republished, 'the same edit must not be published twice').toHaveLength(1);

    // The project verifies and a reopen converges quietly.
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });
});

describe('official review R1: a derived sidecar is DELETED when its projection disappears', () => {
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

  it('a structural edit that retires the last alignment removes the stale alignment file', async () => {
    const { rig, api, store, restart } = await setup();
    await store.writeAlignments('TIT', alignmentFileFor('Pablo, siervo de Dios.') as never);
    expect(rig.repos.get(REPO)?.files.has('checking/alignments/TIT.json')).toBe(true);

    // Merge 1:1 and 1:2 into the span 1:1-2 — a slot-set change that removes
    // the aligned key. The fold no longer projects any alignment for TIT.
    const edited = TIT_USFM
      .replace('\\v 1 Pablo, siervo de Dios.\n\\v 2 ___', '\\v 1-2 Pablo, siervo de Dios.');
    await store.applyStructuralEdit('TIT', edited);

    // The derived file whose projection disappeared must be GONE — a stale
    // sidecar is an extra derived path every later open/verify refuses.
    expect(rig.repos.get(REPO)?.files.has('checking/alignments/TIT.json')).toBe(false);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });

  it('reconciling an out-of-band TOPOLOGY edit re-converges sidecars that were clean before it', async () => {
    const { rig, api, store, restart } = await setup();
    await store.writeAlignments('TIT', alignmentFileFor('Pablo, siervo de Dios.') as never);

    // Another tool rewrites the committed USFM with a slot-set change while
    // the app is closed: 1:1 + 1:2 collapse into the span 1:1-2. The
    // alignment sidecar was CLEAN before the reconcile event — only after
    // text.structure.apply publishes does its projection change.
    const edited = TIT_USFM
      .replace('\\v 1 Pablo, siervo de Dios.\n\\v 2 ___', '\\v 1-2 Pablo, siervo de Dios.');
    rig.repos.get(REPO)?.files.set('TIT.usfm', edited);

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('reconciled');
    // The sidecars the structural event invalidated must have been swept too.
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store3 = restart();
    await store3.open(REPO);
    expect(store3.lastOpenReport?.classification).toBe('converged');
  });
});

describe('official review R4: seeding ABORTS when the project scope cannot be read', () => {
  it('a metadata-read failure refuses the seed instead of journaling a widened scope', async () => {
    const { rig, restart } = await setup();
    const repo = '_local_/_local_/sinscope';
    rig.createRepo(repo, { 'vrs.json': FAKE_VRS, 'TIT.usfm': TIT_USFM });
    // The metadata read fails transiently during the FIRST open. Seeding must
    // stop — scope is journaled forever in book.add, and defaulting to [] is
    // whole-book scope, silently admitting out-of-scope work.
    rig.failOn((c) => c.route.includes('/burrito/metadata/raw/') && c.route.includes('sinscope'));
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(/injected failure|scope/);
    expect(segmentPaths(rig, repo)).toEqual([]); // nothing journaled
  });
});

describe('round 6 B3 / D59: the relabel guard compares shas, never version labels', () => {
  it('a same-label resolution over a DIFFERENT sha REFUSES the decision write', async () => {
    const { rig, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    // The tag is unenforced (D58): same repoPath, same 'v87', another commit.
    const retagged = { ...RESOLUTION, sha: 'e'.repeat(40) };
    await expect(
      store.upsertDecision('translationWords', 'TIT', decision('base2'), retagged),
    ).rejects.toThrow(/sha|gateway/i);

    // Nothing relabeled, nothing silently journaled under wrong provenance.
    const doc = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { sha?: string }; decisions?: Decision[] };
    expect(doc.resource?.sha).toBe(RESOLUTION.sha);
    expect(doc.decisions?.some((d) => d.contextId.checkId === 'base2')).toBeFalsy();
  });

  it('the SAME sha under a different display label agrees — the label is cosmetic', async () => {
    const { rig, api, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    const relabeled = { ...RESOLUTION, version: 'v87-rc1' };
    await store.upsertDecision('translationWords', 'TIT', decision('base2'), relabeled);
    const doc = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { sha?: string; version?: string }; decisions?: Decision[] };
    expect(doc.resource?.sha).toBe(RESOLUTION.sha);
    expect(doc.resource?.version).toBe('v87-rc1');
    expect(doc.decisions?.some((d) => d.contextId.checkId === 'base2')).toBe(true);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

describe('round 6 B2: pruning a newer intent never resurrects a superseded resolution', () => {
  it('a retained older record cannot roll the decision file back after the newer record prunes', async () => {
    const { rig, api, store, restart } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);

    // I1 — a coordinated gateway change to RES_OLD whose resources.json
    // regeneration fails persistently: published, decisions regenerated, the
    // record is retained with resolutions {translationWords/TIT: RES_OLD}.
    const nextPins = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (nextPins.languageSets.primary as unknown as Record<string, unknown>).translationWords = PIN(
      'es-419_tw',
      'v37',
      'parascriptural/x-bcvarticles',
    );
    rig.failOn((c) => c.method === 'POST' && c.ipath === 'checking/resources.json', 2);
    await expect(
      store.applyGatewayChange({
        resources: nextPins,
        resourcesMd5: (await store.readResourcesWithMd5()).md5,
        decisions: [
          {
            tool: 'translationWords',
            book: 'TIT',
            file: {
              schemaVersion: 1,
              tool: 'translationWords',
              book: 'TIT',
              resource: RES_OLD as never,
              decisions: [decision('nuevo1', 'llevada')],
            } as unknown as DecisionFile,
            expectMd5: (await store.readDecisionsWithMd5('translationWords', 'TIT')).md5,
          },
        ],
      }),
    ).rejects.toThrow(/injected failure/);

    // I2 — a later whole-file write moves the SAME (tool, book) key to RES_NEW
    // and adds a decision. It converges; its record becomes prunable. The
    // still-failing resources.json keeps I1 alive (its inline retry burns the
    // second injected failure).
    const stored = (await store.readDecisions('translationWords', 'TIT'))!;
    await store.writeDecisions('translationWords', 'TIT', {
      ...stored,
      resource: RES_NEW as never,
      decisions: [...stored.decisions, decision('extra1')],
    } as unknown as DecisionFile);
    const afterI2 = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string } };
    expect(afterI2.resource?.version).toBe('v38');

    // The injected failures are exhausted: resources.json can now install.
    // Any later mutation runs the inline retry of I1's outstanding paths —
    // which must complete I1 under the CURRENT overlay, never rewrite the
    // decision file back to I1's superseded RES_OLD.
    await store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' });
    const afterRetry = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string; sha?: string } };
    expect(
      afterRetry.resource?.version,
      'the superseded resolution must never be resurrected by the retry',
    ).toBe('v38');
    expect(afterRetry.resource?.sha).toBe(RES_NEW.sha);

    // And the same holds across a restart + open.
    const store2 = restart();
    await store2.open(REPO);
    const afterOpen = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { version?: string } };
    expect(afterOpen.resource?.version).toBe('v38');
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

describe('2026-08-28 adversarial round 26: a note retry after a lost publish response is idempotent', () => {
  it('the retried note.add is not appended as a second permanent event', async () => {
    const { rig, api, kv, store, restart } = await setup();

    // Same crash window as B1, on the grow-only note op: the segment is
    // ACCEPTED, the stage-key delete fails, publish() throws after the
    // append landed — the caller (the D65 note SaveScheduler) sees a failure
    // and its Retry replays the SAME text.
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (key: string): Promise<void> => {
      if (lostResponses > 0 && key.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(key);
    };
    await expect(store.addNote('TIT', 1, '2', 'What Paul means here.')).rejects.toThrow(/lost response/);

    // The note IS on the server and the staged intent survived.
    const published = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('What Paul means here.'),
    );
    expect(published).toHaveLength(1);

    // The retry: replay recovers the accepted note into the fold; the
    // target's LATEST note already carries this exact text, so nothing is
    // appended — grow-only history is not multiplied (round 26).
    await store.addNote('TIT', 1, '2', 'What Paul means here.');
    const republished = segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('What Paul means here.'),
    );
    expect(republished, 'the same note must not be journaled twice').toHaveLength(1);
    expect(store.readNotes('TIT').filter((n) => n.text === 'What Paul means here.')).toHaveLength(1);

    // A genuinely NEW text for the same target still appends (grow-only).
    await store.addNote('TIT', 1, '2', 'A revised understanding.');
    const notes = store.readNotes('TIT').filter((n) => n.chapter === '1' && n.verse === '2');
    expect(notes[notes.length - 1].text).toBe('A revised understanding.');
    expect(notes).toHaveLength(2);

    // The project verifies and a reopen converges quietly.
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });
});

describe('2026-08-28 adversarial round 27: an ABANDONED failed note never resurrects from the outbox', () => {
  it('a provably-unpublished staged note.add is withdrawn on failure — a later mutation does not republish it', async () => {
    const { rig, api, kv, store, restart } = await setup();

    // PRE-accept transport failure: the segment write itself fails, so the
    // staged intent is provably unpublished. Without the round-27 withdrawal
    // the stage would linger, and the next mutation's replayStaged would
    // REPUBLISH the note the user has since abandoned — permanently
    // (grow-only, no delete).
    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    await expect(store.addNote('TIT', 1, '2', 'An abandoned thought.')).rejects.toThrow(/injected failure/);

    // Nothing landed, and neither the stage nor its ledger record lingers.
    expect(segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('An abandoned thought.'),
    )).toHaveLength(0);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0);
    expect((await kv.keys('intent:')).filter((k) => k.includes(REPO))).toHaveLength(0);

    // The user clears the box and moves on; a later UNRELATED mutation (which
    // runs replayStaged first) must not resurrect the abandoned note.
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    expect(store.readNotes('TIT')).toHaveLength(0);
    expect(segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('An abandoned thought.'),
    )).toHaveLength(0);

    // The project verifies and a reopen converges quietly.
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
    expect(store2.readNotes('TIT')).toHaveLength(0);
  });

  it('a lost-response accept KEEPS its stage — the accepted note is durable truth, never withdrawn', async () => {
    const { rig, kv, store } = await setup();
    // Post-accept window (B1): the stage-key delete fails after the segment
    // landed. The withdrawal probe finds the exact bytes on the server and
    // returns "accepted" — the stage stays for replay to reconcile.
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (key: string): Promise<void> => {
      if (lostResponses > 0 && key.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(key);
    };
    await expect(store.addNote('TIT', 1, '2', 'A kept thought.')).rejects.toThrow(/lost response/);
    // The note IS on the server, and the stage survived the failure handling.
    expect(segmentPaths(rig).filter((p) =>
      (rig.repos.get(REPO)?.files.get(p) ?? '').includes('A kept thought.'),
    )).toHaveLength(1);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);
    // Replay reconciles on the next mutation; the accepted note is readable.
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    expect(store.readNotes('TIT').map((n) => n.text)).toEqual(['A kept thought.']);
  });
});

describe('2026-08-28 adversarial round 28: Retry surfaces a lost-response accept even over a CLEAN buffer', () => {
  it('fresh note → accepted/response lost → clear → Retry: the durable note appears immediately, exactly once, and Saved is honest', async () => {
    const { kv, store } = await setup();
    const { SaveScheduler } = await import('../src/data/saveScheduler');
    const { __makeNoteWriterForTests: makeNoteWriter, noteKeyFor } =
      await import('../src/state.jsx');

    // The real D65 wiring: the note scheduler writes through the real store.
    const noteTargetsRef = { current: new Map() };
    const dispatched: Array<Record<string, unknown>> = [];
    const writer = makeNoteWriter({
      noteTargetsRef,
      dispatch: (a: Record<string, unknown>) => dispatched.push(a),
      apiClient: {},
    });
    const sched = new SaveScheduler({
      splice: (_r: string, _c: unknown, _v: unknown, body: string) => body,
      writeBook: (k: string, text: string) => writer(k, text),
      clock: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    const key = noteKeyFor(REPO, 'TIT', 1, '2');
    noteTargetsRef.current.set(key, {
      store, repoPath: REPO, book: 'TIT', chapter: 1, verse: '2', projectFrame: true,
    });

    // Fresh note: the user types A; the write is ACCEPTED but the response is
    // lost (the stage-key delete fails after the segment landed — B1 window).
    let lostResponses = 1;
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (k: string): Promise<void> => {
      if (lostResponses > 0 && k.startsWith('outbox:')) {
        lostResponses -= 1;
        throw new Error('injected failure: lost response after accept');
      }
      return rawDelete(k);
    };
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '2', 'A durable thought.');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error');

    // The user CLEARS the failed fresh draft: the box stages the stored text
    // (empty) — the buffer is clean, so retry() alone would write nothing.
    sched.markDirty(key, 1, '2', '');

    // The retryNoteSave sequence (round 28): reconcile the store FIRST, then
    // retry the buffer, then re-read the notes the screen displays.
    await store.reconcileStaged();
    await sched.retry();
    expect(sched.getState()).toBe('saved'); // honest: nothing is pending or failed…
    const notes = store.readNotes('TIT').filter((n) => n.chapter === '1' && n.verse === '2');
    expect(notes.map((n) => n.text)).toEqual(['A durable thought.']); // …and the accepted note is VISIBLE, once
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0); // the stage reconciled

    // A later mutation replays nothing new — no surprise resurrection.
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    expect(store.readNotes('TIT').filter((n) => n.text === 'A durable thought.')).toHaveLength(1);
  });
});

describe('2026-08-28 adversarial round 29: a FAILED reconcile keeps the note error standing', () => {
  it('clean failed buffer + rejecting reconcileStaged → still error, never Saved; a healed transport then surfaces the note once', async () => {
    const { rig, kv, store } = await setup();
    const { SaveScheduler } = await import('../src/data/saveScheduler');
    const { __makeNoteWriterForTests: makeNoteWriter, noteKeyFor } =
      await import('../src/state.jsx');
    const noteTargetsRef = { current: new Map() };
    const writer = makeNoteWriter({ noteTargetsRef, dispatch: () => {}, apiClient: {} });
    const sched = new SaveScheduler({
      splice: (_r: string, _c: unknown, _v: unknown, body: string) => body,
      writeBook: (k: string, text: string) => writer(k, text),
      clock: { setTimeout: () => 0, clearTimeout: () => {} },
      // Round 31 hardening: the gate lives IN the scheduler — retry() runs
      // this on a retained failure and refuses when it rejects.
      reconcile: () => store.reconcileStaged(),
    });
    const key = noteKeyFor(REPO, 'TIT', 1, '2');
    noteTargetsRef.current.set(key, {
      store, repoPath: REPO, book: 'TIT', chapter: 1, verse: '2', projectFrame: true,
    });
    const retrySequence = () => sched.retry();

    // SUSTAINED transport failure on the journal segment routes: the write's
    // pre-check fails, the round-27 cancel probe fails (stage kept on
    // doubt), and the FIRST reconcile fails too — three consecutive hits.
    rig.failOn((c) => (c.ipath ?? '').includes('/segments/'), 3);
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '2', 'A held-up thought.');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error');
    // The stage was KEPT (the cancel probe could not prove it unpublished).
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // The user CLEARS the fresh draft (buffer clean) and clicks Retry while
    // the transport is still down: the reconcile REJECTS, and the guard must
    // leave the error standing — never a false Saved over an unresolved
    // permanent write.
    sched.markDirty(key, 1, '2', '');
    await retrySequence();
    expect(sched.getState()).toBe('error');
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // The transport heals; the SAME gesture now reconciles (the staged note
    // republishes — a kept intent resolves toward durability, R-8.1.7/8),
    // retries a clean buffer, and reports Saved honestly.
    await retrySequence();
    expect(sched.getState()).toBe('saved');
    const notes = store.readNotes('TIT').filter((n) => n.chapter === '1' && n.verse === '2');
    expect(notes.map((n) => n.text)).toEqual(['A held-up thought.']);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0);
  });
});

describe('2026-08-28 adversarial round 30: NAVIGATION drains reconcile staged notes like Retry does', () => {
  it('a navigation drain over a clean failed buffer blocks while reconcile rejects, and surfaces the note once when it heals', async () => {
    const { rig, kv, store } = await setup();
    const { SaveScheduler } = await import('../src/data/saveScheduler');
    const { __makeNoteWriterForTests: makeNoteWriter, noteKeyFor } =
      await import('../src/state.jsx');
    const noteTargetsRef = { current: new Map() };
    const writer = makeNoteWriter({ noteTargetsRef, dispatch: () => {}, apiClient: {} });
    const sched = new SaveScheduler({
      splice: (_r: string, _c: unknown, _v: unknown, body: string) => body,
      writeBook: (k: string, text: string) => writer(k, text),
      clock: { setTimeout: () => 0, clearTimeout: () => {} },
      // Round 31 hardening: navigation calls sched.drain() directly — the
      // reconcile gate is INSIDE, so no call site can bypass it.
      reconcile: () => store.reconcileStaged(),
    });
    const key = noteKeyFor(REPO, 'TIT', 1, '2');
    noteTargetsRef.current.set(key, {
      store, repoPath: REPO, book: 'TIT', chapter: 1, verse: '2', projectFrame: true,
    });
    // Navigation calls the scheduler's own gated drain directly (round 31).
    const drainNotes = () => sched.drain();

    // Failure with the stage KEPT (write pre-check and cancel probe both
    // fail), then the user clears the fresh draft: buffer clean, error
    // standing — the exact state a bare sched.drain() would wave through.
    rig.failOn((c) => (c.ipath ?? '').includes('/segments/'), 3);
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '2', 'A navigating thought.');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error');
    sched.markDirty(key, 1, '2', '');

    // Navigation while the transport is still down: the drain must REFUSE —
    // the third injected failure rejects the reconcile.
    expect(await drainNotes()).toBe(false);
    expect(sched.getState()).toBe('error'); // still standing, still blocking
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // The transport heals: the SAME navigation reconciles (the kept intent
    // republishes toward durability, R-8.1.7/8), drains clean, and proceeds.
    expect(await drainNotes()).toBe(true);
    expect(sched.getState()).toBe('saved');
    const notes = store.readNotes('TIT').filter((n) => n.chapter === '1' && n.verse === '2');
    expect(notes.map((n) => n.text)).toEqual(['A navigating thought.']);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0);
  });
});
