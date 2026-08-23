// Crash, recovery, seeding, and coordinated-change proofs — issue #62.
//
// A "crash" is modeled the only honest way an in-process suite can: an injected
// failure aborts the mutation mid-pipeline, the store object is abandoned, the
// module-level clocks/queues are dropped (a process restart is fresh module
// state), and a NEW store over the SAME durable backends (the fake rig's disk,
// the Map-backed installation kv) reopens the project. The proof is always the
// same: reopening reaches the same verified bytes, no accepted action is lost,
// and no action is duplicated (no new timestamps).
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import {
  JournalingStore,
  SeedMismatchError,
  UnexplainedDivergenceError,
  forgetProjectQueues,
} from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { describeVerifierReport, verifyProjectAgainstJournal } from '../src/data/journal/verify';
import type { Decision, ResourcesFile } from '../src/data/burritoStore';
import { FAKE_VRS, journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

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

// D58: a §5.3 pin carries its sha identity; the fixture derives one from the
// same (repo, version) distinctions the tests were written with.
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

const RESOLUTION = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', sha: sha40('en_tw@v87'), languageSet: 'fallback' };

const decision = (checkId: string, patch: Partial<Decision> = {}): Decision => ({
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
  modifiedTimestamp: '2026-08-19T12:00:00.000Z',
  ...patch,
});

const segmentPaths = (rig: JournalingRig, repo = REPO): string[] =>
  [...(rig.repos.get(repo)?.files.keys() ?? [])]
    .filter((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p))
    .sort();

const allEvents = async (rig: JournalingRig, repo = REPO): Promise<JournalEvent[]> => {
  const out: JournalEvent[] = [];
  for (const path of segmentPaths(rig, repo)) {
    const verdict = await validateSegment(rig.repos.get(repo)?.files.get(path) ?? '');
    if (!verdict.ok) throw new Error(`invalid segment ${path}: ${verdict.reason}`);
    out.push(...verdict.events);
  }
  return out;
};

const expectVerified = async (api: ServerApi, repo = REPO): Promise<void> => {
  const report = await verifyProjectAgainstJournal(api, repo);
  expect(report.ok, describeVerifierReport(report)).toBe(true);
};

interface World {
  rig: JournalingRig;
  api: ServerApi;
  kv: ReturnType<typeof memKv>;
  clock: ReturnType<typeof tickingNow>;
  store: JournalingStore;
  /** A process restart: fresh module state, same durable backends. */
  restart: () => JournalingStore;
}

const setup = async (): Promise<World> => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-08-19T09:00:00.000Z');
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

describe('#62 crash atomicity: before publication', () => {
  it('a failed segment write changes NO derived file; reopen republishes the EXACT staged bytes', async () => {
    const world = await setup();
    const { rig, api, store, kv, restart } = world;
    const diskBefore = rig.repos.get(REPO)?.files.get('TIT.usfm');
    const segsBefore = segmentPaths(rig);
    rig.failOn((ctx) => ctx.method === 'POST' && (ctx.ipath ?? '').includes('/segments/'));
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow(
      /injected failure/,
    );
    // Journal-first: publication failed, so no derived project file changed.
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toBe(diskBefore);
    expect(segmentPaths(rig)).toEqual(segsBefore);
    // The durable intent survives the crash.
    const stagedKeys = (await kv.keys('outbox:')).filter((k) => k.includes(REPO));
    expect(stagedKeys).toHaveLength(1);
    const stagedBytes = await kv.get(stagedKeys[0]);

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.replayed.map((r) => r.outcome)).toEqual(['republished']);
    // The EXACT staged bytes were republished — same action, same timestamps.
    const published = segmentPaths(rig).filter((p) => !segsBefore.includes(p));
    expect(published).toHaveLength(1);
    expect(rig.repos.get(REPO)?.files.get(published[0])).toBe(stagedBytes);
    // …and the derived file recovered FORWARD to the journal's projection.
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');
    await expectVerified(api);
    // Idempotent: a second replay finds nothing staged.
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0);
  });
});

describe('#62 crash atomicity: after publication, before regeneration', () => {
  it('the journal is ahead; reopen regenerates forward from the durable marker (no duplicate action)', async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    const segsBefore = segmentPaths(rig).length;
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'TIT.usfm');
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow(
      /injected failure/,
    );
    expect(segmentPaths(rig)).toHaveLength(segsBefore + 1); // published
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).not.toContain('Nueva vida.'); // stale disk

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    expect(segmentPaths(rig)).toHaveLength(segsBefore + 1); // NOT duplicated
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');
    await expectVerified(api);
  });

  it('with the ledger record lost, the journal-ahead prefix check still recovers forward', async () => {
    const world = await setup();
    const { rig, api, store, kv, restart } = world;
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'TIT.usfm');
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow();
    // Port (intent ledger): the retired regen marker is gone; losing the
    // intent record itself is the analogous corruption.
    for (const key of await kv.keys('intent:')) await kv.delete(key); // lose the ledger record

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');
    await expectVerified(api);
  });

  it('reopening twice reaches the same verified bytes (recovery is idempotent)', async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'TIT.usfm');
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow();
    await restart().open(REPO);
    const bytesAfterFirst = rig.repos.get(REPO)?.files.get('TIT.usfm');
    const store3 = restart();
    await store3.open(REPO);
    expect(store3.lastOpenReport?.classification).toBe('converged');
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toBe(bytesAfterFirst);
    await expectVerified(api);
  });
});

describe('#62 crash atomicity: during the final server commit', () => {
  it('a failed add-and-commit leaves the installed derived set standing; reopen is converged and a retried commit succeeds', async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    rig.failOn((ctx) => ctx.route.includes('add-and-commit'));
    await expect(store.commit('checkpoint (tC4)')).rejects.toThrow(/injected failure/);
    expect(rig.repos.get(REPO)?.commits ?? []).not.toContain('checkpoint (tC4)');
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.'); // installed set stands

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
    await store2.commit('checkpoint (tC4)');
    expect(rig.repos.get(REPO)?.commits).toContain('checkpoint (tC4)');
    await expectVerified(api);
  });
});

describe('#62 the coordinated gateway change', () => {
  const plannedFile = () => ({
    schemaVersion: 1,
    tool: 'translationWords',
    book: 'TIT',
    resource: { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', sha: sha40('es-419_tw@v37'), languageSet: 'primary' },
    // carry-over output: one decision re-keyed to the NEW resource's checkId,
    // the old-key record no longer in the file (it is invalidated-and-retained
    // by the diff), and nothing else.
    decisions: [decision('nuevo1', { comments: 'llevada' })],
  });
  const nextPins = (): ResourcesFile => {
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationWords = PIN(
      'es-419_tw',
      'v37',
      'parascriptural/x-bcvarticles',
    );
    return next;
  };

  it('is ONE multi-event journal action across decisions and pins', async () => {
    const world = await setup();
    const { rig, api, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
    const before = segmentPaths(rig).length;
    const resourcesMd5 = (await store.readResourcesWithMd5()).md5;
    const decisionsMd5 = (await store.readDecisionsWithMd5('translationWords', 'TIT')).md5;
    await store.applyGatewayChange({
      resources: nextPins(),
      resourcesMd5,
      decisions: [{ tool: 'translationWords', book: 'TIT', file: plannedFile() as never, expectMd5: decisionsMd5 }],
    });
    const segs = segmentPaths(rig);
    expect(segs).toHaveLength(before + 1); // ONE action
    const verdict = await validateSegment(rig.repos.get(REPO)?.files.get(segs[segs.length - 1]) ?? '');
    if (!verdict.ok) throw new Error(verdict.reason);
    const ops = verdict.events.map((e) => e.op).sort();
    expect(ops).toEqual(['check.decision.set', 'check.decision.set', 'resource.pin.set']);
    // The old-key decision is invalidated-and-retained, never deleted.
    const file = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.resource.repoPath).toBe('git.door43.org/es-419_gl/es-419_tw');
    const byId = Object.fromEntries(
      (file.decisions as Decision[]).map((d) => [d.contextId.checkId, d]),
    );
    expect(byId.nuevo1).toMatchObject({ comments: 'llevada' });
    expect(byId.viejo1).toMatchObject({ invalidated: true, status: 'invalid' });
    await expectVerified(api);
  });

  it('a stale precondition refuses the WHOLE change before anything is staged or published', async () => {
    const world = await setup();
    const { rig, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
    const before = segmentPaths(rig).length;
    await expect(
      store.applyGatewayChange({
        resources: nextPins(),
        resourcesMd5: 'stale0000000000000000000000000000',
        decisions: [],
      }),
    ).rejects.toThrow(/stale write refused/);
    expect(segmentPaths(rig)).toHaveLength(before);
  });

  it('recovers FORWARD from an injected post-publication failure — no byte rollback, ever', async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
    const before = segmentPaths(rig).length;
    // The decision sidecar regenerates first, then resources.json FAILS.
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/resources.json');
    await expect(
      store.applyGatewayChange({
        resources: nextPins(),
        resourcesMd5: (await store.readResourcesWithMd5()).md5,
        decisions: [
          {
            tool: 'translationWords',
            book: 'TIT',
            file: plannedFile() as never,
            expectMd5: (await store.readDecisionsWithMd5('translationWords', 'TIT')).md5,
          },
        ],
      }),
    ).rejects.toThrow(/injected failure/);
    expect(segmentPaths(rig)).toHaveLength(before + 1); // published — permanent
    // The already-regenerated decision file KEEPS the new state (no rollback):
    const file = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo1')).toBe(true);
    // …and the pins are still the OLD bytes until recovery.
    expect(rig.repos.get(REPO)?.files.get('checking/resources.json')).not.toContain('es-419_tw');

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    expect(rig.repos.get(REPO)?.files.get('checking/resources.json')).toContain('es-419_tw');
    expect(segmentPaths(rig)).toHaveLength(before + 1); // still not duplicated
    await expectVerified(api);
  });
});

describe('#62 universal seeding (§8.8)', () => {
  /** A pre-#62 project: derived files exist, journal does not. Sidecars use the
   * LEGACY byte form (no trailing newline) the Increment-1/2 writers produced. */
  const legacyProject = (rig: JournalingRig, name = 'legado'): string => {
    const repo = `_local_/_local_/${name}`;
    const legacy = (doc: unknown): string => JSON.stringify(doc, null, 2);
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/resources.json': legacy(PINS),
      'checking/settings.json': legacy({ schemaVersion: 1, textDirection: 'ltr' }),
      'checking/translationWords/TIT.json': legacy({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        decisions: [decision('t1g7')],
      }),
    });
    return repo;
  };

  it('publishes one all-or-nothing seed; the fold reproduces the pre-seed state; legacy sidecars converge to canonical bytes; USFM is untouched', async () => {
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = legacyProject(rig);
    const writesBefore = rig.writes.length;
    const store = restart();
    await store.open(repo);
    expect(store.lastOpenReport?.seeded).toBe(true);
    const events = await allEvents(rig, repo);
    expect(events.every((e) => e.seed && (e.seed as { source: string }).source === 'sidecar-migration')).toBe(true);
    expect(events.map((e) => e.op).sort()).toEqual([
      'book.add',
      'check.decision.set',
      'project.vrs.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'resource.pin.set',
      'settings.set',
    ]);
    // The precious surface was never rewritten:
    expect(rig.writes.slice(writesBefore).some((w) => w.repo === repo && w.ipath === 'TIT.usfm')).toBe(false);
    expect(rig.repos.get(repo)?.files.get('TIT.usfm')).toBe(TIT_USFM);
    // Legacy sidecars converged to the canonical checkpoint byte form:
    expect(rig.repos.get(repo)?.files.get('checking/settings.json')?.endsWith('\n')).toBe(true);
    await expectVerified(api, repo);
    // Reopening is quiet: already journaled, already converged.
    const store2 = restart();
    await store2.open(repo);
    expect(store2.lastOpenReport?.seeded).toBe(false);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });

  it('seeds a decision file whose records are NOT in canonical order — order is byte form, not content (R-8.8.2)', async () => {
    // Real tC3 exports carry decisions in whatever order the tool wrote them.
    // The fold projects decisions sorted by canonical contextId, so a stored
    // order that differs is exactly the byte-form class convergence rewrites —
    // it must never refuse the seed (found 2026-08-22: the conformance sample
    // itself stores [t1g7, a9p2] and every rig journey failed at open).
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = '_local_/_local_/desordenado';
    const recA = decision('t1g7');
    const recB = decision('a9p2', {
      contextId: { ...decision('a9p2').contextId, groupId: 'apostle', quote: 'ἀπόστολος', quoteString: 'ἀπόστολος' },
    });
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/resources.json': JSON.stringify(PINS, null, 2),
      'checking/translationWords/TIT.json': JSON.stringify({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        // Deliberately NOT the projection's order (it sorts by contextId).
        decisions: [recA, recB],
      }),
    });
    const store = restart();
    await store.open(repo);
    expect(store.lastOpenReport?.seeded).toBe(true);
    // Both records survived into the fold — nothing was collapsed or dropped.
    const events = await allEvents(rig, repo);
    const seededIds = events
      .filter((e) => e.op === 'check.decision.set')
      .map((e) => (e.decision as { contextId: { checkId: string } }).contextId.checkId)
      .sort();
    expect(seededIds).toEqual(['a9p2', 't1g7']);
    // The stored file converged to the canonical projection byte form.
    await expectVerified(api, repo);
  });

  it('two independent seeds of the same source CONVERGE modulo actor identity (D53d)', async () => {
    const world = await setup();
    const { rig, api, clock } = world;
    const repoA = legacyProject(rig, 'copiaa');
    const repoB = legacyProject(rig, 'copiab');
    // Two INSTALLATIONS: separate kv stores → separate secrets → separate actors.
    forgetSharedClocks();
    forgetProjectQueues();
    const storeA = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
    await storeA.open(repoA);
    forgetSharedClocks();
    forgetProjectQueues();
    const storeB = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(17) });
    await storeB.open(repoB);
    expect(storeA.actorId).not.toBe(storeB.actorId);

    // Sneakernet B's journal into A (the §8.1 disjoint-writer merge guarantee).
    const filesA = rig.repos.get(repoA)?.files;
    const filesB = rig.repos.get(repoB)?.files;
    for (const [path, bytes] of filesB ?? new Map<string, string>())
      if (path.startsWith('checking/journal/')) filesA?.set(path, bytes);

    forgetSharedClocks();
    forgetProjectQueues();
    const reopened = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(19) });
    await reopened.open(repoA);
    // Identical payloads CONVERGE — auto-merged, zero forks, nothing retained.
    expect(reopened.lastOpenReport?.forks).toEqual([]);
    expect(reopened.lastOpenReport?.retained).toEqual([]);
    await expectVerified(api, repoA);
  });

  it('REFUSES a seed whose fold cannot reproduce the pre-seed bytes: co-present same-key decisions', async () => {
    const world = await setup();
    const { rig, restart } = world;
    const repo = '_local_/_local_/copresente';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/translationWords/TIT.json': JSON.stringify({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        // The tC3-era co-present form: same §5.2 identity key, different quote.
        decisions: [decision('t1g7'), decision('t1g7', { contextId: { ...decision('t1g7').contextId, quote: 'Κύριος', quoteString: 'Κύριος' } })],
      }),
    });
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(SeedMismatchError);
    expect(segmentPaths(rig, repo)).toEqual([]); // all-or-nothing: nothing published
  });

  it('REFUSES a seed when a DECISION sidecar carries an unknown top-level field (R-8.8.2)', async () => {
    // The checkpoint projection emits exactly {schemaVersion, tool, book,
    // resource, decisions}; convergence rewrites the file to that form. An
    // extra top-level field is content the projection cannot represent — the
    // seed MUST refuse rather than drop it silently (round 6 B4).
    const world = await setup();
    const { rig, restart } = world;
    const repo = '_local_/_local_/campoextra';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/translationWords/TIT.json': JSON.stringify({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        decisions: [decision('t1g7')],
        note: 'a tC3-era annotation the projection cannot carry',
      }),
    });
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(SeedMismatchError);
    expect(segmentPaths(rig, repo)).toEqual([]); // all-or-nothing: nothing published
    // The field is still there — nothing was converged away.
    expect(rig.repos.get(repo)?.files.get('checking/translationWords/TIT.json')).toContain(
      'tC3-era annotation',
    );
  });

  it('seeds a decision file carrying the §5.2 OPTIONAL `summary` cache — disposable, never a refusal', async () => {
    // The spec marks `summary` "derived cache, regenerable ... MUST be treated
    // as disposable": convergence dropping it is specified behavior, not
    // content loss. The conformance sample itself carries one (found round 6:
    // the whole-document rule refused the seeded sample and every rig journey
    // hung at open).
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = '_local_/_local_/consumario';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/translationWords/TIT.json': JSON.stringify({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        decisions: [decision('t1g7')],
        summary: { note: 'derived cache, regenerable', decided: { kt: 1 } },
      }),
    });
    const store = restart();
    await store.open(repo);
    expect(store.lastOpenReport?.seeded).toBe(true);
    await expectVerified(api, repo);
  });

  it('REFUSES a seed when an ALIGNMENT sidecar carries an unknown top-level field (R-8.8.2)', async () => {
    const world = await setup();
    const { rig, restart } = world;
    const repo = '_local_/_local_/alineado';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/alignments/TIT.json': JSON.stringify({
        schemaVersion: 1,
        book: 'TIT',
        chapters: {},
        legacyMarkers: { '1:1': '2026-01-01' },
      }),
    });
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(SeedMismatchError);
    expect(segmentPaths(rig, repo)).toEqual([]);
  });

  it('REFUSES a seed of non-NFC book content rather than normalizing bytes it must reproduce', async () => {
    const world = await setup();
    const { rig, restart } = world;
    const repo = '_local_/_local_/nonfc';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM.replace('Pablo', 'Pablo café'), // NFD é
    });
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(SeedMismatchError);
    expect(segmentPaths(rig, repo)).toEqual([]);
  });

  it('REFUSES an unknown derived-class file rather than guessing', async () => {
    const world = await setup();
    const { rig, restart } = world;
    const repo = '_local_/_local_/extrania';
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/custom/notes.json': '{"mine": true}',
    });
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(UnexplainedDivergenceError);
  });

  it('audio and other registered-but-unjournaled ingredients survive seeding, checkpoint, and recovery byte-identically', async () => {
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = legacyProject(rig, 'conaudio');
    const audioBytes = 'RIFF-fake-audio-bytes-';
    rig.repos.get(repo)?.files.set('audio/TIT-1.mp3', audioBytes);
    const store = restart();
    await store.open(repo);
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    await store.commit('checkpoint (tC4)');
    const store2 = restart();
    await store2.open(repo);
    expect(rig.repos.get(repo)?.files.get('audio/TIT-1.mp3')).toBe(audioBytes);
    expect(rig.writes.some((w) => w.repo === repo && w.ipath.startsWith('audio/'))).toBe(false);
    const report = await verifyProjectAgainstJournal(api, repo);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    expect(report.tolerated).toContain('audio/TIT-1.mp3');
  });
});

describe('#62 actor repair limits', () => {
  it('repairs a TORN own actor.json; never overwrites a valid-but-different record', async () => {
    const world = await setup();
    const { rig, store, restart } = world;
    const actorPath = `checking/journal/${store.actorId}/actor.json`;
    rig.repos.get(REPO)?.files.set(actorPath, '{"torn": tru'); // torn bytes
    const store2 = restart();
    await store2.open(REPO);
    const repaired = JSON.parse(rig.repos.get(REPO)?.files.get(actorPath) ?? '');
    expect(repaired.actorId).toBe(store.actorId);
    expect(repaired.schemaVersion).toBe(1);

    // A VALID record naming a DIFFERENT actor is identity evidence — refused.
    rig.repos.get(REPO)?.files.set(
      actorPath,
      JSON.stringify({
        schemaVersion: 1,
        actorId: 'somebody-else-entirely',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const store3 = restart();
    await expect(store3.open(REPO)).rejects.toThrow(/never overwritten/);
  });
});

describe('#62 out-of-band derived state at open', () => {
  it('an out-of-band USFM edit reconciles via §8.8 (a linear supersede, seed-marked) — never destroys journaled work', async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    const edited = rig.repos
      .get(REPO)!
      .files.get('TIT.usfm')!
      .replace('Pablo, siervo de Dios.', 'Pablo, apóstol.');
    rig.repos.get(REPO)?.files.set('TIT.usfm', edited); // another tool edited the committed file
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('reconciled');
    expect(store2.lastOpenReport?.reconciledBooks).toEqual(['TIT']);
    const events = await allEvents(rig);
    const reconcile = events.filter((e) => (e.seed as { source?: string } | undefined)?.source === 'out-of-band-usfm');
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0].op).toBe('text.verse.set');
    expect(reconcile[0].base).not.toBeNull(); // a linear supersede of the live head
    // BOTH edits survive: the journaled one and the out-of-band one.
    const disk = rig.repos.get(REPO)?.files.get('TIT.usfm');
    expect(disk).toContain('Pablo, apóstol.');
    expect(disk).toContain('Nueva vida.');
    await expectVerified(api);
  });

  it('an out-of-band book CREATED on disk reconciles as a seeded book.add', async () => {
    const world = await setup();
    const { rig, api, restart } = world;
    rig.repos.get(REPO)?.files.set('JON.usfm', TIT_USFM.replaceAll('TIT', 'JON').replaceAll('Tito', 'Jonás'));
    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('reconciled');
    const events = await allEvents(rig);
    expect(events.some((e) => e.op === 'book.add' && e.book === 'JON')).toBe(true);
    await expectVerified(api);
  });

  it('an unexplained sidecar divergence is a diagnosable STOP: reported with hashes, nothing overwritten', async () => {
    const world = await setup();
    const { rig, restart } = world;
    const tampered = '{"schemaVersion":1,"textDirection":"rtl","tampered":true}';
    rig.repos.get(REPO)?.files.set('checking/settings.json', tampered);
    const store2 = restart();
    const failure = await store2.open(REPO).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(UnexplainedDivergenceError);
    const report = (failure as UnexplainedDivergenceError).paths;
    expect(report.some((p) => p.ipath === 'checking/settings.json' && p.diskMd5 && p.projectedMd5)).toBe(true);
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).toBe(tampered); // untouched
  });

  it('a derived file DELETED out of band is divergence too — reported, not silently recreated', async () => {
    const world = await setup();
    const { rig, restart } = world;
    rig.repos.get(REPO)?.files.delete('checking/settings.json');
    const store2 = restart();
    await expect(store2.open(REPO)).rejects.toThrow(UnexplainedDivergenceError);
  });
});

// ---------------------------------------------------------------------------
// Review regressions (PR #88 review of 2026-08-20) — three reproducible
// correctness gaps in the recovery boundary, each fixed and pinned here.
// ---------------------------------------------------------------------------

describe('#62 review P1: the decision resolution survives a crash between publication and regeneration', () => {
  const NEW_RESOURCE = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', sha: sha40('es-419_tw@v37'), languageSet: 'primary' };
  const plannedFile = () => ({
    schemaVersion: 1,
    tool: 'translationWords',
    book: 'TIT',
    resource: NEW_RESOURCE,
    decisions: [decision('nuevo1', { comments: 'llevada' })],
  });
  const nextPins = (): ResourcesFile => {
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationWords = PIN(
      'es-419_tw',
      'v37',
      'parascriptural/x-bcvarticles',
    );
    return next;
  };
  const crashOnFirstDecisionWrite = async (world: World): Promise<void> => {
    const { rig, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
    // The FIRST regeneration write (the decision sidecar) fails AFTER the
    // action published — the reviewer's exact repro: a restart used to harvest
    // the OLD resource from disk and regenerate the new decisions under it.
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/translationWords/TIT.json');
    await expect(
      store.applyGatewayChange({
        resources: nextPins(),
        resourcesMd5: (await store.readResourcesWithMd5()).md5,
        decisions: [
          {
            tool: 'translationWords',
            book: 'TIT',
            file: plannedFile() as never,
            expectMd5: (await store.readDecisionsWithMd5('translationWords', 'TIT')).md5,
          },
        ],
      }),
    ).rejects.toThrow(/injected failure/);
    // Published, but NOTHING regenerated yet: the disk file still carries the
    // OLD resource — the state the durable record must survive.
    const stale = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(stale.resource).toEqual(RESOLUTION);
  };

  it('reopen regenerates the new decisions under the NEW resource (durable marker path)', async () => {
    const world = await setup();
    await crashOnFirstDecisionWrite(world);
    const store2 = world.restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    const file = JSON.parse(world.rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.resource).toEqual(NEW_RESOURCE); // the fix: never the harvested old resource
    expect(file.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo1')).toBe(true);
    expect(world.rig.repos.get(REPO)?.files.get('checking/resources.json')).toContain('es-419_tw');
    // The durable record is consumed once recovery converged.
    expect((await world.kv.keys('intent:')).length).toBe(0);
    await expectVerified(world.api);
  });

  it('reopen still applies the NEW resource with the regeneration marker LOST (prefix path)', async () => {
    const world = await setup();
    await crashOnFirstDecisionWrite(world);
    // Port (intent ledger): the retired regen marker was a SECOND surface that
    // could be lost while the pending resolution survived. The ledger has ONE
    // record carrying both, so "marker lost, resolution kept" is no longer a
    // reachable state — the deletion is retired with the surface, and this
    // case now proves the single record alone drives the recovery.
    const store2 = world.restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    const file = JSON.parse(world.rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.resource).toEqual(NEW_RESOURCE);
    await expectVerified(world.api);
  });

  it('a resolution record whose action provably never published is discarded, not applied', async () => {
    const world = await setup();
    const { kv, rig, restart } = world;
    // A stale record naming a ts the journal does not contain (and no staged
    // intent to republish it): applying it would relabel a file to a resource
    // whose decisions never landed. Ported to the ledger shape: one immutable
    // 'mutation' record whose gate can never be satisfied.
    const actorDir = segmentPaths(rig)[0].split('/')[2];
    const staleTs = `2030-01-01T00:00:00.000Z|0000|${actorDir}`;
    await kv.set(
      `intent:${REPO}:${actorDir}:${staleTs}`,
      JSON.stringify({
        ts: staleTs,
        kind: 'mutation',
        affectedPaths: ['checking/translationWords/TIT.json'],
        resolutions: { 'translationWords\nTIT': NEW_RESOURCE },
      }),
    );
    const store2 = restart();
    await store2.open(REPO);
    expect((await kv.keys('intent:')).length).toBe(0); // discarded
    await expectVerified(world.api);
  });
});

describe('#62 review P1: an interrupted universal seed RESUMES instead of refusing', () => {
  const legacyProject = (rig: JournalingRig, name = 'legado'): string => {
    const repo = `_local_/_local_/${name}`;
    const legacy = (doc: unknown): string => JSON.stringify(doc, null, 2);
    rig.createRepo(repo, {
      'vrs.json': FAKE_VRS,
      'TIT.usfm': TIT_USFM,
      'checking/resources.json': legacy(PINS),
      'checking/settings.json': legacy({ schemaVersion: 1, textDirection: 'ltr' }),
      'checking/translationWords/TIT.json': legacy({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RESOLUTION,
        decisions: [decision('t1g7')],
      }),
    });
    return repo;
  };

  it('crash during segment publication: replay finishes the seed and convergence completes (the reviewer repro)', async () => {
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = legacyProject(rig);
    // The seed's segment write fails after staging — the reviewer's repro:
    // the next open's replay used to publish it and then refuse as unexplained.
    rig.failOn(
      (ctx) => ctx.method === 'POST' && ctx.repo === repo && (ctx.ipath ?? '').includes('/segments/'),
    );
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(/injected failure/);
    expect(segmentPaths(rig, repo)).toHaveLength(0); // staged, not published

    const store2 = restart();
    await store2.open(repo); // pre-fix: UnexplainedDivergenceError
    expect(store2.lastOpenReport?.seeded).toBe(true);
    expect(store2.lastOpenReport?.classification).toBe('seeded');
    expect(segmentPaths(rig, repo).length).toBeGreaterThan(0);
    // Legacy sidecars converged to the canonical byte form:
    expect(rig.repos.get(repo)?.files.get('checking/settings.json')?.endsWith('\n')).toBe(true);
    await expectVerified(api, repo);
    // The durable seed record is consumed; the third open is quiet.
    expect((await world.kv.keys('intent:')).length).toBe(0);
    const store3 = restart();
    await store3.open(repo);
    expect(store3.lastOpenReport?.classification).toBe('converged');
  });

  it('crash during post-publication convergence: reopen finishes the canonicalization', async () => {
    const world = await setup();
    const { rig, api, restart } = world;
    const repo = legacyProject(rig, 'legadodos');
    // Publication completes; the FIRST convergence write (a sidecar
    // canonicalization) fails.
    rig.failOn(
      (ctx) =>
        ctx.method === 'POST' && ctx.repo === repo && (ctx.ipath ?? '').startsWith('checking/') &&
        !(ctx.ipath ?? '').includes('journal'),
    );
    const store = restart();
    await expect(store.open(repo)).rejects.toThrow(/injected failure/);
    expect(segmentPaths(rig, repo).length).toBeGreaterThan(0); // published

    const store2 = restart();
    await store2.open(repo);
    expect(store2.lastOpenReport?.seeded).toBe(true);
    await expectVerified(api, repo);
    expect((await world.kv.keys('intent:')).length).toBe(0);
  });
});

describe('#62 review P2: a valid last-register removal materializes the EMPTY document', () => {
  it('writeSettings({schemaVersion: 1}) leaves the empty settings document, not the stale keys', async () => {
    const world = await setup();
    const { rig, api, store } = world;
    // Both folded settings removed — a perfectly valid write.
    await store.writeSettings({ schemaVersion: 1 });
    const bytes = rig.repos.get(REPO)?.files.get('checking/settings.json');
    expect(bytes).toBe('{\n  "schemaVersion": 1\n}\n'); // pre-fix: textDirection survived on disk
    await expectVerified(api);
  });

  it('removing every pin leaves the empty resources document, and the checkpoint still passes', async () => {
    const world = await setup();
    const { rig, api, store } = world;
    await store.writeResources({ schemaVersion: 2 } as unknown as ResourcesFile);
    expect(rig.repos.get(REPO)?.files.get('checking/resources.json')).toBe(
      '{\n  "schemaVersion": 2\n}\n',
    );
    await store.commit('after removals (tC4)');
    expect(rig.repos.get(REPO)?.commits).toContain('after removals (tC4)');
    await expectVerified(api);
    // Reopening classifies as converged — the empty documents are the projection.
    const store2 = world.restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });
});

// ---------------------------------------------------------------------------
// Review regressions, round 2 (PR #88 review of 2026-08-20, second pass).
// ---------------------------------------------------------------------------

describe('#62 review round 2, P1: an earlier unfinished regeneration survives later mutations', () => {
  it("a later successful mutation retains (and retries) the failed action's marker; reopen recovers forward (the reviewer repro)", async () => {
    const world = await setup();
    const { rig, api, store, restart } = world;
    // Settings regeneration fails TWICE: once under its own mutation, once
    // under the next mutation's inline retry — so the outstanding path is
    // still unmaterialized when the later mutation completes.
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/settings.json', 2);
    await expect(store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' })).rejects.toThrow(
      /injected failure/,
    );
    // A subsequent mutation SUCCEEDS (its own write lands) and must not erase
    // the earlier action's recovery state.
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
      'es-419_tn',
      'v66',
      'parascriptural/x-bcvnotes',
    );
    await store.writeResources(next);
    expect(rig.repos.get(REPO)?.files.get('checking/resources.json')).toContain('es-419_tn');
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).not.toContain('rtl'); // still stale

    const store2 = restart();
    await store2.open(REPO); // pre-fix: UnexplainedDivergenceError (marker was erased)
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).toContain('rtl');
    await expectVerified(api);
  });

  it("a later mutation's inline retry heals the outstanding path without a reopen", async () => {
    const world = await setup();
    const { rig, api, store, kv } = world;
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/settings.json', 1);
    await expect(store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' })).rejects.toThrow(
      /injected failure/,
    );
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
      'es-419_tn',
      'v66',
      'parascriptural/x-bcvnotes',
    );
    await store.writeResources(next); // retries settings.json inline — and it works now
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).toContain('rtl');
    expect((await kv.keys('intent:')).length).toBe(0); // nothing outstanding
    await expectVerified(api);
  });
});

describe('#62 review round 2, P2: a resolution-only whole-file decision write reaches disk', () => {
  const NEW_RESOURCE = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', sha: sha40('es-419_tw@v37'), languageSet: 'primary' };

  it('updates the sidecar resource (no journal event), returns the md5 of what is ON DISK, and the checkpoint still passes', async () => {
    const world = await setup();
    const { rig, api, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    const before = segmentPaths(rig).length;
    const stored = await store.readDecisions('translationWords', 'TIT');
    const md5 = await store.writeDecisions('translationWords', 'TIT', {
      schemaVersion: 1,
      tool: 'translationWords',
      book: 'TIT',
      resource: NEW_RESOURCE,
      decisions: stored!.decisions, // every decision unchanged — resolution-only
    });
    expect(segmentPaths(rig)).toHaveLength(before); // derive-time state: no event
    const disk = rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '';
    expect(JSON.parse(disk).resource).toEqual(NEW_RESOURCE); // pre-fix: old resource stayed
    const { md5Hex } = await import('../src/data/httpStore');
    expect(md5).toBe(md5Hex(disk)); // success reports DISK, not a hypothetical
    await store.commit('resolution-only (tC4)');
    await expectVerified(api);
  });

  it('a crash between the durable record and the sidecar write recovers forward on reopen — with or without the marker', async () => {
    for (const loseMarker of [false, true]) {
      const world = await setup();
      const { rig, api, store, kv, restart } = world;
      await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
      const stored = await store.readDecisions('translationWords', 'TIT');
      rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/translationWords/TIT.json', 1);
      await expect(
        store.writeDecisions('translationWords', 'TIT', {
          schemaVersion: 1,
          tool: 'translationWords',
          book: 'TIT',
          resource: NEW_RESOURCE,
          decisions: stored!.decisions,
        }),
      ).rejects.toThrow(/injected failure/);
      // Port (intent ledger): loseMarker retired — the regen marker no longer
      // exists as a separate surface; the single unconditional record carries
      // the whole intent, so both loop passes now prove the same record.
      void loseMarker;
      const store2 = restart();
      await store2.open(REPO);
      expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
      const disk = rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '';
      expect(JSON.parse(disk).resource).toEqual(NEW_RESOURCE);
      expect((await kv.keys('intent:')).length).toBe(0);
      await expectVerified(api);
    }
  });

  it('a fully identical whole-file write (same decisions, same resource) is a true no-op', async () => {
    const world = await setup();
    const { rig, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    const stored = await store.readDecisions('translationWords', 'TIT');
    const before = segmentPaths(rig).length;
    const writesBefore = rig.writes.length;
    await store.writeDecisions('translationWords', 'TIT', stored!);
    expect(segmentPaths(rig)).toHaveLength(before);
    expect(rig.writes.length).toBe(writesBefore);
  });
});

// ---------------------------------------------------------------------------
// Review regression, round 3 (PR #88 review of 2026-08-20, third pass).
// ---------------------------------------------------------------------------

describe('#62 review round 3, P1: pending resolutions accumulate per key, like the regeneration marker', () => {
  const TW_NEW = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', sha: sha40('es-419_tw@v37'), languageSet: 'primary' };
  const TN_RESOLUTION = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: sha40('en_tn@v86'), languageSet: 'fallback' };
  const TN_NEW = { repoPath: 'git.door43.org/es-419_gl/es-419_tn', version: 'v66', sha: sha40('es-419_tn@v66'), languageSet: 'primary' };
  const tnDecision = (checkId: string): Decision => {
    const d = decision(checkId);
    return { ...d, contextId: { ...d.contextId, tool: 'translationNotes' } };
  };

  it("a later successful decision write does not erase an earlier write's unmaterialized resource intent (the reviewer repro)", async () => {
    for (const loseMarker of [false, true]) {
      const world = await setup();
      const { rig, api, store, kv, restart } = world;
      await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
      await store.upsertDecision('translationNotes', 'TIT', tnDecision('nota1'), TN_RESOLUTION);
      const twStale = rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json');

      // Write 1 (translationWords): EVENTFUL, with a NEW resource — publishes,
      // then its own regeneration fails. Twice: the second failure eats the
      // later write's inline retry, so the intent is still unmaterialized.
      rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/translationWords/TIT.json', 2);
      const stored = await store.readDecisions('translationWords', 'TIT');
      await expect(
        store.writeDecisions('translationWords', 'TIT', {
          schemaVersion: 1,
          tool: 'translationWords',
          book: 'TIT',
          resource: TW_NEW,
          decisions: [...stored!.decisions, decision('nuevo1', { comments: 'nueva' })],
        }),
      ).rejects.toThrow(/injected failure/);

      // Write 2 (translationNotes): a SUCCESSFUL resolution-only write for the
      // OTHER tool. Pre-fix its staging replaced write 1's pending resource and
      // its cleanup deleted the record outright.
      const tn = await store.readDecisions('translationNotes', 'TIT');
      await store.writeDecisions('translationNotes', 'TIT', { ...tn!, resource: TN_NEW });
      const tnDisk = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationNotes/TIT.json') ?? '');
      expect(tnDisk.resource).toEqual(TN_NEW);
      expect(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json')).toBe(twStale); // still stale
      expect((await kv.keys('intent:')).length).toBe(1); // write 1's intent retained

      // Port (intent ledger): loseMarker retired — the regen marker no longer
      // exists as a separate surface; write 1's single record carries both
      // the outstanding path and the resolution.
      void loseMarker;
      const store2 = restart();
      await store2.open(REPO);
      expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
      const twDisk = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
      expect(twDisk.resource).toEqual(TW_NEW); // pre-fix: the old disk-harvested resource
      expect(twDisk.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo1')).toBe(true);
      expect(JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationNotes/TIT.json') ?? '').resource).toEqual(TN_NEW);
      expect((await kv.keys('intent:')).length).toBe(0);
      await expectVerified(api);
    }
  });
});

// Review regression, round 4 (PR #88 review 4999892256).
// ---------------------------------------------------------------------------

describe('#62 review round 4: a rejected newer same-key intent does not destroy an earlier accepted resource intent', () => {
  const TW_NEW = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', sha: sha40('es-419_tw@v37'), languageSet: 'primary' };
  const TW_NEWER = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v38', sha: sha40('es-419_tw@v38'), languageSet: 'primary' };

  /** Write 1: an EVENTFUL same-key decision write with a NEW resource —
   * publishes, then its own regeneration fails, so the intent is accepted but
   * unmaterialized (the disk sidecar still carries the OLD resource). */
  const acceptedButUnmaterialized = async (world: World): Promise<Decision[]> => {
    const { rig, store } = world;
    await store.upsertDecision('translationWords', 'TIT', decision('viejo1'), RESOLUTION);
    const stored = await store.readDecisions('translationWords', 'TIT');
    rig.failOn((ctx) => ctx.method === 'POST' && ctx.ipath === 'checking/translationWords/TIT.json');
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: TW_NEW,
        decisions: [...stored!.decisions, decision('nuevo1', { comments: 'nueva' })],
      }),
    ).rejects.toThrow(/injected failure/);
    const stale = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(stale.resource).toEqual(RESOLUTION); // the state the intent must survive
    return [...stored!.decisions, decision('nuevo1', { comments: 'nueva' })];
  };

  it("a seal-REJECTED newer write leaves the earlier intent recoverable (the reviewer repro)", async () => {
    const world = await setup();
    const { rig, api, kv, store, restart } = world;
    const written = await acceptedButUnmaterialized(world);
    const segsAfterWrite1 = segmentPaths(rig);

    // Write 2, SAME key: rejected DETERMINISTICALLY at the §8.1 seal (one
    // event over the 4 MiB cap) — publish() seals before it stages, so the
    // rejected action leaves NO segment and NO outbox intent to gate on.
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: TW_NEWER,
        decisions: [...written, decision('gigante1', { comments: 'x'.repeat(4 * 1024 * 1024) })],
      }),
    ).rejects.toThrow(/4 MiB/);
    expect(segmentPaths(rig)).toEqual(segsAfterWrite1); // nothing published
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0); // nothing staged

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('regenerated-forward');
    const twDisk = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    // Pre-fix: write 2's staging OVERWROTE write 1's entry before the seal
    // rejected it; recovery dropped the T2-gated record as stale and
    // regenerated write 1's accepted decision under the OLD disk resource.
    expect(twDisk.resource).toEqual(TW_NEW);
    expect(twDisk.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo1')).toBe(true);
    expect(twDisk.decisions.some((d: Decision) => d.contextId.checkId === 'gigante1')).toBe(false);
    expect((await kv.keys('intent:')).length).toBe(0);
    await expectVerified(api);
  });

  it('a newer write that fails at the HTTP layer AFTER sealing supersedes via outbox replay (same class, durable)', async () => {
    const world = await setup();
    const { rig, api, kv, store, restart } = world;
    const written = await acceptedButUnmaterialized(world);

    // Write 2, SAME key: seals and stages, then the segment write fails —
    // durably replayable, so the NEWER resolution legitimately supersedes.
    rig.failOn((ctx) => ctx.method === 'POST' && (ctx.ipath ?? '').includes('/segments/'));
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: TW_NEWER,
        decisions: [...written, decision('nuevo2', { comments: 'segunda' })],
      }),
    ).rejects.toThrow(/injected failure/);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.replayed.map((r) => r.outcome)).toEqual(['republished']);
    const twDisk = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(twDisk.resource).toEqual(TW_NEWER); // the replayed newer action carries its own resource
    expect(twDisk.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo1')).toBe(true);
    expect(twDisk.decisions.some((d: Decision) => d.contextId.checkId === 'nuevo2')).toBe(true);
    expect((await kv.keys('intent:')).length).toBe(0);
    await expectVerified(api);
  });
});
