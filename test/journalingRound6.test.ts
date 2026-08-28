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
