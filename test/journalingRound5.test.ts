// Round-5 review regressions (LENS A antagonistic review, 2026-08-22) — the
// INTERIM ordering rules over the journaling boundary. Root cause: a failed or
// killed publish leaves durable intent in the outbox, and the mechanism around
// it violated four order-of-operations rules:
//   1. REPLAY-BEFORE-DIFF — a mutation must replay this actor's own staged
//      outbox intents and refresh the fold BEFORE it computes its diff.
//   2. The recovery classifier composes over fresh republication and the regen
//      marker — reconcile must never consume a path either already explains.
//   3. The in-memory resolution register is stamped AFTER acceptance only.
//   4. An inline marker retry reads DURABLE candidate state, never the
//      in-memory register.
// Manifestations M1–M5 were red against commit 9e209bd; the held hand attacks
// stay as regression guards. Adapted from the executed lensA review tests.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment } from '../src/data/journal/seal';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import type { Decision, DecisionFile, ResourcesFile } from '../src/data/burritoStore';
import type { KvStore } from '../src/data/journal/identity';
import {
  journalingRig,
  memKv,
  tickingNow,
  FAKE_VRS,
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

// D58: a §5.3 pin carries its sha identity.
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
  languageSet: 'fallback',
};
const RES_B = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v37',
  languageSet: 'primary',
};
const RES_C = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v38',
  languageSet: 'primary',
};
const RES_D = {
  repoPath: 'git.door43.org/es-419_gl/es-419_tw',
  version: 'v39',
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
    modifiedTimestamp: '2026-08-22T12:00:00.000Z',
  }) as unknown as Decision;

const segmentPaths = (rig: JournalingRig, repo = REPO): string[] =>
  [...(rig.repos.get(repo)?.files.keys() ?? [])]
    .filter((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p))
    .sort();

const journalBytes = (rig: JournalingRig, repo = REPO): string =>
  segmentPaths(rig, repo)
    .map((p) => rig.repos.get(repo)?.files.get(p) ?? '')
    .join('\n');

const setup = async () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-08-22T09:00:00.000Z');
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

describe('round 5 M1: failed publish + later success + restart must not brick open()', () => {
  it('the later mutation replays the staged intent; open() converges and conserves both', async () => {
    const { rig, kv, store, restart } = await setup();

    // A settings publish fails at the segment HTTP write: the sealed action
    // stays in the durable outbox (R-8.1.8) — accepted intent, not yet journal.
    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    await expect(store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' })).rejects.toThrow(
      /injected failure/,
    );
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // A later, unrelated mutation succeeds — under rule 1 it must FIRST replay
    // the staged intent and refresh the fold, then diff.
    await store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'));
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');

    // Restart + open: MUST NOT refuse — both accepted intents are conserved.
    const store2 = restart();
    await store2.open(REPO);
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).toContain('rtl');
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');

    // The health is stable: a further open converges quietly.
    const store3 = restart();
    await store3.open(REPO);
    expect(store3.lastOpenReport?.classification).toBe('converged');
  });
});

describe('round 5 M2: an accepted decision intent is conserved (no silent intent loss)', () => {
  it('failed decision publish + later success + restart: journaled ⇒ on disk or still pending', async () => {
    const { rig, kv, store, restart } = await setup();

    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    await expect(
      store.upsertDecision('translationWords', 'TIT', decision('perdida1'), RESOLUTION),
    ).rejects.toThrow(/injected failure/);

    // Later unrelated success in the same session (its cleanup must NOT prune
    // the failed publish's resolution candidate — root cause b).
    await store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' });

    const store2 = restart();
    await store2.open(REPO);

    // CONSERVATION ORACLE: an accepted-into-the-journal intent must either be
    // on disk or still pending. Neither is round 5.
    const acceptedIntoJournal = journalBytes(rig).includes('perdida1');
    const diskFile = rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json');
    const onDisk = diskFile !== undefined && diskFile.includes('perdida1');
    const pendingLeft = (await kv.keys('intent:')).length;
    expect(acceptedIntoJournal).toBe(true);
    expect(onDisk || pendingLeft > 0).toBe(true);

    // The project must still verify and checkpoint.
    const report = await verifyProjectAgainstJournal(store2.api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    await store2.commit('after recovery (tC4)');
  });
});

describe('round 5 M3: reconcile must never revert an accepted edit (silent revert)', () => {
  it('journal-ahead TIT (marker-known) + pre-journal GAL scaffold: the edit survives', async () => {
    const { rig, kv, store, restart } = await setup();

    // (1) The user's edit publishes; its regeneration fails — journal-ahead,
    // recorded in the durable marker exactly as designed.
    rig.failOn((c) => c.method === 'POST' && c.ipath === 'TIT.usfm', 1);
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow(
      /injected failure/,
    );
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).not.toContain('Nueva vida.'); // stale disk

    // (2) addBook: the process is KILLED between the server scaffold POST and
    // the durable outbox stage — GAL.usfm on disk, NO outbox intent, NO
    // segment. (Emulated by failing the segment write and clearing the staged
    // intent: same surviving kv + disk.)
    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    await expect(
      store.addBook({ book_code: 'GAL', book_title: 'Gal', book_abbr: 'GAL', add_cv: true }),
    ).rejects.toThrow(/injected failure/);
    expect(rig.repos.get(REPO)?.files.has('GAL.usfm')).toBe(true); // pre-journal scaffold
    for (const key of await kv.keys('outbox:')) await kv.delete(key); // kill was BEFORE the stage

    // Restart + open: GAL is reconciled; TIT (marker-explained journal-ahead)
    // is regenerated FORWARD — never re-journaled from its stale disk bytes.
    const store2 = restart();
    await store2.open(REPO);

    let sawEdit = false;
    let sawSupersede = false;
    for (const p of segmentPaths(rig)) {
      const verdict = await validateSegment(rig.repos.get(REPO)?.files.get(p) ?? '');
      if (!verdict.ok) continue;
      for (const e of verdict.events) {
        if (e.op === 'text.verse.set' && String(e.text ?? '').includes('Nueva vida'))
          sawEdit = true;
        if (
          e.op === 'text.verse.set' &&
          (e as { book?: string }).book === 'TIT' &&
          (e.seed as { source?: string } | undefined)?.source === 'out-of-band-usfm' &&
          !String(e.text ?? '').includes('Nueva vida')
        )
          sawSupersede = true;
      }
    }
    const disk = rig.repos.get(REPO)?.files.get('TIT.usfm') ?? '';
    // Conservation: the accepted edit survives recovery; the stale disk bytes
    // were never journaled as a superseding user edit (M3's signature was
    // acceptedEditInJournal true / editOnDisk false / verifier green).
    expect(sawEdit).toBe(true);
    expect(sawSupersede).toBe(false);
    expect(disk).toContain('Nueva vida.');
    const report = await verifyProjectAgainstJournal(store2.api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

describe('round 5 M4: a seal-rejected whole-file write must not poison the register', () => {
  it('the next upsert publishes under the ACCEPTED resource, not the rejected one', async () => {
    const { rig, store } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    // A whole-file write that the SEAL refuses (oversize action, R-8.1.9): its
    // resource intent (RES_D) was never accepted anywhere.
    const stored = (await store.readDecisions('translationWords', 'TIT'))!;
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RES_D as never,
        decisions: [...stored.decisions, decision('gorda1', 'x'.repeat(5 * 1024 * 1024))],
      } as unknown as DecisionFile),
    ).rejects.toThrow(/4 MiB/);

    // The next upsert (no resource passed — the register is its only source)
    // must publish under the last ACCEPTED resource.
    await store.upsertDecision('translationWords', 'TIT', decision('base2'));
    const doc = JSON.parse(
      rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '{}',
    ) as { resource?: { repoPath?: string; version?: string } };
    expect(doc.resource?.repoPath).toBe(RESOLUTION.repoPath);
    expect(doc.resource?.version).toBe(RESOLUTION.version);
    const report = await verifyProjectAgainstJournal(store.api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

describe('round 5 M5: an inline marker retry reads durable candidates, never the register', () => {
  it('two accepted regen-failed candidates + a seal-rejected re-stamp: the pins write retries under the last ACCEPTED resource', async () => {
    const { rig, kv, store } = await setup();
    const DEC_IPATH = 'checking/translationWords/TIT.json';
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);

    const fileWith = (resource: unknown, ids: string[]): DecisionFile =>
      ({
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource,
        decisions: [decision('base1'), ...ids.map((id) => decision(id))],
      }) as unknown as DecisionFile;

    // Candidate B: accepted (published), regeneration fails — outstanding.
    rig.failOn((c) => c.method === 'POST' && c.ipath === DEC_IPATH, 1);
    await expect(
      store.writeDecisions('translationWords', 'TIT', fileWith(RES_B, ['cand1'])),
    ).rejects.toThrow(/injected failure/);
    // Candidate C: accepted (published), regeneration fails again — outstanding.
    rig.failOn((c) => c.method === 'POST' && c.ipath === DEC_IPATH, 1);
    await expect(
      store.writeDecisions('translationWords', 'TIT', fileWith(RES_C, ['cand1', 'cand2'])),
    ).rejects.toThrow(/injected failure/);
    // Port (intent ledger): one record per outstanding intent (B and C), where
    // the retired marker was one accumulated set.
    expect((await kv.keys('intent:')).length).toBe(2); // the path is outstanding
    // A seal-REJECTED write re-stamps nothing durable: RES_D was never accepted.
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        ...(fileWith(RES_D, ['cand1', 'cand2']) as object),
        decisions: [
          ...(fileWith(RES_D, ['cand1', 'cand2']) as unknown as { decisions: Decision[] })
            .decisions,
          decision('gorda1', 'x'.repeat(5 * 1024 * 1024)),
        ],
      } as unknown as DecisionFile),
    ).rejects.toThrow(/4 MiB/);

    // An unrelated pins write succeeds; its INLINE RETRY of the outstanding
    // decision path must materialize under the last ACCEPTED candidate (C) —
    // never under a rejected in-memory stamp (D).
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
      'es-419_tn',
      'v66',
      'parascriptural/x-bcvnotes',
    );
    await store.writeResources(next);

    const doc = JSON.parse(rig.repos.get(REPO)?.files.get(DEC_IPATH) ?? '{}') as {
      resource?: { repoPath?: string; version?: string };
      decisions?: Array<{ contextId: { checkId: string } }>;
    };
    expect(doc.resource?.repoPath).toBe(RES_C.repoPath);
    expect(doc.resource?.version).toBe(RES_C.version);
    const ids = (doc.decisions ?? []).map((d) => d.contextId.checkId);
    expect(ids).toContain('cand1');
    expect(ids).toContain('cand2');
    const report = await verifyProjectAgainstJournal(store.api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The round-5 HELD hand attacks — kept as regression guards (adapted to the
// interim rules' invariants where rule 1 changes the intermediate state).
// ---------------------------------------------------------------------------

describe('round 5 held guard: marker + outbox states compose in the classifier', () => {
  it('an old outstanding regen path plus a replayed outbox action recovers forward', async () => {
    const { rig, kv, store, restart } = await setup();
    // Mutation A: publishes, then its settings regeneration fails TWICE — its
    // own install and mutation B's inline retry — so checking/settings.json is
    // still outstanding in the marker when C runs.
    rig.failOn((c) => c.method === 'POST' && c.ipath === 'checking/settings.json', 2);
    await expect(store.writeSettings({ schemaVersion: 1, textDirection: 'rtl' })).rejects.toThrow(
      /injected failure/,
    );
    // Mutation B: a MATERIALIZED success between the two unmaterialized ones.
    const next = JSON.parse(JSON.stringify(PINS)) as ResourcesFile;
    (next.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
      'es-419_tn',
      'v66',
      'parascriptural/x-bcvnotes',
    );
    await store.writeResources(next);
    // Mutation C: seals + stages, then the SEGMENT write fails — the action
    // stays in the outbox, unpublished, its paths never marked.
    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    await expect(store.writeBook('TIT', TIT_USFM.replace('___', 'Nueva vida.'))).rejects.toThrow(
      /injected failure/,
    );
    // Port (intent ledger): A's record is live (accepted, unmaterialized) and
    // C's record is appended-but-ungated (its action sits in the outbox).
    expect((await kv.keys('intent:')).length).toBe(2); // the intents survive
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(1);

    // Restart + open: the replayed action's paths and the marker's paths are
    // BOTH journal-ahead — recovered forward, both intents conserved.
    const store2 = restart();
    await store2.open(REPO);
    expect(rig.repos.get(REPO)?.files.get('checking/settings.json')).toContain('rtl');
    expect(rig.repos.get(REPO)?.files.get('TIT.usfm')).toContain('Nueva vida.');
    const store3 = restart();
    await store3.open(REPO);
    expect(store3.lastOpenReport?.classification).toBe('converged');
  });
});

describe('round 5 held guard: causal order under replay of an older same-key action', () => {
  it('older outbox decision action + newer same-key success: conserved, verifier green', async () => {
    const { rig, kv, store, restart } = await setup();
    await store.upsertDecision('translationWords', 'TIT', decision('base1'), RESOLUTION);
    // W1: same-key decision write, publish FAILS at the segment write — the
    // outbox holds the intent.
    rig.failOn((c) => c.method === 'POST' && (c.ipath ?? '').includes('/segments/'), 1);
    const before = await store.readDecisions('translationWords', 'TIT');
    await expect(
      store.writeDecisions('translationWords', 'TIT', {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource: RES_B as never,
        decisions: [...before!.decisions, decision('w1solo', 'w1')],
      } as unknown as DecisionFile),
    ).rejects.toThrow(/injected failure/);
    // W2: same-key decision write built from the STALE disk file (the app
    // reads disk) — under rule 1 it replays W1 FIRST, so W1's action is in the
    // fold before W2 diffs: w1solo is invalidated-and-retained, never lost.
    const stale = await store.readDecisions('translationWords', 'TIT');
    await store.writeDecisions('translationWords', 'TIT', {
      schemaVersion: 1,
      tool: 'translationWords',
      book: 'TIT',
      resource: RESOLUTION as never,
      decisions: [...stale!.decisions, decision('w2solo', 'w2')],
    } as unknown as DecisionFile);
    expect((await kv.keys('outbox:')).filter((k) => k.includes(REPO))).toHaveLength(0); // replayed

    // Conservation: w1solo is journaled AND on disk (retained), w2solo lives.
    expect(journalBytes(rig)).toContain('w1solo');
    const disk = rig.repos.get(REPO)?.files.get('checking/translationWords/TIT.json') ?? '';
    expect(disk).toContain('w1solo');
    expect(disk).toContain('w2solo');
    const report = await verifyProjectAgainstJournal(store.api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);

    const store2 = restart();
    await store2.open(REPO);
    expect(store2.lastOpenReport?.classification).toBe('converged');
  });
});

describe('round 5 held guard: kill sweep over the universal seed of a legacy project', () => {
  const legacyProject = (rig: JournalingRig, name: string): string => {
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

  class Killed extends Error {}
  interface KS {
    enabled: boolean;
    budget: number;
    dead: boolean;
    count: number;
  }
  const consume = (ks: KS): void => {
    if (!ks.enabled) return;
    if (ks.dead || ks.count >= ks.budget) {
      ks.dead = true;
      throw new Killed();
    }
    ks.count += 1;
  };
  const guard = (ks: KS): void => {
    if (ks.enabled && ks.dead) throw new Killed();
  };
  const world = (
    budget: number,
  ): {
    rig: JournalingRig;
    ks: KS;
    kv: KvStore;
    api: ServerApi;
    clock: ReturnType<typeof tickingNow>;
  } => {
    forgetSharedClocks();
    forgetProjectQueues();
    const rig = journalingRig();
    const inner = memKv();
    const ks: KS = { enabled: true, budget, dead: false, count: 0 };
    const kv: KvStore = {
      get: async (k) => (guard(ks), inner.get(k)),
      set: async (k, v) => (consume(ks), inner.set(k, v)),
      setIfAbsent: async (k, v) => (consume(ks), inner.setIfAbsent(k, v)),
      keys: async (p) => (guard(ks), inner.keys(p)),
      delete: async (k) => (consume(ks), inner.delete(k)),
    };
    const clock = tickingNow('2026-08-22T09:00:00.000Z');
    const api = new ServerApi({
      baseUrl: 'http://rig.test/api',
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') guard(ks);
        else consume(ks);
        return rig.fetchFn(input, init);
      }) as typeof fetch,
    });
    return { rig, ks, kv, api, clock };
  };

  it(
    'open() killed at EVERY durable boundary, reopened: seed completes, bytes conserved',
    { timeout: 120_000 },
    async () => {
      // First, measure the durable-op count of an unkilled seed.
      const m = world(Number.MAX_SAFE_INTEGER);
      const repoM = legacyProject(m.rig, 'legado');
      await new JournalingStore({ api: m.api, kv: m.kv, now: () => m.clock.advance(13) }).open(
        repoM,
      );
      const total = m.ks.count;
      expect(total).toBeGreaterThan(3);

      const outcomes: string[] = [];
      for (let k = 1; k <= total; k += 1) {
        const w = world(k);
        const repo = legacyProject(w.rig, 'legado');
        const usfmBefore = w.rig.repos.get(repo)?.files.get('TIT.usfm');
        const store = new JournalingStore({ api: w.api, kv: w.kv, now: () => w.clock.advance(13) });
        const first = await store.open(repo).then(
          () => 'ok',
          (e: unknown) => (e instanceof Killed ? 'killed' : `FAIL:${String(e).slice(0, 160)}`),
        );
        if (first.startsWith('FAIL')) {
          outcomes.push(`k=${k} first ${first}`);
          continue;
        }
        // Recover on a live process.
        w.ks.enabled = false;
        forgetSharedClocks();
        forgetProjectQueues();
        const store2 = new JournalingStore({
          api: w.api,
          kv: w.kv,
          now: () => w.clock.advance(29),
        });
        const second = await store2.open(repo).then(
          () => 'ok',
          (e: unknown) => `FAIL:${String(e).slice(0, 200)}`,
        );
        if (second !== 'ok') {
          outcomes.push(`k=${k} second ${second}`);
          continue;
        }
        // Conservation: precious bytes unchanged, verifier green, third open quiet.
        if (w.rig.repos.get(repo)?.files.get('TIT.usfm') !== usfmBefore)
          outcomes.push(`k=${k} TIT.usfm bytes changed`);
        const report = await verifyProjectAgainstJournal(w.api, repo);
        if (!report.ok)
          outcomes.push(`k=${k} verify: ${describeVerifierReport(report).slice(0, 200)}`);
        forgetSharedClocks();
        forgetProjectQueues();
        const store3 = new JournalingStore({
          api: w.api,
          kv: w.kv,
          now: () => w.clock.advance(31),
        });
        await store3.open(repo);
        if (
          store3.lastOpenReport?.classification !== 'converged' &&
          store3.lastOpenReport?.classification !== 'seeded'
        )
          outcomes.push(`k=${k} third open ${store3.lastOpenReport?.classification}`);
      }
      expect(outcomes, outcomes.slice(0, 6).join('\n')).toEqual([]);
    },
  );
});
