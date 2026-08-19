// JournalingStore contract tests — issue #62's operation-to-event mapping table,
// grouping, base/generation stamps, normalization/refusal behavior, resulting
// fold, serialization, and stale compare-and-swap. Each mutation's published
// SEGMENT BYTES are judged with the store's conformance-derived validator, and
// the on-disk derived files are judged with the fold-compare verifier.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { StaleWriteError, md5Hex } from '../src/data/httpStore';
import {
  JournalingStore,
  forgetProjectQueues,
} from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment, type JournalEvent } from '../src/data/journal/seal';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import type { Decision, DecisionFile, ResourcesFile } from '../src/data/burritoStore';
import { FAKE_VRS, journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';

const TIT_USFM = [
  '\\id TIT prueba',
  '\\usfm 3.0',
  '\\h Tito',
  '\\mt Tito',
  '\\c 1',
  '\\p',
  '\\v 1 Pablo, siervo de Dios.',
  '\\v 2 ___',
  '\\c 2',
  '\\q1',
  '\\v 1 Pero tú enseña.',
  '',
].join('\n');

const PIN = (repo: string, version: string, flavor: string) => ({
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
  resources: {
    originalLanguage: { nt: PIN('el-x-koine_ugnt', 'v0.34', 'scripture/textTranslation') },
  },
} as unknown as ResourcesFile;

const RESOLUTION = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', languageSet: 'fallback' };

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

/** Every published segment of every actor, name-sorted, with parsed events. */
const segmentsOf = async (
  rig: JournalingRig,
  repo = REPO,
): Promise<Array<{ path: string; events: JournalEvent[] }>> => {
  const project = rig.repos.get(repo);
  if (!project) return [];
  const out: Array<{ path: string; events: JournalEvent[] }> = [];
  for (const path of [...project.files.keys()].sort()) {
    if (!/^checking\/journal\/[a-z0-9-]+\/segments\//.test(path)) continue;
    const verdict = await validateSegment(project.files.get(path) ?? '');
    if (!verdict.ok) throw new Error(`test setup: invalid segment on disk ${path}: ${verdict.reason}`);
    out.push({ path, events: verdict.events });
  }
  return out;
};

const expectVerified = async (api: ServerApi, repo = REPO): Promise<void> => {
  const report = await verifyProjectAgainstJournal(api, repo);
  expect(describeVerifierReport(report), describeVerifierReport(report)).toContain('verified');
};

const setup = async (): Promise<{
  rig: JournalingRig;
  api: ServerApi;
  store: JournalingStore;
  kv: ReturnType<typeof memKv>;
  clock: ReturnType<typeof tickingNow>;
}> => {
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
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr', textFont: 'Noto Sans (default)' });
  await store.addBook({
    book_code: 'TIT',
    book_title: 'Tito',
    book_abbr: 'TIT',
    add_cv: true,
    initialUsfm: TIT_USFM,
  });
  return { rig, api, store, kv, clock };
};

describe('#62 mapping: createProject publishes the creation seed', () => {
  it('the container step runs first, then ONE seed action with the exact vrs bytes', async () => {
    const { rig, api } = await setup();
    const segments = await segmentsOf(rig);
    const seed = segments[0].events;
    expect(seed).toHaveLength(1);
    expect(seed[0].op).toBe('project.vrs.set');
    expect(seed[0].seed).toMatchObject({ source: 'creation' });
    expect(seed[0].bytes).toBe(FAKE_VRS); // exact-byte project.vrs.set
    expect(seed[0].name).toBe('eng');
    await expectVerified(api);
  });

  it('a name collision refuses before the server call; failed creation debris is cleaned', async () => {
    const { rig, api, kv, clock } = await setup();
    const store2 = new JournalingStore({ api, kv, now: () => clock.advance(7) });
    await expect(
      store2.createProject({
        content_name: 'Prueba',
        content_abbr: 'prueba',
        content_language_code: 'es',
        add_book: false,
        versification: 'eng',
      }),
    ).rejects.toThrow(/already exists/);
    // Debris cleanup: a create whose SERVER call fails deletes only its own repo.
    rig.failOn((ctx) => ctx.route.includes('new-text-translation'));
    await expect(
      store2.createProject({
        content_name: 'Otra',
        content_abbr: 'otra',
        content_language_code: 'es',
        add_book: false,
        versification: 'eng',
      }),
    ).rejects.toThrow(/injected failure/);
    expect(rig.repos.has('_local_/_local_/otra')).toBe(false);
  });
});

describe('#62 mapping: addBook is ONE self-contained book.add', () => {
  it('journals scope + skeleton + initialVerses from the REAL initial state and installs the projection', async () => {
    const { rig, api } = await setup();
    const segments = await segmentsOf(rig);
    const adds = segments.flatMap((s) => s.events).filter((e) => e.op === 'book.add');
    expect(adds).toHaveLength(1);
    expect(adds[0].book).toBe('TIT');
    expect(adds[0].scope).toEqual([]);
    expect(adds[0].base).toBeNull();
    expect(Object.keys(adds[0].initialVerses as Record<string, string>)).toEqual(['1:1', '1:2', '2:1']);
    // The derived book is the projection of the SEEDED content, not the server scaffold.
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toBe(TIT_USFM);
    await expectVerified(api);
  });

  it('without initialUsfm the server scaffold itself is journaled', async () => {
    const { rig, api, store } = await setup();
    await store.addBook({ book_code: 'JON', book_title: 'Jonás', book_abbr: 'JON', add_cv: true });
    const segments = await segmentsOf(rig);
    const add = segments.flatMap((s) => s.events).find((e) => e.op === 'book.add' && e.book === 'JON');
    expect(add).toBeDefined();
    expect(rig.repos.get(REPO)?.files.get('JON.usfm')).toContain('fake platform scaffold');
    await expectVerified(api);
  });
});

describe('#62 mapping: writeBook is a boundary adapter to explicit edit intent', () => {
  it('a verse edit emits text.verse.set for the edited slot, based on the observed head', async () => {
    const { rig, api, store } = await setup();
    const before = await segmentsOf(rig);
    const bookAddTs = before.flatMap((s) => s.events).find((e) => e.op === 'book.add')?.ts;
    await store.writeBook('TIT', TIT_USFM.replace('\\v 2 ___', '\\v 2 Nueva vida.'));
    const segments = await segmentsOf(rig);
    expect(segments).toHaveLength(before.length + 1);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0]).toMatchObject({ op: 'text.verse.set', book: 'TIT', chapter: '1', verse: '2' });
    expect(action[0].text).toContain('Nueva vida.');
    expect(action[0].base).toBe(bookAddTs); // the slot head created by book.add — never rootless (R-8.5.15)
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');
    await expectVerified(api);
  });

  it('a multi-verse save is ONE action (one segment), events sharing a batch (R-8.4.6)', async () => {
    const { rig, api, store } = await setup();
    const before = (await segmentsOf(rig)).length;
    await store.writeBook(
      'TIT',
      TIT_USFM.replace('\\v 2 ___', '\\v 2 Nueva vida.').replace('Pero tú enseña.', 'Pero tú enseña bien.'),
    );
    const segments = await segmentsOf(rig);
    expect(segments).toHaveLength(before + 1);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(2);
    expect(new Set(action.map((e) => e.batch))).toEqual(new Set([action[0].ts]));
    await expectVerified(api);
  });

  it('a slot-preserving header change emits text.skeleton.set; a topology change is REFUSED toward applyStructuralEdit', async () => {
    const { rig, api, store } = await setup();
    await store.writeBook('TIT', TIT_USFM.replace('\\h Tito', '\\h Tito Nuevo'));
    let segments = await segmentsOf(rig);
    const last = segments[segments.length - 1].events;
    expect(last).toHaveLength(1);
    expect(last[0].op).toBe('text.skeleton.set');

    const diskBefore = rig.repos.get(REPO)?.files.get('TIT.usfm');
    const countBefore = segments.length;
    await expect(
      store.writeBook('TIT', `${TIT_USFM}\\v 2 añadido\n`),
    ).rejects.toThrow(/applyStructuralEdit/);
    segments = await segmentsOf(rig);
    expect(segments).toHaveLength(countBefore); // nothing published
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toBe(diskBefore); // nothing written
    await expectVerified(api);
  });

  it('an identical write publishes nothing (diff-based idempotence)', async () => {
    const { rig, api, store } = await setup();
    const before = (await segmentsOf(rig)).length;
    await store.writeBook('TIT', TIT_USFM);
    expect(await segmentsOf(rig)).toHaveLength(before);
    await expectVerified(api);
  });

  it('writeBook on a book the journal does not project is refused (creation goes through addBook)', async () => {
    const { store } = await setup();
    await expect(store.writeBook('JON', TIT_USFM.replaceAll('TIT', 'JON'))).rejects.toThrow(/addBook/);
  });
});

describe('#62 mapping: applyStructuralEdit is ONE complete text.structure.apply', () => {
  it('publishes the full transition/disposition set (no seed marker) and the fold accepts it', async () => {
    const { rig, api, store } = await setup();
    // Renumber: split 2:1 into 2:1-2 (a span) — a slot-set change.
    const edited = TIT_USFM.replace('\\v 1 Pero tú enseña.', '\\v 1-2 Pero tú enseña.');
    await store.applyStructuralEdit('TIT', edited);
    const segments = await segmentsOf(rig);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0].op).toBe('text.structure.apply');
    expect(action[0].seed).toBeUndefined(); // an in-app action is not migrated data
    expect(Object.keys(action[0].transitions as Record<string, unknown>).sort()).toEqual([
      '1:1',
      '1:2',
      '2:1-2',
    ]);
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toBe(edited);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    expect(report.foldReports.pendingStructural).toEqual([]); // accepted, not pended
  });
});

describe('#62 mapping: writeAlignments diffs the affected records', () => {
  const alignmentRecord = (occ: number | string) => ({
    alignments: [
      {
        topWords: [{ word: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N,,,,,NMS,', occurrence: occ, occurrences: occ }],
        bottomWords: [{ word: 'Pablo', occurrence: occ, occurrences: occ }],
      },
    ],
    wordBank: [{ word: 'siervo', occurrence: occ, occurrences: occ }],
    targetVerseMd5: md5Hex('Pablo, siervo de Dios.'),
    sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
  });

  it('publishes one action of changed align.verse.set events with generation + observed base, I-2 normalized', async () => {
    const { rig, api, store } = await setup();
    const bookAddTs = (await segmentsOf(rig)).flatMap((s) => s.events).find((e) => e.op === 'book.add')?.ts;
    // Parser-shaped STRING occurrences on purpose: the boundary normalizes (I-2).
    await store.writeAlignments('TIT', {
      schemaVersion: 1,
      book: 'TIT',
      chapters: { '1': { '1': alignmentRecord('1') as never } },
    });
    let segments = await segmentsOf(rig);
    let action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0]).toMatchObject({ op: 'align.verse.set', book: 'TIT', chapter: '1', verse: '1' });
    expect(action[0].generation).toBe(bookAddTs);
    expect(action[0].base).toBeNull(); // a first write is ordinary, anchored by generation
    const words = (action[0].alignments as Array<{ topWords: Array<{ occurrence: unknown }> }>)[0];
    expect(words.topWords[0].occurrence).toBe(1); // I-2: integers on the wire
    const firstTs = action[0].ts;

    // A second write of the same verse observes the live head.
    await store.writeAlignments('TIT', {
      schemaVersion: 1,
      book: 'TIT',
      chapters: { '1': { '1': { ...alignmentRecord(1), wordBank: [] } as never } },
    });
    segments = await segmentsOf(rig);
    action = segments[segments.length - 1].events;
    expect(action[0].base).toBe(firstTs);
    await expectVerified(api);
  });

  it('a record that disappears from the file publishes the DEFINED removal: an explicit empty record', async () => {
    const { rig, api, store } = await setup();
    await store.writeAlignments('TIT', {
      schemaVersion: 1,
      book: 'TIT',
      chapters: { '1': { '1': alignmentRecord(1) as never } },
    });
    await store.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: {} });
    const segments = await segmentsOf(rig);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0].alignments).toEqual([]);
    expect(action[0].wordBank).toEqual([]);
    // Projected as a record, not absence (R-8.5.11):
    const sidecar = JSON.parse(rig.repos.get(REPO)?.files.get('checking/alignments/TIT.json') ?? '');
    expect(sidecar.chapters['1']['1']).toMatchObject({ alignments: [], wordBank: [] });
    // …and the diff treats the empty state as removal-idempotent:
    const count = segments.length;
    await store.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: {} });
    expect(await segmentsOf(rig)).toHaveLength(count);
    await expectVerified(api);
  });

  it('a stale compare-and-swap is rejected before anything publishes', async () => {
    const { rig, store } = await setup();
    const count = (await segmentsOf(rig)).length;
    await expect(
      store.writeAlignments(
        'TIT',
        { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': alignmentRecord(1) as never } } },
        '不-a-real-md5',
      ),
    ).rejects.toThrow(StaleWriteError);
    expect(await segmentsOf(rig)).toHaveLength(count);
  });
});

describe('#62 mapping: upsertDecision is one check.decision.set', () => {
  it('preserves identity exactly, stamps generation, and the file mirrors the fold', async () => {
    const { rig, api, store } = await setup();
    const bookAddTs = (await segmentsOf(rig)).flatMap((s) => s.events).find((e) => e.op === 'book.add')?.ts;
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    const segments = await segmentsOf(rig);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0]).toMatchObject({ op: 'check.decision.set', toolId: 'translationWords' });
    expect(action[0].generation).toBe(bookAddTs);
    expect((action[0].decision as Decision).contextId.quote).toBe('Θεοῦ'); // identity untouched
    const file = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.resource).toEqual(RESOLUTION);
    expect(file.decisions).toHaveLength(1);
    await expectVerified(api);
  });

  it('REFUSES a non-NFC identity value (never rewritten — R-8.5.13), publishing nothing', async () => {
    const { rig, store } = await setup();
    const count = (await segmentsOf(rig)).length;
    const nfd = 'café'; // 'café' in NFD — an identity value must be refused, not normalized
    await expect(
      store.upsertDecision('translationWords', 'TIT', decision(nfd), RESOLUTION),
    ).rejects.toThrow(/I-4/);
    expect(await segmentsOf(rig)).toHaveLength(count);
    expect(rig.repos.get(REPO)?.files.has('checking/translationWords/TIT.json')).toBe(false);
  });

  it('REFUSES a key match whose quoteString differs (the resource changed — §5.2)', async () => {
    const { store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    await expect(
      store.upsertDecision(
        'translationWords',
        'TIT',
        decision('t1g7', {
          contextId: { ...decision('t1g7').contextId, quote: 'Κύριος', quoteString: 'Κύριος' },
        }),
        RESOLUTION,
      ),
    ).rejects.toThrow(/quoteString/);
  });

  it('an identical decision publishes nothing; a decision write never relabels the file to another resource', async () => {
    const { rig, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    const count = (await segmentsOf(rig)).length;
    await store.upsertDecision('translationWords', 'TIT', decision('t1g7'), RESOLUTION);
    expect(await segmentsOf(rig)).toHaveLength(count);
    // A DIFFERENT resolution on a later upsert does not relabel (agree-only rule).
    await store.upsertDecision(
      'translationWords',
      'TIT',
      decision('t1g7', { comments: 'nota' }),
      { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37' },
    );
    const file = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(file.resource).toEqual(RESOLUTION);
  });
});

describe('#62 mapping: writeDecisions diffs ALL records as one action', () => {
  it('a disappeared identity key is invalidated-and-retained (never deleted), preserving a user "todo"', async () => {
    const { rig, api, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('keep'), RESOLUTION);
    await store.upsertDecision('translationWords', 'TIT', decision('drop', { status: 'todo' }), RESOLUTION);
    const before = (await segmentsOf(rig)).length;
    const file: DecisionFile = {
      schemaVersion: 1,
      tool: 'translationWords',
      book: 'TIT',
      resource: RESOLUTION,
      decisions: [decision('keep', { comments: 'actualizada' })],
    };
    await store.writeDecisions('translationWords', 'TIT', file);
    const segments = await segmentsOf(rig);
    expect(segments).toHaveLength(before + 1); // ONE action
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(2);
    const dropped = action
      .map((e) => e.decision as Decision)
      .find((d) => d.contextId.checkId === 'drop');
    expect(dropped).toMatchObject({ invalidated: true, status: 'todo' }); // §5.2/D36: todo stands
    const sidecar = JSON.parse(rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '');
    expect(sidecar.decisions).toHaveLength(2); // retained, not deleted
    await expectVerified(api);
  });
});

describe('#62 mapping: writeResources and writeSettings diff per register', () => {
  it('pins: changed slots publish resource.pin.set; a removed slot publishes removed: true', async () => {
    const { rig, api, store } = await setup();
    const before = (await segmentsOf(rig)).length;
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
      'es-419_tn',
      'v66',
      'parascriptural/x-bcvnotes',
    );
    delete (next as { resources?: unknown }).resources;
    await store.writeResources(next);
    const segments = await segmentsOf(rig);
    expect(segments).toHaveLength(before + 1);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(2);
    expect(action.find((e) => e.slot === 'languageSets.primary.translationNotes')?.entry).toMatchObject({
      repoPath: 'git.door43.org/unfoldingWord/es-419_tn',
    });
    expect(action.find((e) => e.slot === 'resources.originalLanguage.nt')?.removed).toBe(true);
    const doc = JSON.parse(rig.repos.get(REPO)?.files.get('checking/resources.json') ?? '');
    expect(doc.resources).toBeUndefined(); // removal folds to absence
    await expectVerified(api);
  });

  it('settings: changed paths publish settings.set; a dropped top-level path removes', async () => {
    const { rig, api, store } = await setup();
    const before = (await segmentsOf(rig)).length;
    await store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' }); // textFont dropped
    const segments = await segmentsOf(rig);
    expect(segments).toHaveLength(before + 1);
    const action = segments[segments.length - 1].events;
    expect(action.find((e) => e.path === 'textDirection')?.value).toBe('rtl');
    expect(action.find((e) => e.path === 'textFont')?.removed).toBe(true);
    const doc = JSON.parse(rig.repos.get(REPO)?.files.get('checking/settings.json') ?? '');
    expect(doc.textFont).toBeUndefined();
    expect(doc.textDirection).toBe('rtl');
    await expectVerified(api);
  });
});

describe('#62 mapping: project metadata writes and the checkpoint', () => {
  it('writeProjectMeta journals project.meta.set diffs; commit() then refuses because the platform cannot materialize the overlay (D28)', async () => {
    const { rig, store } = await setup();
    await store.commit('pre-meta checkpoint'); // sanity: checkpoints work before
    await store.writeProjectMeta({ 'identification.abbreviation.es': 'PRB' });
    const segments = await segmentsOf(rig);
    const action = segments[segments.length - 1].events;
    expect(action).toHaveLength(1);
    expect(action[0]).toMatchObject({ op: 'project.meta.set', path: 'identification.abbreviation.es' });
    await expect(store.commit('post-meta checkpoint')).rejects.toThrow(/no HTTP metadata write route/);
  });

  it('commit() runs the full checkpoint pipeline: rescan, scope verification, then the server commit', async () => {
    const { rig, api, store } = await setup();
    await store.writeBook('TIT', TIT_USFM.replace('\\v 2 ___', '\\v 2 Nueva vida.'));
    await store.commit('checkpoint (tC4)');
    const project = rig.repos.get(REPO);
    expect(project?.commits).toContain('checkpoint (tC4)');
    const scope = (project?.meta.type as { flavorType: { currentScope: unknown } }).flavorType.currentScope;
    expect(scope).toEqual({ TIT: [] }); // reconstructed by the rescan, verified against the fold
    await expectVerified(api);
  });

  it('commit() REFUSES an out-of-band edit rather than silently repairing it (R-8.7.5)', async () => {
    const { rig, store } = await setup();
    const project = rig.repos.get(REPO);
    project?.files.set('checking/settings.json', '{"schemaVersion":1,"tampered":true}');
    await expect(store.commit('checkpoint')).rejects.toThrow(/out-of-band/);
    // Nothing repaired:
    expect(project?.files.get('checking/settings.json')).toContain('tampered');
  });
});

describe('#62 serialization: one per-project queue', () => {
  it('same-project concurrent mutations serialize and the later one uses the observed live head', async () => {
    const { rig, store } = await setup();
    await Promise.all([
      store.upsertDecision('translationWords', 'TIT', decision('t1g7', { comments: 'primera' }), RESOLUTION),
      store.upsertDecision('translationWords', 'TIT', decision('t1g7', { comments: 'segunda' }), RESOLUTION),
    ]);
    const segments = await segmentsOf(rig);
    const decisions = segments.flatMap((s) => s.events).filter((e) => e.op === 'check.decision.set');
    expect(decisions).toHaveLength(2);
    expect(decisions[1].base).toBe(decisions[0].ts); // the observed LIVE head, not a snapshot
  });

  it('different projects do not block one another', async () => {
    const { rig, api, kv, clock, store } = await setup();
    // A second project whose next segment write is HELD; the first project's
    // mutation must complete while the second is still in flight.
    const store2 = new JournalingStore({ api, kv, now: () => clock.advance(11) });
    await store2.createProject({
      content_name: 'Otra',
      content_abbr: 'otra',
      content_language_code: 'es',
      add_book: false,
      versification: 'eng',
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'POST' && url.includes('otra') && url.includes('segments'))
        await gate;
      return rig.fetchFn(input, init);
    };
    const gatedApi = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: gatedFetch });
    const gatedStore = new JournalingStore({ api: gatedApi, kv, now: () => clock.advance(17) });
    await gatedStore.open('_local_/_local_/otra');
    const slow = gatedStore.writeSettings({ schemaVersion: 1, textDirection: 'rtl' });
    // The OTHER project proceeds while 'otra' is blocked mid-publication.
    await store.writeSettings({ schemaVersion: 1, textDirection: 'rtl', textFont: 'Charis SIL' });
    release();
    await slow;
    await expectVerified(api);
    await expectVerified(api, '_local_/_local_/otra');
  });
});
