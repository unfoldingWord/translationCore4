// The interleaving generator gate (issue #62, round 6) — property harness
// over JournalingStore with a fake backend, injected failures, and a
// PROCESS-KILL sweep at every durable mutation boundary (including inside
// open() recovery). Adapted from the executed LENS A review harness; the
// intent-ledger recovery design must hold it at ZERO violations, WITH the
// round-5 segment-publish fault class enabled (the review ran that class in a
// separate demonstration suite because the old machinery was known to fail it).
//
// The oracle: journal conservation, fold-compare (the advertised verifier),
// per-step accepted/completed/rejected conservation, the resolution
// allowed-set, and second-open idempotence.
//
// In-suite: a fixed seed and a CI-sized sweep (LENSA_SEEDS/LENSA_SEQ scale it
// up to the full campaign: LENSA_SEEDS=11,23,47 LENSA_SEQ=150).
//
// A "kill" freezes durable state at the boundary: after budget exhaustion,
// EVERY kv operation and EVERY fetch throws Killed — catch/finally handlers in
// the store cannot write anything more, which is exactly what a dead process
// cannot do. The in-memory store object is then abandoned, module clocks and
// queues are dropped, and a fresh store recovers over the surviving kv + disk.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import type { Decision, DecisionFile, ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';
import type { KvStore } from '../src/data/journal/identity';

const REPO = '_local_/_local_/prueba';

// ---------------------------------------------------------------------------
// PRNG (mulberry32) — deterministic sequences per (seed, index).
// ---------------------------------------------------------------------------
const mulberry32 = (a: number) => (): number => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class Killed extends Error {
  constructor() {
    super('KILLED: process died at a durable-op boundary');
  }
}

/** Kill switch shared by the kv wrapper and the fetch wrapper. */
interface KillState {
  enabled: boolean;
  budget: number; // durable mutations allowed before death
  dead: boolean;
  count: number; // durable mutations performed while enabled
}

const consume = (ks: KillState): void => {
  if (!ks.enabled) return;
  if (ks.dead) throw new Killed();
  if (ks.count >= ks.budget) {
    ks.dead = true;
    throw new Killed();
  }
  ks.count += 1;
};
const guardRead = (ks: KillState): void => {
  if (ks.enabled && ks.dead) throw new Killed();
};

const killableKv = (inner: KvStore & { map: Map<string, string> }, ks: KillState): KvStore => ({
  get: async (k) => {
    guardRead(ks);
    return inner.get(k);
  },
  set: async (k, v) => {
    consume(ks);
    return inner.set(k, v);
  },
  setIfAbsent: async (k, v) => {
    consume(ks);
    return inner.setIfAbsent(k, v);
  },
  keys: async (p) => {
    guardRead(ks);
    return inner.keys(p);
  },
  delete: async (k) => {
    consume(ks);
    return inner.delete(k);
  },
});

const killableFetch = (innerFetch: typeof fetch, ks: KillState): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') guardRead(ks);
    else consume(ks);
    return innerFetch(input, init);
  }) as typeof fetch;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
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
const basePins = (): ResourcesFile =>
  ({
    schemaVersion: 2,
    languageSets: { primary: JSON.parse(JSON.stringify(RUNG)), fallback: JSON.parse(JSON.stringify(RUNG)) },
  }) as unknown as ResourcesFile;

const RESOLUTION = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', languageSet: 'fallback' };
const resourceV = (n: number) => ({
  repoPath: 'git.door43.org/unfoldingWord/en_tw',
  version: `v${100 + n}`,
  languageSet: 'fallback',
});

const decisionOf = (checkId: string, comments: string | false = false): Decision =>
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

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------
interface StepSpec {
  index: number;
  kind:
    | 'verseEdit'
    | 'settings'
    | 'pins'
    | 'addBook'
    | 'upsert'
    | 'decisionsEventful'
    | 'resolutionOnly'
    | 'sealReject';
  /** Fault injected for this step (independent of the kill sweep). */
  fault: 'none' | 'segments' | 'regen1' | 'regen2';
  token: string; // unique per step: verse text / settings value / checkId / pin version
  resourceN?: number; // resolution version for decision writes
  book?: string;
}

interface StepOutcome {
  spec: StepSpec;
  status: 'ok' | 'failed' | 'killed' | 'skipped';
  error?: string;
}

const DECISION_IPATH = 'checking/translationWords/TIT.json';

const genSequence = (rnd: () => number, allowSegFault: boolean): StepSpec[] => {
  const n = 3 + Math.floor(rnd() * 6); // 3..8
  const steps: StepSpec[] = [];
  const kinds: StepSpec['kind'][] = [
    'verseEdit',
    'settings',
    'pins',
    'addBook',
    'upsert',
    'decisionsEventful',
    'resolutionOnly',
    'sealReject',
  ];
  const weights = [2, 2, 2, 1, 3, 3, 2, 1];
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i += 1) {
    let pick = rnd() * total;
    let kind: StepSpec['kind'] = 'verseEdit';
    for (let j = 0; j < kinds.length; j += 1) {
      pick -= weights[j];
      if (pick <= 0) {
        kind = kinds[j];
        break;
      }
    }
    const r = rnd();
    const fault: StepSpec['fault'] =
      kind === 'sealReject'
        ? 'none'
        : r < (allowSegFault ? 0.15 : 0)
          ? 'segments'
          : r < 0.3
            ? 'regen1'
            : r < 0.38
              ? 'regen2'
              : 'none';
    steps.push({
      index: i,
      kind,
      fault,
      token: `tok${i}`,
      resourceN: kind === 'decisionsEventful' || kind === 'resolutionOnly' ? i : undefined,
      book: kind === 'addBook' ? ['JON', 'GAL', 'EPH'][Math.floor(rnd() * 3)] : undefined,
    });
  }
  return steps;
};

/** The derived ipath a step's regeneration writes (for regen fault targeting). */
const stepIpath = (s: StepSpec): string => {
  switch (s.kind) {
    case 'verseEdit':
      return 'TIT.usfm';
    case 'settings':
      return 'checking/settings.json';
    case 'pins':
      return 'checking/resources.json';
    case 'addBook':
      return `${s.book}.usfm`;
    default:
      return DECISION_IPATH;
  }
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
interface World {
  rig: JournalingRig;
  api: ServerApi;
  rawKv: ReturnType<typeof memKv>;
  ks: KillState;
  clock: ReturnType<typeof tickingNow>;
  newStore: () => JournalingStore;
  /** Injected faults fire only while true — recovery runs on a healthy backend. */
  faults: { armed: boolean };
}

const makeWorld = (): World => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const rawKv = memKv();
  const ks: KillState = { enabled: false, budget: 0, dead: false, count: 0 };
  const kv = killableKv(rawKv, ks);
  const clock = tickingNow('2026-08-22T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: killableFetch(rig.fetchFn, ks) });
  const newStore = (): JournalingStore => {
    forgetSharedClocks();
    forgetProjectQueues();
    return new JournalingStore({ api, kv, now: () => clock.advance(13) });
  };
  return { rig, api, rawKv, ks, clock, newStore, faults: { armed: true } };
};

const setupProject = async (w: World): Promise<JournalingStore> => {
  const store = w.newStore();
  await store.createProject({
    content_name: 'Prueba',
    content_abbr: 'prueba',
    content_language_code: 'es',
    add_book: false,
    versification: 'eng',
  });
  await store.writeResources(basePins(), null);
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr' });
  await store.addBook({
    book_code: 'TIT',
    book_title: 'Tito',
    book_abbr: 'TIT',
    add_cv: true,
    initialUsfm: TIT_USFM('___'),
  });
  return store;
};

const runStep = async (w: World, store: JournalingStore, s: StepSpec): Promise<void> => {
  if (s.fault === 'segments')
    w.rig.failOn(
      (c) => w.faults.armed && c.method === 'POST' && (c.ipath ?? '').includes('/segments/'),
      1,
    );
  if (s.fault === 'regen1' || s.fault === 'regen2')
    w.rig.failOn(
      (c) =>
        w.faults.armed &&
        c.method === 'POST' &&
        c.ipath === stepIpath(s) &&
        !(c.ipath ?? '').includes('journal'),
      s.fault === 'regen1' ? 1 : 2,
    );
  switch (s.kind) {
    case 'verseEdit':
      return store.writeBook('TIT', TIT_USFM(`Vida ${s.token}.`));
    case 'settings':
      return store.writeSettings({ schemaVersion: 1, textDirection: 'ltr', note: s.token } as never);
    case 'pins': {
      const pins = basePins();
      (pins.languageSets.primary as unknown as Record<string, unknown>).translationNotes = PIN(
        'en_tn',
        s.token,
        'parascriptural/x-bcvnotes',
      );
      return store.writeResources(pins);
    }
    case 'addBook':
      if (w.rig.repos.get(REPO)?.files.has(`${s.book}.usfm`)) return; // already added
      return store.addBook({
        book_code: s.book!,
        book_title: s.book!,
        book_abbr: s.book!,
        add_cv: true,
        initialUsfm: TIT_USFM('___').replaceAll('TIT', s.book!).replaceAll('Tito', s.book!),
      });
    case 'upsert':
      return store.upsertDecision('translationWords', 'TIT', decisionOf(s.token), RESOLUTION).then(() => {});
    case 'decisionsEventful':
    case 'sealReject':
    case 'resolutionOnly': {
      const stored = await store.readDecisions('translationWords', 'TIT').catch(() => null);
      const decisions = [...(stored?.decisions ?? [])];
      if (s.kind === 'decisionsEventful') decisions.push(decisionOf(s.token, 'nueva'));
      if (s.kind === 'sealReject') decisions.push(decisionOf(s.token, 'x'.repeat(4 * 1024 * 1024 + 64)));
      const file: DecisionFile = {
        schemaVersion: 1,
        tool: 'translationWords',
        book: 'TIT',
        resource:
          s.kind === 'sealReject'
            ? ((stored?.resource ?? RESOLUTION) as never)
            : (resourceV(s.resourceN!) as never),
        decisions,
      } as never;
      return store.writeDecisions('translationWords', 'TIT', file).then(() => {});
    }
  }
};

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------
interface Violation {
  code: string;
  detail: string;
}

const journalSnapshot = (rig: JournalingRig): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [p, b] of rig.repos.get(REPO)?.files ?? new Map<string, string>())
    if (/^checking\/journal\/[a-z0-9-]+\/segments\//.test(p)) out.set(p, b);
  return out;
};

const journalText = (rig: JournalingRig): string => [...journalSnapshot(rig).values()].join('\n');

const runOracle = async (
  w: World,
  outcomes: StepOutcome[],
  preRecovery: { segments: Map<string, string>; intentRaw: string },
): Promise<Violation[]> => {
  const v: Violation[] = [];
  const files = w.rig.repos.get(REPO)!.files;
  const jText = journalText(w.rig);

  // (journal conservation) every pre-recovery segment survives byte-identically
  for (const [p, b] of preRecovery.segments)
    if (files.get(p) !== b) v.push({ code: 'V-JOURNAL', detail: `segment ${p} changed or vanished` });

  // (5) fold-compare: the verifier the PR advertises
  const report = await verifyProjectAgainstJournal(w.api, REPO);
  if (!report.ok) v.push({ code: 'V-VERIFY', detail: describeVerifierReport(report) });

  // (1)(2)(3) per-step conservation
  const decisionDisk = files.get(DECISION_IPATH);
  const intentStagedPre = preRecovery.intentRaw;
  for (const o of outcomes) {
    const s = o.spec;
    if (o.status === 'skipped') continue;
    const inJournal = jText.includes(s.token);
    switch (s.kind) {
      case 'verseEdit': {
        const onDisk = files.get('TIT.usfm')?.includes(`Vida ${s.token}.`) ?? false;
        // superseded by a later verseEdit? later verseEdits overwrite v2.
        const later = outcomes.some(
          (x) =>
            x.spec.kind === 'verseEdit' &&
            x.spec.index > s.index &&
            (x.status === 'ok' || journalText(w.rig).includes(`Vida ${x.spec.token}.`)),
        );
        if (o.status === 'ok' && !onDisk && !later)
          v.push({ code: 'V-COMPLETED', detail: `verseEdit ${s.token} completed but not on disk` });
        if (jText.includes(`Vida ${s.token}.`) && !onDisk && !later)
          v.push({ code: 'V-ACCEPT', detail: `verseEdit ${s.token} journaled but not on disk` });
        break;
      }
      case 'settings': {
        const journaled = jText.includes(s.token);
        const onDisk = files.get('checking/settings.json')?.includes(`"${s.token}"`) ?? false;
        const superseded = outcomes.some(
          (x) => x.spec.kind === 'settings' && x.spec.index > s.index && journalText(w.rig).includes(x.spec.token),
        );
        if (o.status === 'ok' && !onDisk && !superseded)
          v.push({ code: 'V-COMPLETED', detail: `settings ${s.token} completed but not on disk` });
        if (journaled && !onDisk && !superseded)
          v.push({ code: 'V-ACCEPT', detail: `settings ${s.token} journaled but not on disk` });
        break;
      }
      case 'pins': {
        const journaled = jText.includes(s.token);
        const onDisk = files.get('checking/resources.json')?.includes(`"${s.token}"`) ?? false;
        const superseded = outcomes.some(
          (x) => x.spec.kind === 'pins' && x.spec.index > s.index && journalText(w.rig).includes(x.spec.token),
        );
        if (journaled && !onDisk && !superseded)
          v.push({ code: 'V-ACCEPT', detail: `pin ${s.token} journaled but not on disk` });
        if (o.status === 'ok' && !onDisk && !superseded)
          v.push({ code: 'V-COMPLETED', detail: `pin ${s.token} completed but not on disk` });
        break;
      }
      case 'addBook':
        if (o.status === 'ok' && !files.has(`${s.book}.usfm`))
          v.push({ code: 'V-COMPLETED', detail: `addBook ${s.book} completed but not on disk` });
        break;
      case 'upsert':
      case 'decisionsEventful': {
        const journaled = jText.includes(s.token);
        const onDisk = decisionDisk?.includes(`"${s.token}"`) ?? false;
        if (journaled && !onDisk)
          v.push({ code: 'V-ACCEPT', detail: `decision ${s.token} journaled but not on disk` });
        if (o.status === 'ok' && !onDisk)
          v.push({ code: 'V-COMPLETED', detail: `decision ${s.token} completed but not on disk` });
        break;
      }
      case 'sealReject': {
        // (3) rejected intent must be observably dropped: never in journal, never on disk
        if (jText.includes(s.token))
          v.push({ code: 'V-GHOST', detail: `seal-rejected ${s.token} found in the journal` });
        if (decisionDisk?.includes(`"${s.token}"`))
          v.push({ code: 'V-GHOST', detail: `seal-rejected ${s.token} found on disk` });
        break;
      }
      case 'resolutionOnly':
        break; // handled by the resource expectation below
    }
    void inJournal;
  }

  // Resource expectation for the (translationWords, TIT) key: the last step
  // whose resolution intent is REQUIRED to have landed (eventful accepted into
  // the journal, or resolution-only that completed), possibly superseded by a
  // later maybe-applied (killed resolution-only whose null candidate was staged
  // pre-recovery).
  const decisionSteps = outcomes.filter(
    (o) => o.spec.kind === 'decisionsEventful' || o.spec.kind === 'resolutionOnly',
  );
  if (decisionSteps.length && decisionDisk) {
    const required = decisionSteps.filter(
      (o) =>
        (o.spec.kind === 'decisionsEventful' && journalText(w.rig).includes(o.spec.token)) ||
        (o.spec.kind === 'resolutionOnly' && o.status === 'ok'),
    );
    const lastRequired = required.length ? required[required.length - 1] : null;
    const allowed = new Set<string>();
    if (lastRequired === null) allowed.add(RESOLUTION.version);
    else allowed.add(resourceV(lastRequired.spec.resourceN!).version);
    for (const o of decisionSteps) {
      if (lastRequired && o.spec.index <= lastRequired.spec.index) continue;
      if (o.status === 'ok') continue; // would be required
      // maybe-applied: a FAILED resolution-only step appended its
      // unconditional ledger record durably before its install threw (the
      // append runs first), and recovery or a later mutation's inline retry
      // may legitimately have applied it; a KILLED step is maybe-applied only
      // when its record survives in the ledger at the kill point (a record
      // whose action never published is stale-pruned instead, never applied).
      if (
        (o.spec.kind === 'resolutionOnly' && o.status === 'failed') ||
        (o.spec.kind === 'decisionsEventful' && o.status === 'failed') ||
        intentStagedPre.includes(`v${100 + o.spec.resourceN!}`)
      )
        allowed.add(resourceV(o.spec.resourceN!).version);
    }
    const diskResource = (JSON.parse(decisionDisk) as { resource?: { version?: string } }).resource?.version;
    if (diskResource !== undefined && !allowed.has(diskResource))
      v.push({
        code: 'V-RESOURCE',
        detail: `disk resource ${diskResource} not in allowed {${[...allowed].join(',')}}`,
      });
  }

  // (4) recovery idempotence: a second open changes nothing
  const writesBefore = w.rig.writes.length;
  const filesBefore = new Map(files);
  const kvBefore = new Map(w.rawKv.map);
  const again = w.newStore();
  await again.open(REPO);
  if (again.lastOpenReport?.classification !== 'converged')
    v.push({ code: 'V-IDEM', detail: `second open classified ${again.lastOpenReport?.classification}` });
  if (w.rig.writes.length !== writesBefore)
    v.push({ code: 'V-IDEM', detail: `second open performed ${w.rig.writes.length - writesBefore} writes` });
  for (const [p, b] of filesBefore)
    if (files.get(p) !== b) v.push({ code: 'V-IDEM', detail: `second open changed ${p}` });
  for (const [k, val] of kvBefore)
    if (w.rawKv.map.get(k) !== val && !k.startsWith('installation-secret')) {
      v.push({ code: 'V-IDEM', detail: `second open changed kv ${k}` });
    }
  return v;
};

// ---------------------------------------------------------------------------
// One full trial: run steps under a kill budget, recover, oracle.
// Returns violations (empty = held) or null when the kill budget exceeded the
// sequence's durable-op total (no kill happened — still oracle-checked).
// ---------------------------------------------------------------------------
const runTrial = async (
  seedNum: number,
  seqIndex: number,
  killAt: number | null, // durable-op budget for the step phase; null = no kill
  nestedKillAt: number | null, // durable-op budget for the FIRST recovery open
  allowSegFault = true,
): Promise<{ violations: Violation[]; durableOps: number; outcomes: StepOutcome[] }> => {
  const rnd = mulberry32(seedNum * 1_000_003 + seqIndex);
  const steps = genSequence(rnd, allowSegFault);
  const w = makeWorld();
  const store = await setupProject(w);

  w.ks.enabled = true;
  w.ks.budget = killAt ?? Number.MAX_SAFE_INTEGER;
  w.ks.count = 0;
  w.ks.dead = false;
  const outcomes: StepOutcome[] = [];
  for (const s of steps) {
    if (w.ks.dead) {
      outcomes.push({ spec: s, status: 'skipped' });
      continue;
    }
    try {
      await runStep(w, store, s);
      outcomes.push({ spec: s, status: 'ok' });
    } catch (e) {
      if (e instanceof Killed) outcomes.push({ spec: s, status: 'killed' });
      else outcomes.push({ spec: s, status: 'failed', error: String(e) });
    }
  }
  const durableOps = w.ks.count;
  w.ks.enabled = false;
  w.faults.armed = false; // recovery runs on a healthy backend

  // ---- recovery: fresh process over the surviving kv + disk ----
  const preRecovery = {
    segments: journalSnapshot(w.rig),
    // The surviving intent-ledger records at the kill point — the durable
    // resolution intents recovery may still apply (was: pendingResolutions).
    intentRaw: [...w.rawKv.map.entries()]
      .filter(([k]) => k.startsWith(`intent:${REPO}:`))
      .map(([, v]) => v)
      .join('\n'),
  };
  let recovered = w.newStore();
  if (nestedKillAt !== null) {
    w.ks.enabled = true;
    w.ks.budget = nestedKillAt;
    w.ks.count = 0;
    w.ks.dead = false;
    try {
      await recovered.open(REPO);
      w.ks.enabled = false;
    } catch (e) {
      w.ks.enabled = false;
      if (!(e instanceof Killed))
        return {
          violations: [{ code: 'V-OPEN', detail: `nested-kill recovery open failed: ${String(e)}` }],
          durableOps,
          outcomes,
        };
      recovered = w.newStore(); // died mid-recovery; recover again
    }
  }
  try {
    await recovered.open(REPO);
  } catch (e) {
    return {
      violations: [{ code: 'V-OPEN', detail: `recovery open failed: ${String(e)}` }],
      durableOps,
      outcomes,
    };
  }
  const violations = await runOracle(w, outcomes, preRecovery);
  return { violations, durableOps, outcomes };
};

// ---------------------------------------------------------------------------
// The suites
// ---------------------------------------------------------------------------
const SEEDS = (process.env.LENSA_SEEDS ?? '11').split(',').map(Number);
const SEQUENCES_PER_SEED = Number(process.env.LENSA_SEQ ?? 40);
const describeSteps = (outcomes: StepOutcome[]): string =>
  outcomes.map((o) => `${o.spec.index}:${o.spec.kind}/${o.spec.fault}=${o.status}`).join(' ');

// The sweep, segment-publish faults ENABLED: the round-5 class is fixed, so
// it is swept like every other fault (kills at every durable boundary,
// regeneration faults, seal rejects, segment-publish failures, kills inside
// recovery). ZERO violations is the gate.
describe('intent ledger: kill-sweep conservation (all fault classes)', () => {
  for (const seed of SEEDS) {
    it(
      `seed ${seed}: ${SEQUENCES_PER_SEED} sequences × full durable-boundary kill sweep`,
      { timeout: 600_000 },
      async () => {
        // Violations are BUCKETED by signature so one known class does not
        // mask a different one; the sweep always runs to completion.
        const buckets = new Map<string, { count: number; sample: string }>();
        let violationTrials = 0;
        let trials = 0;
        const record = (label: string, violations: Violation[], outcomes: StepOutcome[]): void => {
          if (violations.length === 0) return;
          violationTrials += 1;
          for (const v of violations) {
            const paths = /Paths: (.*)$/.exec(v.detail)?.[1]?.replace(/\(disk [^)]*\)/g, '') ?? '';
            const sig = `${v.code}|${paths || v.detail.slice(0, 80)}`;
            const b = buckets.get(sig) ?? { count: 0, sample: `${label}: ${v.code} ${v.detail} | ${describeSteps(outcomes)}` };
            b.count += 1;
            buckets.set(sig, b);
          }
        };
        for (let i = 0; i < SEQUENCES_PER_SEED; i += 1) {
          // Dry run: injected faults but no kill — measures the durable-op count.
          const dry = await runTrial(seed, i, null, null, true);
          trials += 1;
          record(`seq ${i} NO-KILL`, dry.violations, dry.outcomes);
          // Kill sweep across every durable boundary of the step phase.
          const rnd = mulberry32(seed * 7_000_003 + i);
          for (let k = 1; k <= dry.durableOps; k += 1) {
            const nested = rnd() < 0.35 ? 1 + Math.floor(rnd() * 8) : null;
            const t = await runTrial(seed, i, k, nested, true);
            trials += 1;
            record(`seq ${i} kill@${k}${nested !== null ? ` nested@${nested}` : ''}`, t.violations, t.outcomes);
          }
        }
        console.log(`seed ${seed}: ${trials} trials, ${violationTrials} violating trials, ${buckets.size} distinct signatures`);
        for (const [sig, b] of buckets)
          console.log(`  [x${b.count}] ${sig}\n    sample: ${b.sample.slice(0, 500)}`);
        expect(buckets.size, [...buckets.values()].map((b) => b.sample.slice(0, 300)).join('\n')).toBe(0);
      },
    );
  }
});

// The former demonstration suite (random no-kill sequences with segment
// faults, EXPECTING round-5 violations) is retired: the class it demonstrated
// is fixed, and the sweep above now runs that fault class to ZERO violations.
