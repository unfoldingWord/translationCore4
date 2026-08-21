// JournalingStore — the canonical write boundary (issue #62; D50 contract).
//
// Every production project mutation comes through this class, which implements
// the BurritoStore interface of record. Each mutation is recorded as ONE
// immutable §8.5 journal action BEFORE any derived project file changes
// (journal-first publication); the derived files on disk are then regenerated
// from the fold's projection, so the project on disk is a verified
// materialization of the journal. A crash may leave the journal ahead of the
// derived files; open() classifies and recovers FORWARD — it never loses an
// accepted action and never overwrites a state it cannot explain.
//
// Serialization (D50): all mutations for one project run on one per-project
// queue. The serialized critical section covers observation of the live journal
// head (the fold), diff/action construction, durable staging, publication,
// regeneration, and verification. Different projects do not block one another.
//
// The fold itself is the REFERENCE implementation (src/data/journal/runtime.ts
// imports conformance/journal/ directly — no port, no drift).
import type {
  AddBookParams,
  BurritoStore,
  CreateProjectParams,
  Decision,
  DecisionFile,
  GatewayChangePlan,
  ProjectSummary,
  ResourcesFile,
  SettingsFile,
} from '../burritoStore';
import type { AlignmentFile, AlignmentVerseRecord } from '../align/zaln';
import {
  HttpStore,
  StaleWriteError,
  md5Hex,
  normalizeAlignmentFile,
  normalizeDecision,
  type WriteBookOptions,
} from '../httpStore';
import { ServerApi, ServerApiError, type ServerApiInit } from '../serverApi';
import { samePath } from '../resolve';
import { JournalStore } from './journalStore';
import { idbKvStore, type KvStore } from './identity';
import { sealAction, type JournalEvent } from './seal';
import {
  decompose,
  derivedProjections,
  EMPTY_CHECKPOINT_DOCUMENTS,
  fold,
  isUnjournaledIngredient,
  normalizeEvent,
  projectAlignments,
  projectResources,
  projectSettings,
  reconcileUsfm,
  seedFromSidecars,
  slotKeysOf,
  toNfc,
  verseTextMd5,
  type FoldOutput,
} from './runtime';

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** App-created projects live under this org (same constant as HttpStore). */
const APP_ORG = '_local_/_local_';

const TOOL_IDS = ['translationWords', 'translationNotes'] as const;

const bookIpath = (book: string): string => `${book.toUpperCase()}.usfm`;
const alignmentsIpath = (book: string): string => `checking/alignments/${book.toUpperCase()}.json`;
const decisionsIpath = (tool: string, book: string): string =>
  `checking/${tool}/${book.toUpperCase()}.json`;
const RESOURCES_IPATH = 'checking/resources.json';
const SETTINGS_IPATH = 'checking/settings.json';
const VRS_IPATH = 'vrs.json';

/** The checkpoint's own byte form (conformance/journal/checkpoint.mjs
 * `serialize`) — every regenerated sidecar uses EXACTLY this, so per-mutation
 * regeneration, the §8.7 checkpoint, and the fold-compare verifier agree
 * byte-for-byte. */
const serialize = (doc: unknown): string => `${JSON.stringify(doc, null, 2)}\n`;

/** Canonical (key-sorted) JSON for CONTENT comparison — never for bytes. */
const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort())
        out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
};

/** The journal's §5.2 decision register key: dec|toolId|checkId|bookId|chapter|verse|occurrence
 * — the SAME string conformance/journal/fold.mjs keys on (identityKeyOf parts). */
const decisionRegisterKey = (tool: string, decision: Decision): string => {
  const c = decision.contextId;
  const r = c.reference;
  return ['dec', tool, c.checkId, r.bookId, String(r.chapter), String(r.verse), String(c.occurrence)].join('|');
};

/** Flatten a §5.3 resources document into pin-slot entries — the SAME walk the
 * reference seeder applies (conformance/journal/reconcile.mjs seedFromSidecars),
 * restated over the typed document. Slot grammar violations surface at seal. */
const flattenPins = (resources: ResourcesFile): Array<{ slot: string; entry: unknown }> => {
  const out: Array<{ slot: string; entry: unknown }> = [];
  const sets = (resources.languageSets ?? {}) as unknown as Record<string, Record<string, unknown>>;
  for (const set of Object.keys(sets))
    for (const slot of Object.keys(sets[set] ?? {}))
      out.push({ slot: `languageSets.${set}.${slot}`, entry: sets[set][slot] });
  const groups = (resources.resources ?? {}) as Record<string, Record<string, unknown>>;
  for (const group of Object.keys(groups))
    for (const key of Object.keys(groups[group] ?? {}))
      out.push({ slot: `resources.${group}.${key}`, entry: groups[group][key] });
  for (const extra of resources.extraScripture ?? [])
    out.push({ slot: `extraScripture.${extra.id}`, entry: extra });
  return out;
};

/** An "empty-state" §5.1 record — the DEFINED representation of alignment
 * removal (§8.5 R-8.5.11: removal is the explicit empty payload, projected as a
 * record, not absence). */
const isEmptyAlignmentRecord = (record: Record<string, unknown>): boolean =>
  Array.isArray(record.alignments) &&
  (record.alignments as unknown[]).length === 0 &&
  Array.isArray(record.wordBank) &&
  (record.wordBank as unknown[]).length === 0;

// ---------------------------------------------------------------------------
// The per-project mutation queue (D50)
// ---------------------------------------------------------------------------

const projectQueues = new Map<string, Promise<unknown>>();
const inProjectQueue = <T>(repoPath: string, fn: () => Promise<T>): Promise<T> => {
  const prior = projectQueues.get(repoPath) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  // A settled-either-way marker keeps the chain alive across rejections.
  projectQueues.set(
    repoPath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
};

/** Test hook: drop the per-project queues (a "process restart"). */
export const forgetProjectQueues = (): void => {
  projectQueues.clear();
};

// ---------------------------------------------------------------------------
// Errors the recovery classifier surfaces
// ---------------------------------------------------------------------------

/** open() found derived state the journal cannot explain: neither the current
 * projection, nor a journal-ahead prefix, nor a §8.8-reconcilable USFM edit.
 * The project is NOT modified; every unexplained path is reported with hashes
 * so a human can decide (the issue #62 safety bar: a visible, diagnosable stop
 * over guessing). */
export class UnexplainedDivergenceError extends Error {
  readonly repoPath: string;
  readonly paths: Array<{ ipath: string; diskMd5: string | null; projectedMd5: string | null }>;

  constructor(
    repoPath: string,
    paths: Array<{ ipath: string; diskMd5: string | null; projectedMd5: string | null }>,
  ) {
    super(
      `refuse to open ${repoPath}: derived state diverges from the journal projection in a way ` +
        `no journal prefix or §8.8 reconciliation explains — nothing was overwritten. Paths: ` +
        paths
          .map((p) => `${p.ipath} (disk ${p.diskMd5 ?? 'absent'} vs projected ${p.projectedMd5 ?? 'absent'})`)
          .join('; '),
    );
    this.name = 'UnexplainedDivergenceError';
    this.repoPath = repoPath;
    this.paths = paths;
  }
}

/** The §8.8 universal seed could not reproduce the pre-seed bytes exactly, so
 * it was NOT published (all-or-nothing). */
export class SeedMismatchError extends Error {
  readonly repoPath: string;
  readonly mismatches: string[];

  constructor(repoPath: string, mismatches: string[]) {
    super(
      `refuse to seed ${repoPath}: folding the candidate seed does not reproduce the pre-seed ` +
        `journal-derived state (${mismatches.join('; ')}) — nothing was published (R-8.8.2)`,
    );
    this.name = 'SeedMismatchError';
    this.repoPath = repoPath;
    this.mismatches = mismatches;
  }
}

/** What open()'s recovery classifier decided, for diagnostics and tests. */
export interface OpenReport {
  replayed: Array<{ ts: string; outcome: string; reason?: string }>;
  seeded: boolean;
  classification: 'seeded' | 'converged' | 'regenerated-forward' | 'reconciled';
  regeneratedPaths: string[];
  reconciledBooks: string[];
  forks: FoldOutput['forks'];
  retained: FoldOutput['retained'];
  pendingStructural: FoldOutput['pendingStructural'];
}

export interface JournalingStoreInit {
  api?: ServerApi;
  baseUrl?: ServerApiInit['baseUrl'];
  fetchFn?: ServerApiInit['fetchFn'];
  /** Installation-local storage; defaults to the shared IndexedDB store. */
  kv?: KvStore;
  /** Injectable physical clock for tests; defaults to Date.now. */
  now?: () => number;
}

interface OpenOptions {
  /** The §8.3 seed source when this open performs universal seeding. */
  seedSource?: 'creation' | 'sidecar-migration';
  /** The versification scheme name for a creation seed's project.vrs.set. */
  vrsName?: string;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class JournalingStore implements BurritoStore {
  readonly api: ServerApi;
  private readonly raw: HttpStore;
  private readonly kv: KvStore;
  private readonly now: () => number;

  private boundRepoPath: string | null = null;
  private journal: JournalStore | null = null;
  /** The accepted-event union this session observed (open + own publishes). */
  private events: JournalEvent[] = [];
  private foldCache: FoldOutput | null = null;
  /** Derive-time (tool, BOOK) resolution records (§5.2/D30) — checkpoint input. */
  private readonly resolutions = new Map<string, Record<string, unknown>>();
  /** Diagnostics of the last open(), for tests and the UI. */
  lastOpenReport: OpenReport | null = null;

  constructor(init: JournalingStoreInit = {}) {
    this.api = init.api ?? new ServerApi({ baseUrl: init.baseUrl, fetchFn: init.fetchFn });
    this.raw = new HttpStore({ api: this.api });
    this.kv = init.kv ?? idbKvStore();
    this.now = init.now ?? (() => Date.now());
  }

  get repoPath(): string | null {
    return this.boundRepoPath;
  }

  /** The actor id this installation holds for the open project (after open()). */
  get actorId(): string {
    return this.mustJournal().actorId;
  }

  private mustRepo(): string {
    if (this.boundRepoPath === null)
      throw new Error('JournalingStore: no project open — call open(repoPath) first');
    return this.boundRepoPath;
  }

  private mustJournal(): JournalStore {
    if (this.journal === null)
      throw new Error('JournalingStore: no project open — call open(repoPath) first');
    return this.journal;
  }

  private foldNow(): FoldOutput {
    this.foldCache ??= fold(this.events);
    return this.foldCache;
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    return inProjectQueue(this.mustRepo(), fn);
  }

  // ---- raw read delegation ---------------------------------------------------

  listProjects(): Promise<ProjectSummary[]> {
    return this.raw.listProjects();
  }

  readBook(book: string): Promise<{ usfm: string; md5: string }> {
    return this.raw.readBook(book);
  }

  readSourceBook(sourceRepoPath: string, bookCode: string): Promise<{ usfm: string }> {
    return this.raw.readSourceBook(sourceRepoPath, bookCode);
  }

  readAlignments(book: string): Promise<AlignmentFile | null> {
    return this.raw.readAlignments(book);
  }

  readAlignmentsWithMd5(book: string): Promise<{ value: AlignmentFile | null; md5: string | null }> {
    return this.raw.readAlignmentsWithMd5(book);
  }

  readDecisions(tool: string, book: string): Promise<DecisionFile | null> {
    return this.raw.readDecisions(tool, book);
  }

  readDecisionsWithMd5(
    tool: string,
    book: string,
  ): Promise<{ value: DecisionFile | null; md5: string | null }> {
    return this.raw.readDecisionsWithMd5(tool, book);
  }

  readDecisionsText(tool: string, book: string): Promise<{ text: string | null; md5: string | null }> {
    return this.raw.readDecisionsText(tool, book);
  }

  readResources(): Promise<ResourcesFile | null> {
    return this.raw.readResources();
  }

  readResourcesWithMd5(): Promise<{ value: ResourcesFile | null; md5: string | null }> {
    return this.raw.readResourcesWithMd5();
  }

  readSettings(): Promise<SettingsFile | null> {
    return this.raw.readSettings();
  }

  // ---- ingredient plumbing ---------------------------------------------------

  private async readIngredientOrNull(ipath: string): Promise<string | null> {
    try {
      return await this.api.readIngredient(this.mustRepo(), ipath);
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) return null;
      throw error;
    }
  }

  /** Write one derived file's projection bytes and byte-verify the readback —
   * the per-mutation "regeneration and verification" half of the D50 critical
   * section. Registration (update_ingredients) matches the pre-#62 writers. */
  private async installDerived(ipath: string, bytes: string): Promise<void> {
    await this.api.writeIngredient(this.mustRepo(), ipath, bytes, {
      updateIngredients: true,
      keepBak: true,
    });
    const readBack = await this.readIngredientOrNull(ipath);
    if (readBack !== bytes)
      throw new Error(
        `derived write verification failed for ${ipath}: the readback does not match the ` +
          `projection bytes — the journal remains authoritative; reopening recovers forward`,
      );
  }

  /** The projection bytes of ONE derived path under a given fold. Returns null
   * for a path the fold does not derive (e.g. an alignment sidecar for a book
   * with no records). */
  private projectionBytes(foldOut: FoldOutput, ipath: string): string | null {
    const book = /^([A-Z0-9]{3})\.usfm$/.exec(ipath)?.[1];
    if (book) return foldOut.books[book]?.usfm ?? null;
    const align = /^checking\/alignments\/([A-Z0-9]{3})\.json$/.exec(ipath)?.[1];
    if (align) return foldOut.alignments[align] ? projectAlignments(foldOut, align) : null;
    const dec = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
    if (dec) return this.projectDecisionFile(foldOut, dec[1], dec[2]);
    // resources.json and settings.json are ALWAYS derivable: when nothing is
    // folded for them the projection is the §8.7 EMPTY document — a valid last
    // pin/setting REMOVAL must materialize it, not silently keep the stale
    // non-empty file (review of 2026-08-20, P2). An absent disk file whose
    // projection is exactly the empty document stays tolerated everywhere as
    // "not yet checkpointed" (EMPTY_CHECKPOINT_DOCUMENTS).
    if (ipath === RESOURCES_IPATH) return projectResources(foldOut.pins);
    if (ipath === SETTINGS_IPATH) return projectSettings(foldOut.settings);
    if (ipath === VRS_IPATH) return foldOut.vrs?.bytes ?? null;
    return null;
  }

  /** One (tool, BOOK) §5.2 sidecar from the fold — byte-identical to the
   * checkpoint's projectDecisions output for the same file. Requires the
   * resolution record (§5.2/D30: an incomplete file is never emitted). */
  private projectDecisionFile(foldOut: FoldOutput, tool: string, book: string): string | null {
    const records = (foldOut.decisions[tool] ?? []).filter(
      (d) => d.contextId.reference.bookId.toUpperCase() === book.toUpperCase(),
    );
    if (records.length === 0) return null;
    const resource = this.resolutions.get(`${tool}\n${book.toUpperCase()}`);
    if (resource === undefined)
      throw new Error(
        `missing resolution record for (${tool}, ${book.toUpperCase()}) — §5.2 requires ` +
          `\`resource\` (D30); refuse to emit an incomplete decision file`,
      );
    const doc: Record<string, unknown> = { schemaVersion: 1, tool, book: book.toUpperCase() };
    doc.resource = resource;
    doc.decisions = records;
    return serialize(doc);
  }

  /** Every ipath the CURRENT fold derives (the regeneration/verification set,
   * §8.7 minus metadata.json, which no HTTP route can write — D28). */
  private derivedPathsOf(foldOut: FoldOutput): string[] {
    const paths: string[] = [];
    for (const book of Object.keys(foldOut.books)) {
      paths.push(bookIpath(book));
      if (foldOut.alignments[book]) paths.push(alignmentsIpath(book));
    }
    for (const tool of Object.keys(foldOut.decisions)) {
      const books = new Set(
        foldOut.decisions[tool].map((d) => d.contextId.reference.bookId.toUpperCase()),
      );
      for (const book of books) paths.push(decisionsIpath(tool, book));
    }
    // Always derivable (empty documents when nothing is folded — see
    // projectionBytes): a last-register removal must still regenerate them.
    paths.push(RESOURCES_IPATH);
    paths.push(SETTINGS_IPATH);
    if (foldOut.vrs) paths.push(VRS_IPATH);
    return paths;
  }

  // ---- publication core --------------------------------------------------------

  private get regenMarkerKey(): string {
    return `regen:${this.mustRepo()}:${this.actorId}`;
  }

  private get seedMarkerKey(): string {
    return `seed:${this.mustRepo()}:${this.actorId}`;
  }

  private get pendingResolutionsKey(): string {
    return `pendingResolutions:${this.mustRepo()}:${this.actorId}`;
  }

  /** Publish one action journal-first, then regenerate + verify the affected
   * derived files from the NEW fold. A durable marker brackets regeneration so
   * a crash inside it is classified as "journal ahead" on the next open, with
   * the affected paths recorded. If publication fails, no derived file changes.
   * If regeneration fails after publication, the journal remains authoritative
   * and reopening recovers forward.
   *
   * `resolutions` (review of 2026-08-20, P1): the (tool\nBOOK) resolution
   * records this action's decision files depend on. They are derive-time state
   * the JOURNAL does not carry, so they are DURABLY STAGED here, keyed to the
   * action's first ts, BEFORE publication — a crash after publish and before
   * the sidecar write must regenerate the new decisions under the NEW resource,
   * not under whatever the old disk file still says. open() applies the staged
   * record only when its ts is actually in the journal, and this method clears
   * it once regeneration has converged the disk. */
  private async publishAndRegenerate(
    events: JournalEvent[],
    affected: string[],
    resolutions?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    if (events.length === 0) return;
    const stamped =
      events.length > 1 ? events.map((e) => ({ ...e, batch: events[0].ts })) : events;
    if (resolutions && Object.keys(resolutions).length)
      await this.stagePendingResolutions(stamped[0].ts, resolutions);
    await this.mustJournal().publish(stamped);
    this.events.push(...stamped.map(normalizeEvent));
    this.foldCache = null;
    try {
      await this.installWithMarker(affected);
    } finally {
      // Clear per ENTRY, and only the ones whose sidecar actually converged —
      // an earlier write's still-unmaterialized intent is never erased by this
      // mutation's cleanup (review of 2026-08-20 round 3, P1).
      await this.clearConvergedPendingResolutions();
    }
  }

  /** The durable pending-resolution store — an ACCUMULATED per-(tool, BOOK)
   * map, never a single overwriteable slot (review of 2026-08-20 round 3, P1:
   * a later decision write must not erase an earlier accepted-but-
   * unmaterialized resource intent). Each entry carries its own gate: the
   * staging action's first ts, or null for a resolution-only intent that
   * applies unconditionally. */
  private async readPendingResolutions(): Promise<
    Record<string, { ts: string | null; resource: Record<string, unknown> }>
  > {
    const raw = await this.kv.get(this.pendingResolutionsKey);
    if (raw === undefined) return {};
    return (JSON.parse(raw) as { entries: Record<string, { ts: string | null; resource: Record<string, unknown> }> })
      .entries;
  }

  private async stagePendingResolutions(
    ts: string | null,
    resolutions: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const entries = await this.readPendingResolutions();
    // Per-key overwrite is correct: the queue serializes mutations, so a newer
    // intent for the SAME (tool, BOOK) supersedes the older one — but entries
    // for OTHER keys are always preserved.
    for (const [key, resource] of Object.entries(resolutions)) entries[key] = { ts, resource };
    await this.kv.set(this.pendingResolutionsKey, JSON.stringify({ entries }));
  }

  /** Drop every pending entry whose decision sidecar is no longer OUTSTANDING
   * (its regeneration completed, so the disk file now embeds the resolution);
   * entries whose paths are still in the regeneration marker stay staged. */
  private async clearConvergedPendingResolutions(): Promise<void> {
    const entries = await this.readPendingResolutions();
    if (Object.keys(entries).length === 0) return;
    const marker = await this.kv.get(this.regenMarkerKey);
    const outstanding = new Set<string>(marker === undefined ? [] : (JSON.parse(marker) as string[]));
    let kept = false;
    for (const key of Object.keys(entries)) {
      const [tool, book] = key.split('\n');
      if (outstanding.has(decisionsIpath(tool, book))) kept = true;
      else delete entries[key];
    }
    if (kept) await this.kv.set(this.pendingResolutionsKey, JSON.stringify({ entries }));
    else await this.kv.delete(this.pendingResolutionsKey);
  }

  /** Regenerate derived paths under the durable OUTSTANDING-set marker (review
   * of 2026-08-20 round 2, P1). The marker is a SET that accumulates: an
   * earlier mutation's failed regeneration stays recorded when a later
   * mutation runs — never replaced, never deleted while work is outstanding —
   * so a mixed disk state (one action materialized, an earlier one not) is
   * always explained by "the full fold minus the marker's paths". The set
   * SHRINKS per successful install (a crash leaves the precise remainder) and
   * later mutations RETRY the older outstanding paths inline, after their own
   * paths, from the CURRENT fold — the marker self-heals instead of forcing a
   * reopen, and this mutation's own write lands even when the retry fails
   * again. The marker is deleted only when nothing remains outstanding. */
  private async installWithMarker(affected: string[]): Promise<void> {
    const existing = await this.kv.get(this.regenMarkerKey);
    const outstanding = new Set<string>(existing === undefined ? [] : (JSON.parse(existing) as string[]));
    const own = [...new Set(affected)];
    for (const ipath of own) outstanding.add(ipath);
    await this.kv.set(this.regenMarkerKey, JSON.stringify([...outstanding]));
    const foldOut = this.foldNow();
    const ordered = [...own, ...[...outstanding].filter((p) => !own.includes(p))];
    for (const ipath of ordered) {
      try {
        const bytes = this.projectionBytes(foldOut, ipath);
        if (bytes !== null) await this.installDerived(ipath, bytes);
      } catch (error) {
        // This mutation fails only for ITS OWN work; a still-failing RETRY of
        // an older outstanding path simply stays marked for the next attempt.
        if (own.includes(ipath)) throw error;
        continue;
      }
      outstanding.delete(ipath);
      await this.kv.set(this.regenMarkerKey, JSON.stringify([...outstanding]));
    }
    if (outstanding.size === 0) await this.kv.delete(this.regenMarkerKey);
  }

  /** Persist and materialize a RESOLUTION-ONLY change (review of 2026-08-20
   * round 2, P2): a whole-file decision write may validly change the
   * authoritative §5.2 `resource` while leaving every decision unchanged. That
   * is derive-time state the journal does not carry (D30), so there is no
   * event to publish — the intent is durably recorded as a ts-FREE pending
   * record (applied unconditionally on open: with no action to gate on, the
   * record itself is the whole intent), the sidecars regenerate under the new
   * resolution, and the record clears once disk has converged. */
  private async applyResolutionOnly(
    entries: Record<string, Record<string, unknown>>,
    affected: string[],
  ): Promise<void> {
    await this.stagePendingResolutions(null, entries);
    try {
      await this.installWithMarker(affected);
    } finally {
      await this.clearConvergedPendingResolutions();
    }
  }

  /** CAS precondition: the disk bytes at ipath must hash to expectMd5 (null =
   * "must be absent"). undefined = no check. Runs INSIDE the queue, before
   * publication, so a stale compare-and-swap refuses before anything changes. */
  private async checkExpectMd5(ipath: string, expectMd5: string | null | undefined): Promise<void> {
    if (expectMd5 === undefined) return;
    const disk = await this.readIngredientOrNull(ipath);
    const diskMd5 = disk === null ? null : md5Hex(disk);
    if (diskMd5 !== expectMd5)
      throw new StaleWriteError(ipath, expectMd5 ?? '(absent)', diskMd5 ?? '(absent)');
  }

  // ---- BurritoStore: lifecycle -------------------------------------------------

  /** Server container step + creation seed (issue #62 mapping). The server
   * creates the repo (vrs.json + initial commit) FIRST — the one unavoidable
   * pre-journal step — and this method then opens the project, which publishes
   * the creation seed. A crash between the two is healed by the SAME code path:
   * universal seeding on first open. */
  async createProject(params: CreateProjectParams): Promise<{ repoPath: string }> {
    const repoPath = `${APP_ORG}/${params.content_abbr}`;
    // Pre-check the name (PLATFORM-NOTES #28): creation git-inits BEFORE it
    // validates, so never attempt a create over an existing path, and delete
    // debris only when this listing POSITIVELY confirmed absence.
    const existing = await this.api.listLocalRepos();
    if (existing.includes(repoPath))
      throw new ServerApiError('/git/new-text-translation', 0, `project ${repoPath} already exists`);
    try {
      await this.api.newTextTranslation({
        content_name: params.content_name,
        content_abbr: params.content_abbr,
        content_language_code: params.content_language_code,
        content_language_name: params.content_language_name ?? null,
        add_book: params.add_book,
        book_code: params.book_code,
        book_title: params.book_title,
        book_abbr: params.book_abbr,
        add_cv: params.add_cv,
        versification: params.versification,
      });
    } catch (error) {
      // Our failed attempt may have left git-init debris; the pre-check proved
      // the path was absent, so deleting can only remove our own debris.
      await this.api.deleteRepo(repoPath).catch(() => {});
      throw error;
    }
    await this.openInternal(repoPath, { seedSource: 'creation', vrsName: params.versification });
    return { repoPath };
  }

  async open(repoPath: string): Promise<ProjectSummary> {
    return this.openInternal(repoPath, {});
  }

  private async openInternal(repoPath: string, options: OpenOptions): Promise<ProjectSummary> {
    const summary = await this.raw.open(repoPath); // binds raw + setCurrentProject
    this.boundRepoPath = repoPath;
    this.journal = new JournalStore({ api: this.api, repoPath, kv: this.kv, now: this.now });
    this.events = [];
    this.foldCache = null;
    this.resolutions.clear();
    await this.journal.open(); // actor repair + HLC ratchet (issue #62 / #61)
    return inProjectQueue(repoPath, async () => {
      await this.recoverAndConverge(options);
      return summary;
    });
  }

  /** The four-way recovery classifier (issue #62): replay the outbox, read the
   * union, then classify derived state as seeded / converged / journal-ahead
   * (regenerate forward) / out-of-band (reconcile via §8.8) — anything else is
   * a visible, diagnosable stop. */
  private async recoverAndConverge(options: OpenOptions): Promise<void> {
    const journal = this.mustJournal();

    // 1. Replay any durable staged intent with its EXACT bytes (R-8.1.8).
    const replayed = await journal.replayStaged();
    const stagedInvalid = replayed.filter((r) => r.outcome === 'staged-invalid');
    if (stagedInvalid.length)
      throw new Error(
        `refuse to open ${this.mustRepo()}: the outbox holds staged intents whose bytes are ` +
          `invalid (${stagedInvalid.map((r) => `${r.ts}: ${r.reason ?? ''}`).join('; ')}) — ` +
          `surfaced, never silently dropped (R-8.1.7/R-8.1.8)`,
      );

    // 2. The union. A corrupt segment is never treated as absent history.
    const union = await journal.readUnion();
    if (union.invalid.length || union.misnamed.length)
      throw new Error(
        `refuse to open ${this.mustRepo()}: the journal holds unusable files — ` +
          [
            ...union.invalid.map((s) => `${s.actor}/${s.name}: ${s.reason}`),
            ...union.misnamed.map((s) => `${s.actor}/${s.name}: misnamed`),
          ].join('; ') +
          ` — republish from a staged intent or resolve by hand; never silently dropped (R-8.1.6/7)`,
      );

    // Durably staged (tool, BOOK) resolution records (review of 2026-08-20,
    // P1): applied only when their action's ts is ACTUALLY in the journal —
    // the replay above already republished any surviving intent, so a ts that
    // is still absent proves the action never published and the record is
    // stale. Cleared below once recovery has converged the disk.
    // Gate each staged entry INDIVIDUALLY (round 3: the record is a per-key
    // map, never one slot): an entry whose gate ts is null is a resolution-only
    // intent and applies unconditionally — the record is the whole intent; an
    // entry gated on an action ts applies only when that ts is actually in the
    // journal (the replay above already republished any surviving intent, so a
    // still-absent ts proves the action never published — that entry is stale
    // and dropped, the others untouched).
    const unionTs = new Set(union.events.map((e) => e.ts));
    const staged = await this.readPendingResolutions();
    const pendingResolutions: Record<string, { ts: string | null; resource: Record<string, unknown> }> = {};
    let droppedStale = false;
    for (const [key, entry] of Object.entries(staged)) {
      if (entry.ts === null || unionTs.has(entry.ts)) pendingResolutions[key] = entry;
      else droppedStale = true;
    }
    if (droppedStale) {
      if (Object.keys(pendingResolutions).length)
        await this.kv.set(this.pendingResolutionsKey, JSON.stringify({ entries: pendingResolutions }));
      else await this.kv.delete(this.pendingResolutionsKey);
    }
    const hasPending = Object.keys(pendingResolutions).length > 0;

    const report: OpenReport = {
      replayed,
      seeded: false,
      classification: 'converged',
      regeneratedPaths: [],
      reconciledBooks: [],
      forks: [],
      retained: [],
      pendingStructural: [],
    };

    // 3. Journal-less project → universal seeding (§8.8, all-or-nothing). A
    // durable seed marker routes an INTERRUPTED seed back here too (review of
    // 2026-08-20, P1): its replayed segments make the union non-empty, but the
    // ordinary classifier cannot finish a seed's sidecar canonicalization.
    const seedMarker = await this.kv.get(this.seedMarkerKey);
    if (union.events.length === 0 || seedMarker !== undefined) {
      await this.seedProject(options, report, union.events);
    } else {
      this.events = union.events;
      this.foldCache = null;
      await this.harvestResolutions();
      const harvested = new Map(this.resolutions);
      for (const [key, entry] of Object.entries(pendingResolutions))
        this.resolutions.set(key, entry.resource);
      await this.classifyAndRecover(union.actions, report, {
        // Each staged resolution belongs WITH its own gate: a journal PREFIX
        // carries an entry's overlay only when it contains that entry's action
        // ts (and never a ts-free one), or a genuine journal-ahead state reads
        // as unexplained.
        pending: pendingResolutions,
        harvested,
      });
      // A successful classification leaves every derived path converged (any
      // install failure throws), so the applied entries are materialized.
      if (hasPending) await this.kv.delete(this.pendingResolutionsKey);
    }

    const foldOut = this.foldNow();
    report.forks = foldOut.forks;
    report.retained = foldOut.retained;
    report.pendingStructural = foldOut.pendingStructural;
    this.lastOpenReport = report;
  }

  /** Load the derive-time (tool, BOOK) resolution records from the disk
   * decision files — checkpoint/regeneration input the journal does not carry
   * (D30: recomputed derive-time state). */
  private async harvestResolutions(): Promise<void> {
    const paths = await this.api.listPaths(this.mustRepo());
    for (const ipath of paths) {
      const m = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
      if (!m) continue;
      const text = await this.readIngredientOrNull(ipath);
      if (text === null) continue;
      try {
        const file = JSON.parse(text) as DecisionFile;
        if (file.resource) this.resolutions.set(`${m[1]}\n${m[2]}`, file.resource);
      } catch {
        /* unparseable sidecar surfaces as divergence below */
      }
    }
  }

  /** Inventory every journal-derived surface on disk (the §8.8 seed input). */
  private async inventoryDisk(): Promise<{
    books: Record<string, { usfm: string; scope: string[] }>;
    decisionFiles: Record<string, DecisionFile>;
    decisionFilesByBook: Record<string, Record<string, DecisionFile>>;
    alignmentFiles: Record<string, AlignmentFile>;
    resources: ResourcesFile | null;
    settings: SettingsFile | null;
    vrsBytes: string | null;
    diskBytes: Record<string, string>;
    unknown: string[];
  }> {
    const repo = this.mustRepo();
    // SORTED: a resumed seed recomputes its events from this inventory, and the
    // recomputation must be deterministic — event order (and so each event's
    // ts) must not depend on the platform's directory-walk order.
    const paths = (await this.api.listPaths(repo))
      .filter((p) => !p.startsWith('checking/journal/') && !isUnjournaledIngredient(p))
      .sort();
    const books: Record<string, { usfm: string; scope: string[] }> = {};
    const decisionFiles: Record<string, DecisionFile> = {};
    const decisionFilesByBook: Record<string, Record<string, DecisionFile>> = {};
    const alignmentFiles: Record<string, AlignmentFile> = {};
    let resources: ResourcesFile | null = null;
    let settings: SettingsFile | null = null;
    let vrsBytes: string | null = null;
    const diskBytes: Record<string, string> = {};
    const unknown: string[] = [];

    let scope: Record<string, string[]> = {};
    try {
      const meta = await this.api.getMetadataRaw(repo);
      scope = (meta?.type?.flavorType?.currentScope ?? {}) as Record<string, string[]>;
    } catch {
      scope = {};
    }

    for (const ipath of paths) {
      const text = await this.readIngredientOrNull(ipath);
      if (text === null) continue; // listed, then gone — treated as absent
      diskBytes[ipath] = text;
      const parsed = (label: string): unknown => {
        try {
          return JSON.parse(text);
        } catch {
          // Unparseable sidecar: not silently skipped — it surfaces as an
          // unexplained path (the classifier's diagnosable stop).
          unknown.push(label);
          return undefined;
        }
      };
      const book = /^([A-Z0-9]{3})\.usfm$/.exec(ipath)?.[1];
      if (book) {
        books[book] = { usfm: text, scope: scope[book] ?? [] };
        continue;
      }
      const align = /^checking\/alignments\/([A-Z0-9]{3})\.json$/.exec(ipath)?.[1];
      if (align) {
        const file = parsed(ipath) as AlignmentFile | undefined;
        if (file) alignmentFiles[align] = file;
        continue;
      }
      const dec = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
      if (dec) {
        const file = parsed(ipath) as DecisionFile | undefined;
        if (!file) continue;
        // seedFromSidecars keys decision files by toolId; per-book bookkeeping
        // stays here so resolutions and (tool, book) merging stay exact.
        (decisionFilesByBook[dec[1]] ??= {})[dec[2]] = file;
        const merged = decisionFiles[dec[1]] ?? { ...file, decisions: [] };
        merged.decisions = [...merged.decisions, ...(file.decisions ?? [])];
        decisionFiles[dec[1]] = merged;
        continue;
      }
      if (ipath === RESOURCES_IPATH) {
        resources = (parsed(ipath) as ResourcesFile | undefined) ?? null;
        continue;
      }
      if (ipath === SETTINGS_IPATH) {
        settings = (parsed(ipath) as SettingsFile | undefined) ?? null;
        continue;
      }
      if (ipath === VRS_IPATH) {
        vrsBytes = text;
        continue;
      }
      unknown.push(ipath);
    }
    return {
      books,
      decisionFiles,
      decisionFilesByBook,
      alignmentFiles,
      resources,
      settings,
      vrsBytes,
      diskBytes,
      unknown,
    };
  }

  /** §8.8 universal seeding: one all-or-nothing seed covering every existing
   * journal-derived surface. Verified to reproduce the pre-seed state BEFORE
   * anything is published; staged completely before the first publish; a
   * durable marker makes an INTERRUPTED seed resume here on the next open
   * (review of 2026-08-20, P1) — finishing the sidecar canonicalization when
   * the published union already covers the disk, or re-staging the
   * DETERMINISTIC seed idempotently when it does not. */
  private async seedProject(
    options: OpenOptions,
    report: OpenReport,
    unionEvents: JournalEvent[],
  ): Promise<void> {
    const journal = this.mustJournal();
    const disk = await this.inventoryDisk();
    if (disk.unknown.length)
      throw new UnexplainedDivergenceError(
        this.mustRepo(),
        disk.unknown.map((ipath) => ({
          ipath,
          diskMd5: md5Hex(disk.diskBytes[ipath] ?? ''),
          projectedMd5: null,
        })),
      );

    // A sidecar record for a book with no USFM on disk has no generation root
    // to stamp — refuse with the reason rather than seal a refusable event.
    const orphaned: string[] = [];
    for (const [tool, byBook] of Object.entries(disk.decisionFilesByBook))
      for (const book of Object.keys(byBook))
        if (!disk.books[book]) orphaned.push(`${decisionsIpath(tool, book)} (no ${bookIpath(book)})`);
    for (const book of Object.keys(disk.alignmentFiles))
      if (!disk.books[book]) orphaned.push(`${alignmentsIpath(book)} (no ${bookIpath(book)})`);
    if (orphaned.length)
      throw new SeedMismatchError(
        this.mustRepo(),
        orphaned.map((o) => `${o}: a record without its book has no §8.5 generation root`),
      );

    // RESUME (review of 2026-08-20, P1): the seed marker routed us here with a
    // non-empty union — segments the interrupted seed already published. When
    // the union's fold fully covers the disk state, publication had completed
    // and only the sidecar canonicalization remains: finish it. Otherwise the
    // publication itself was partial; disk is still untouched pre-seed state
    // (convergence writes only start after full publication), so the
    // DETERMINISTIC candidate recomputed below reproduces the published
    // segments byte-identically and re-staging is idempotent.
    if (unionEvents.length > 0) {
      this.events = unionEvents;
      this.foldCache = null;
      if (this.seedStateProblems(this.foldNow(), disk).length === 0) {
        await this.finishSeedConvergence(disk, report);
        return;
      }
    }

    const seedEvents = seedFromSidecars({
      actor: journal.actorId,
      books: disk.books,
      decisionFiles: disk.decisionFiles as never,
      alignmentFiles: disk.alignmentFiles as never,
      resources: disk.resources,
      settings: disk.settings,
      meta: null,
      vrs: disk.vrsBytes === null ? null : { name: options.vrsName ?? 'unrecorded', bytes: disk.vrsBytes },
      source: options.seedSource ?? 'sidecar-migration',
    });
    if (seedEvents.length === 0) {
      await this.kv.delete(this.seedMarkerKey); // an empty repo has nothing to seed
      return;
    }

    // Verify BEFORE publishing (R-8.8.2): fold the seal-normalized form — what
    // a reader will actually fold — and compare against the pre-seed state.
    // USFM and vrs bytes must match EXACTLY; sidecars must match canonically
    // (their bytes converge to the projection form right after).
    const normalizedSeed = seedEvents.map(normalizeEvent);
    const mismatches = this.seedStateProblems(fold(normalizedSeed), disk);
    if (mismatches.length) throw new SeedMismatchError(this.mustRepo(), mismatches);

    // Torn-state guard for a resumed PARTIAL seed: every already-published
    // event must be reproduced identically by the recomputed candidate, or the
    // union is not this seed's prefix — a diagnosable stop, nothing overwritten.
    if (unionEvents.length > 0) {
      const candidate = new Map(normalizedSeed.map((e) => [e.ts, canonical(e)]));
      const torn = unionEvents.filter((e) => candidate.get(e.ts) !== canonical(e)).map((e) => e.ts);
      if (torn.length)
        throw new Error(
          `refuse to resume the interrupted seed of ${this.mustRepo()}: published seed events at ` +
            `${torn.join(', ')} are not reproduced by the recomputed deterministic seed — ` +
            `resolve by hand; nothing was overwritten (R-8.8.2/R-8.8.3)`,
        );
    }

    // The durable seed marker FIRST (an interrupted seed must resume, not fall
    // into the ordinary classifier), then stage EVERY part, then publish the
    // set (all-or-nothing: a crash mid-publication replays the remainder from
    // the exact staged bytes, and the marker routes the next open back here).
    await this.kv.set(this.seedMarkerKey, '1');
    for (const chunk of await this.chunkForSealing(seedEvents)) await journal.stage(chunk);
    const outcomes = await journal.replayStaged();
    const failed = outcomes.filter(
      (o) => o.outcome !== 'republished' && o.outcome !== 'already-published',
    );
    if (failed.length)
      throw new Error(
        `universal seed publication incomplete: ${failed
          .map((f) => `${f.ts}: ${f.outcome}${f.reason ? ` (${f.reason})` : ''}`)
          .join('; ')}`,
      );

    this.events = normalizedSeed;
    this.foldCache = null;
    await this.finishSeedConvergence(disk, report);
  }

  /** The seed's tail: converge legacy sidecar bytes to the canonical projection
   * form (content proven identical by seedStateProblems; only the byte form
   * changes), then clear the durable seed marker. */
  private async finishSeedConvergence(
    disk: Awaited<ReturnType<JournalingStore['inventoryDisk']>>,
    report: OpenReport,
  ): Promise<void> {
    await this.harvestResolutions();
    const foldOut = this.foldNow();
    const toConverge: string[] = [];
    for (const ipath of this.derivedPathsOf(foldOut)) {
      const bytes = this.projectionBytes(foldOut, ipath);
      if (bytes === null || disk.diskBytes[ipath] === bytes) continue;
      // An absent file whose projection is the §8.7 EMPTY document is "not yet
      // checkpointed" — seeding must not materialize it (a fresh creation's
      // first writeResources still expects absence).
      if (disk.diskBytes[ipath] === undefined && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes)) continue;
      toConverge.push(ipath);
    }
    await this.installWithMarker(toConverge);
    await this.kv.delete(this.seedMarkerKey);

    report.seeded = true;
    report.classification = 'seeded';
    report.regeneratedPaths = toConverge;
  }

  /** Does `folded` reproduce the pre-seed disk state (R-8.8.2)? USFM and vrs
   * bytes must match EXACTLY; sidecars canonically (their byte form converges
   * to the projection right after). Shared by the pre-publish verification and
   * by the resumed-seed coverage check, so the two can never disagree. The pin
   * and settings round-trips are included: a legacy document whose content the
   * §5.3/§5.4 flatten cannot represent (an unknown top-level field) REFUSES
   * here instead of being silently dropped by convergence. */
  private seedStateProblems(
    folded: FoldOutput,
    disk: Awaited<ReturnType<JournalingStore['inventoryDisk']>>,
  ): string[] {
    const problems: string[] = [];
    for (const [book, entry] of Object.entries(disk.books)) {
      if (folded.books[book]?.usfm !== entry.usfm)
        problems.push(`${bookIpath(book)}: fold-of-seed differs from disk bytes (is the file NFC?)`);
    }
    if (disk.vrsBytes !== null && folded.vrs?.bytes !== disk.vrsBytes)
      problems.push('vrs.json: fold-of-seed differs from disk bytes');
    if (disk.vrsBytes === null && folded.vrs !== null)
      problems.push('vrs.json: the fold carries a versification frame the disk lacks');
    for (const [tool, byBook] of Object.entries(disk.decisionFilesByBook)) {
      for (const [book, file] of Object.entries(byBook)) {
        const projected = (folded.decisions[tool] ?? []).filter(
          (d) => d.contextId.reference.bookId.toUpperCase() === book,
        );
        if (canonical(projected) !== canonical(file.decisions ?? []))
          problems.push(
            `${decisionsIpath(tool, book)}: fold-of-seed does not reproduce the stored decisions ` +
              `(co-present records on one §5.2 identity key cannot round-trip — resolve by hand)`,
          );
      }
    }
    for (const [book, file] of Object.entries(disk.alignmentFiles)) {
      const flat: Record<string, unknown> = {};
      for (const [chapter, verses] of Object.entries(file.chapters ?? {}))
        for (const [verse, record] of Object.entries(verses)) flat[`${chapter}:${verse}`] = record;
      if (canonical(folded.alignments[book] ?? {}) !== canonical(flat))
        problems.push(`${alignmentsIpath(book)}: fold-of-seed does not reproduce the stored records`);
    }
    try {
      const projectedResources = JSON.parse(projectResources(folded.pins)) as unknown;
      if (disk.resources !== null) {
        if (canonical(projectedResources) !== canonical(disk.resources))
          problems.push(`${RESOURCES_IPATH}: fold-of-seed does not reproduce the stored pins`);
      } else if (Object.keys(folded.pins).length) {
        problems.push(`${RESOURCES_IPATH}: the fold carries pins the disk lacks`);
      }
    } catch (error) {
      problems.push(`${RESOURCES_IPATH}: ${String((error as Error).message ?? error)}`);
    }
    const projectedSettings = JSON.parse(projectSettings(folded.settings)) as unknown;
    if (disk.settings !== null) {
      if (canonical(projectedSettings) !== canonical(disk.settings))
        problems.push(`${SETTINGS_IPATH}: fold-of-seed does not reproduce the stored settings`);
    } else if (Object.keys(folded.settings).length) {
      problems.push(`${SETTINGS_IPATH}: the fold carries settings the disk lacks`);
    }
    return problems;
  }

  /** Split one ts-ascending event list into as few actions as fit the §8.1
   * size cap. One action when it seals; otherwise halves, recursively. */
  private async chunkForSealing(events: JournalEvent[]): Promise<JournalEvent[][]> {
    try {
      await sealAction(events);
      return [events];
    } catch (error) {
      if (!/4 MiB/.test(String(error)) || events.length < 2) throw error;
      const mid = Math.ceil(events.length / 2);
      return [
        ...(await this.chunkForSealing(events.slice(0, mid))),
        ...(await this.chunkForSealing(events.slice(mid))),
      ];
    }
  }

  /** Evaluate `fn` under a different (tool, BOOK) resolution state — the prefix
   * classifier compares journal PREFIXES under the resolutions the disk
   * reflects, not under a staged record that belongs to a later action. */
  private withResolutions<T>(entries: Map<string, Record<string, unknown>>, fn: () => T): T {
    const saved = new Map(this.resolutions);
    this.resolutions.clear();
    for (const [key, value] of entries) this.resolutions.set(key, value);
    try {
      return fn();
    } finally {
      this.resolutions.clear();
      for (const [key, value] of saved) this.resolutions.set(key, value);
    }
  }

  /** Classify derived disk state against the journal projection and recover. */
  private async classifyAndRecover(
    actions: Array<{ actor: string; ts: string; events: JournalEvent[] }>,
    report: OpenReport,
    resolutionContext?: {
      pending: Record<string, { ts: string | null; resource: Record<string, unknown> }>;
      harvested: Map<string, Record<string, unknown>>;
    },
  ): Promise<void> {
    const foldOut = this.foldNow();
    const disk = await this.inventoryDisk();

    const compare = (fo: FoldOutput): Array<{ ipath: string; diskMd5: string | null; projectedMd5: string | null }> => {
      const diverged: Array<{ ipath: string; diskMd5: string | null; projectedMd5: string | null }> = [];
      const expected = new Set(this.derivedPathsOf(fo));
      for (const ipath of expected) {
        let projected: string | null;
        try {
          projected = this.projectionBytes(fo, ipath);
        } catch {
          projected = null; // e.g. a decision file whose resolution record is gone
        }
        const onDisk = disk.diskBytes[ipath];
        // An ABSENT file whose projection is the §8.7 EMPTY document has simply
        // not been checkpointed yet — never divergence (the same tolerance the
        // verifier and the checkpoint apply).
        if (onDisk === undefined && projected !== null && EMPTY_CHECKPOINT_DOCUMENTS.has(projected))
          continue;
        if (projected !== (onDisk ?? null))
          diverged.push({
            ipath,
            diskMd5: onDisk === undefined ? null : md5Hex(onDisk),
            projectedMd5: projected === null ? null : md5Hex(projected),
          });
      }
      for (const ipath of Object.keys(disk.diskBytes)) {
        if (expected.has(ipath)) continue;
        diverged.push({ ipath, diskMd5: md5Hex(disk.diskBytes[ipath]), projectedMd5: null });
      }
      for (const ipath of disk.unknown)
        if (!diverged.some((d) => d.ipath === ipath))
          diverged.push({ ipath, diskMd5: md5Hex(disk.diskBytes[ipath] ?? ''), projectedMd5: null });
      return diverged;
    };

    const diverged = compare(foldOut);
    if (diverged.length === 0) {
      await this.kv.delete(this.regenMarkerKey); // a completed regeneration's leftover
      report.classification = 'converged';
      return;
    }

    const regenerateForward = async (): Promise<void> => {
      // A diverged path the fold does not derive would have been refused below
      // as unexplained before any branch chose this recovery.
      const paths = diverged.map((d) => d.ipath);
      await this.installWithMarker(paths);
      report.classification = 'regenerated-forward';
      report.regeneratedPaths = paths;
    };

    // (0) The ONLY divergence is a pending resolution overlay (review of
    // 2026-08-20 round 2, P2): disk matches the fold exactly under the
    // DISK-HARVESTED resolutions, so what remains is materializing the staged
    // resolution change — pending-resolution-ahead, recovered forward like a
    // journal-ahead state.
    const pendingEntries = Object.entries(resolutionContext?.pending ?? {});
    if (
      pendingEntries.length > 0 &&
      this.withResolutions(resolutionContext!.harvested, () => compare(foldOut).length === 0)
    ) {
      await regenerateForward();
      return;
    }

    // (a) Our own durable regeneration marker covers every diverged path →
    // the journal is ahead by our recorded, interrupted regeneration.
    const marker = await this.kv.get(this.regenMarkerKey);
    if (marker !== undefined) {
      const markerPaths = new Set(JSON.parse(marker) as string[]);
      if (diverged.every((d) => markerPaths.has(d.ipath) && this.projectionBytes(foldOut, d.ipath) !== null)) {
        await regenerateForward();
        return;
      }
    }

    // (b) Disk equals the projection of a journal PREFIX (the journal is ahead
    // by the trailing action(s)) → regenerate forward. Bounded walk.
    const MAX_PREFIX = 8;
    for (let drop = 1; drop <= Math.min(MAX_PREFIX, actions.length); drop += 1) {
      const prefixEvents = actions.slice(0, actions.length - drop).flatMap((a) => a.events);
      let prefixFold: FoldOutput;
      try {
        prefixFold = fold(prefixEvents);
      } catch {
        break; // a prefix that does not fold explains nothing
      }
      // Each staged resolution travels WITH its own action (review of
      // 2026-08-20, P1; per-entry since round 3): a prefix carries an entry's
      // overlay only when it contains that entry's gate ts — and a ts-FREE
      // (resolution-only) entry belongs to no action, so NO prefix carries it.
      let prefixClean: boolean;
      if (pendingEntries.length === 0) {
        prefixClean = compare(prefixFold).length === 0;
      } else {
        const prefixTs = new Set(prefixEvents.map((e) => e.ts));
        const prefixResolutions = new Map(resolutionContext!.harvested);
        for (const [key, entry] of pendingEntries)
          if (entry.ts !== null && prefixTs.has(entry.ts)) prefixResolutions.set(key, entry.resource);
        prefixClean = this.withResolutions(prefixResolutions, () => compare(prefixFold).length === 0);
      }
      if (prefixClean) {
        await regenerateForward();
        return;
      }
    }

    // (c) Every diverged path is a book USFM (edited or created out-of-band) →
    // §8.8 reconcile: journal the committed bytes, then converge.
    const usfmOnly = diverged.every((d) => /^[A-Z0-9]{3}\.usfm$/.test(d.ipath));
    if (usfmOnly) {
      const journal = this.mustJournal();
      const clock = { issue: (): string => journal.issueTs() };
      for (const entry of diverged) {
        const book = entry.ipath.slice(0, 3);
        const committed = disk.diskBytes[entry.ipath];
        if (committed === undefined)
          throw new UnexplainedDivergenceError(this.mustRepo(), [entry]); // deleted out of band
        const events = reconcileUsfm(book, committed, this.foldNow(), clock, journal.actorId);
        if (events.length === 0) continue;
        await this.mustJournal().publish(events);
        this.events.push(...events.map(normalizeEvent));
        this.foldCache = null;
        report.reconciledBooks.push(book);
      }
      // Converge: the new projection must now equal (or replace) the disk bytes.
      const after = this.foldNow();
      const paths: string[] = [];
      for (const entry of diverged) {
        const bytes = this.projectionBytes(after, entry.ipath);
        if (bytes !== null && bytes !== disk.diskBytes[entry.ipath]) paths.push(entry.ipath);
      }
      await this.installWithMarker(paths);
      // A reconciled book may be NEW to the metadata (created out of band and
      // never registered): rescan so currentScope converges with the fold —
      // regeneration rescans the whole repo and rebuilds scope entries from
      // disk (§6 W-2; the x-role wipe is the accepted condition, D28).
      await this.api.remakeIngredients(this.mustRepo());
      report.classification = 'reconciled';
      report.regeneratedPaths = paths;
      return;
    }

    // (d) Unexplained — a visible, diagnosable stop. Nothing is overwritten.
    throw new UnexplainedDivergenceError(this.mustRepo(), diverged);
  }

  // ---- BurritoStore: mutations ---------------------------------------------------

  /** Scaffold + journal one book as a self-contained §8.5 book.add (issue #62).
   * `initialUsfm` (the client-side seed from the pinned source) is the book's
   * REAL initial state; without it the server scaffold's own bytes are
   * journaled. The server call is the container step; publication is
   * journal-first for the content itself. */
  async addBook(params: AddBookParams): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const book = params.book_code.toUpperCase();
      await this.api.newScriptureBook(this.mustRepo(), {
        book_code: params.book_code,
        book_title: params.book_title,
        book_abbr: params.book_abbr,
        add_cv: params.add_cv,
        vrs_name: params.vrs_name,
      });
      const usfm =
        params.initialUsfm ?? (await this.api.readIngredient(this.mustRepo(), bookIpath(book)));
      const { skeleton, verses } = decompose(toNfc(usfm));
      const foldOut = this.foldNow();
      const event: JournalEvent = {
        v: 1,
        op: 'book.add',
        actor: journal.actorId,
        ts: journal.issueTs(),
        base: foldOut.headsTs[`book|${book}`] ?? null, // a re-add chains to the removal
        book,
        scope: [],
        skeleton,
        initialVerses: verses,
      };
      await this.publishAndRegenerate([event], [bookIpath(book)]);
    });
  }

  /** Whole-USFM boundary adapter (issue #62 mapping): a verse edit publishes
   * text.verse.set per changed slot; a slot-preserving skeleton change
   * publishes text.skeleton.set; a slot-set change is REFUSED — use
   * applyStructuralEdit. Content is NFC-normalized here (I-4 writer duty), so
   * the diff compares what will actually seal. */
  async writeBook(book: string, usfm: string, opts: WriteBookOptions = {}): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const code = book.toUpperCase();
      await this.checkExpectMd5(bookIpath(code), opts.expectMd5);
      const foldOut = this.foldNow();
      const projected = foldOut.books[code];
      if (!projected)
        throw new Error(
          `writeBook(${code}): the journal projects no such book — book creation goes through addBook (issue #62)`,
        );
      const { skeleton: inSkeleton, verses: inVerses } = decompose(toNfc(usfm));
      const projDecomposed = decompose(projected.usfm);
      if (JSON.stringify(slotKeysOf(inSkeleton)) !== JSON.stringify(slotKeysOf(projDecomposed.skeleton)))
        throw new Error(
          `writeBook(${code}) changes the slot set — a topology change must state its ` +
            `transitions and dispositions; use applyStructuralEdit (§8.4/§8.5, issue #62)`,
        );
      const events: JournalEvent[] = [];
      if (inSkeleton !== projDecomposed.skeleton)
        events.push({
          v: 1,
          op: 'text.skeleton.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`skel|${code}`],
          book: code,
          skeleton: inSkeleton,
        });
      for (const vkey of slotKeysOf(inSkeleton)) {
        if (inVerses[vkey] === projected.verses[vkey]) continue;
        const sep = vkey.indexOf(':');
        events.push({
          v: 1,
          op: 'text.verse.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          // NEVER rootless on a live key (R-8.5.15): the slot's head exists
          // from the book.add that created it; the skeleton head is the
          // fallback observation for a stub slot (the reference reconcile rule).
          base: foldOut.headsTs[`text|${code}|${vkey}`] ?? foldOut.headsTs[`skel|${code}`],
          book: code,
          chapter: vkey.slice(0, sep),
          verse: vkey.slice(sep + 1),
          text: inVerses[vkey],
        });
      }
      await this.publishAndRegenerate(events, [bookIpath(code)]);
    });
  }

  /** The explicit structural-edit operation (issue #62): ONE §8.5
   * text.structure.apply with the complete transition/disposition set, built
   * by the SAME conservative builder as §8.8 reconcile (no seed marker — this
   * is an in-app user action, not migrated data). */
  async applyStructuralEdit(book: string, usfm: string): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const code = book.toUpperCase();
      const foldOut = this.foldNow();
      if (!foldOut.books[code])
        throw new Error(
          `applyStructuralEdit(${code}): the journal projects no such book — creation goes through addBook`,
        );
      const clock = { issue: (): string => journal.issueTs() };
      const events = reconcileUsfm(code, toNfc(usfm), foldOut, clock, journal.actorId, {
        seed: null,
      });
      // Affected surfaces: the book itself, plus every sidecar its dispositions
      // may have re-keyed/invalidated (alignments + each tool's decision file).
      const affected = [bookIpath(code)];
      if (foldOut.alignments[code]) affected.push(alignmentsIpath(code));
      for (const tool of Object.keys(foldOut.decisions))
        if (foldOut.decisions[tool].some((d) => d.contextId.reference.bookId.toUpperCase() === code))
          affected.push(decisionsIpath(tool, code));
      await this.publishAndRegenerate(events, affected);
    });
  }

  /** §5.1 write: diff the affected verse records against the projection and
   * publish one action of align.verse.set events — including the explicit
   * empty-state record when a stored record disappears (the §8.5 removal). */
  async writeAlignments(book: string, data: AlignmentFile, expectMd5?: string | null): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const code = book.toUpperCase();
      await this.checkExpectMd5(alignmentsIpath(code), expectMd5);
      const foldOut = this.foldNow();
      const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
      if (generation === undefined)
        throw new Error(`writeAlignments(${code}): the journal projects no such book`);
      const normalized = normalizeAlignmentFile(data);
      const incoming: Record<string, AlignmentVerseRecord> = {};
      for (const [chapter, verses] of Object.entries(normalized.chapters ?? {}))
        for (const [verse, record] of Object.entries(verses)) incoming[`${chapter}:${verse}`] = record;
      const projected = foldOut.alignments[code] ?? {};

      const events: JournalEvent[] = [];
      const pushRecord = (vkey: string, record: Record<string, unknown>): void => {
        const sep = vkey.indexOf(':');
        events.push({
          v: 1,
          op: 'align.verse.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`align|${code}|${vkey}`] ?? null, // first write is ordinary (anchored by generation)
          generation,
          book: code,
          chapter: vkey.slice(0, sep),
          verse: vkey.slice(sep + 1),
          ...toNfc(record),
        });
      };
      for (const [vkey, record] of Object.entries(incoming)) {
        const current = projected[vkey];
        if (current !== undefined && canonical(current) === canonical(record)) continue;
        pushRecord(vkey, record as unknown as Record<string, unknown>);
      }
      for (const [vkey, record] of Object.entries(projected)) {
        if (incoming[vkey] !== undefined) continue;
        if (isEmptyAlignmentRecord(record)) continue; // already the removal state
        // The DEFINED removal: an explicit empty record, projected, not absence
        // (R-8.5.11). The validity hash tracks the current folded verse text.
        const verseContent = foldOut.books[code]?.verses?.[vkey];
        pushRecord(vkey, {
          alignments: [],
          wordBank: [],
          targetVerseMd5:
            verseContent !== undefined ? verseTextMd5(verseContent) : (record.targetVerseMd5 as string),
        });
      }
      await this.publishAndRegenerate(events, [alignmentsIpath(code)]);
    });
  }

  /** §5.2 single-decision write: ONE check.decision.set preserving identity
   * values exactly. A key match whose quoteString differs is REFUSED — under
   * §8.5 one identity key holds one live register, so the co-present-record
   * form the pre-journal writer appended cannot round-trip; the resolution
   * path for a changed resource is the coordinated gateway change. */
  async upsertDecision(
    tool: string,
    book: string,
    decision: Decision,
    resource?: { repoPath: string; version: string; languageSet?: string },
  ): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const code = book.toUpperCase();
      const foldOut = this.foldNow();
      const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
      if (generation === undefined)
        throw new Error(`upsertDecision(${tool}, ${code}): the journal projects no such book`);

      // §5.2 resolution record (D17/D30): stamped only when absent or agreeing —
      // a decision write must never relabel a book's file to another resource.
      const resolutionKey = `${tool}\n${code}`;
      const stored = this.resolutions.get(resolutionKey) as
        | { repoPath: string; version: string }
        | undefined;
      if (resource) {
        const agrees =
          !stored || (samePath(stored.repoPath, resource.repoPath) && stored.version === resource.version);
        if (agrees) this.resolutions.set(resolutionKey, resource);
      }
      if (!this.resolutions.has(resolutionKey))
        throw new Error(
          `upsertDecision(${tool}, ${code}): no (tool, book) resolution record — §5.2 requires ` +
            `\`resource\` (D30); pass the session's resolution`,
        );

      const incoming = normalizeDecision(decision);
      const key = decisionRegisterKey(tool, incoming);
      const projected = (foldOut.decisions[tool] ?? []).find(
        (d) => decisionRegisterKey(tool, d as unknown as Decision) === key,
      );
      if (projected && (projected as { contextId: { quoteString?: unknown } }).contextId.quoteString !== incoming.contextId.quoteString)
        throw new Error(
          `upsertDecision(${tool}, ${code}): the stored decision at this §5.2 identity key carries ` +
            `a different quoteString — the resource behind this check changed; re-derive and carry ` +
            `over (a warned update) instead of overwriting (§5.2, issue #62)`,
        );
      if (projected && canonical(projected) === canonical(incoming)) {
        return; // byte-identical decision: nothing to record
      }
      const event: JournalEvent = {
        v: 1,
        op: 'check.decision.set',
        actor: journal.actorId,
        ts: journal.issueTs(),
        base: foldOut.headsTs[key] ?? null, // a first write is ordinary (anchored by generation)
        generation,
        toolId: tool,
        decision: toNfc(incoming) as unknown as Record<string, unknown>,
      };
      await this.publishAndRegenerate([event], [decisionsIpath(tool, code)], {
        [resolutionKey]: this.resolutions.get(resolutionKey)!,
      });
    });
  }

  /** Whole-file decision write: diff ALL records against the projection and
   * publish the result as ONE action (issue #62 mapping). A projected record
   * whose identity key disappears from the file is invalidated-and-retained —
   * §8.5: decisions are never deleted. */
  async writeDecisions(
    tool: string,
    book: string,
    file: DecisionFile,
    expectMd5?: string | null,
  ): Promise<string> {
    return this.queue(async () => {
      await this.checkExpectMd5(decisionsIpath(tool, book), expectMd5);
      const ipath = decisionsIpath(tool, book.toUpperCase());
      const { events, resolutionChanged } = this.decisionDiffEvents(tool, book, file);
      const entries = {
        [`${tool}\n${book.toUpperCase()}`]: file.resource as Record<string, unknown>,
      };
      if (events.length) {
        await this.publishAndRegenerate(events, [ipath], entries);
      } else if (resolutionChanged) {
        // A resolution-only change (review of 2026-08-20 round 2, P2): no
        // journal event exists for derive-time state, but the disk file MUST
        // move — success is never reported over an unchanged sidecar.
        await this.applyResolutionOnly(entries, [ipath]);
      }
      const bytes = this.projectionBytes(this.foldNow(), ipath);
      return bytes === null ? '' : md5Hex(bytes);
    });
  }

  /** The whole-file §5.2 diff (shared by writeDecisions and the coordinated
   * gateway change): per incoming record an upsert event when changed; per
   * disappeared identity key an invalidate-and-retain event. Also (re)stamps
   * the (tool, BOOK) resolution record — whole-file writers carry authority
   * over it (a gateway change is exactly the flow that moves it). */
  private decisionDiffEvents(
    tool: string,
    book: string,
    file: DecisionFile,
  ): { events: JournalEvent[]; resolutionChanged: boolean } {
    const journal = this.mustJournal();
    const code = book.toUpperCase();
    const foldOut = this.foldNow();
    const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
    if (generation === undefined)
      throw new Error(`writeDecisions(${tool}, ${code}): the journal projects no such book`);
    if (!file.resource)
      throw new Error(
        `writeDecisions(${tool}, ${code}): the file carries no (tool, book) resolution record — ` +
          `§5.2 requires \`resource\` (D30)`,
      );
    const resolutionChanged =
      canonical(this.resolutions.get(`${tool}\n${code}`) ?? null) !== canonical(file.resource);
    this.resolutions.set(`${tool}\n${code}`, file.resource);

    const incoming = (file.decisions ?? []).map(normalizeDecision);
    const incomingKeys = new Set(incoming.map((d) => decisionRegisterKey(tool, d)));
    const projectedForBook = (foldOut.decisions[tool] ?? []).filter(
      (d) => d.contextId.reference.bookId.toUpperCase() === code,
    ) as unknown as Decision[];
    const projectedByKey = new Map(projectedForBook.map((d) => [decisionRegisterKey(tool, d), d]));

    const events: JournalEvent[] = [];
    const pushDecision = (key: string, decision: Decision): void => {
      events.push({
        v: 1,
        op: 'check.decision.set',
        actor: journal.actorId,
        ts: journal.issueTs(),
        base: foldOut.headsTs[key] ?? null,
        generation,
        toolId: tool,
        decision: toNfc(decision) as unknown as Record<string, unknown>,
      });
    };
    for (const record of incoming) {
      const key = decisionRegisterKey(tool, record);
      const current = projectedByKey.get(key);
      if (current !== undefined && canonical(current) === canonical(record)) continue;
      pushDecision(key, record);
    }
    for (const [key, current] of projectedByKey) {
      if (incomingKeys.has(key)) continue;
      if (current.invalidated === true) continue; // already retained-invalid
      // §8.5 R-8.5.11: never deleted — invalidate and retain, preserving a
      // user-set "todo" triage exactly as carry-over does (§5.2/D36).
      pushDecision(key, {
        ...current,
        invalidated: true,
        status: current.status === 'todo' ? 'todo' : 'invalid',
      });
    }
    return { events, resolutionChanged };
  }

  /** §5.3 write: diff pins per slot into resource.pin.set events; a folded slot
   * absent from the document removes with the spec's removed: true form. */
  async writeResources(resources: ResourcesFile, expectMd5?: string | null): Promise<void> {
    return this.queue(async () => {
      await this.checkExpectMd5(RESOURCES_IPATH, expectMd5);
      const journal = this.mustJournal();
      const foldOut = this.foldNow();
      const events: JournalEvent[] = [];
      const incoming = flattenPins(resources);
      const incomingSlots = new Set(incoming.map((p) => p.slot));
      for (const { slot, entry } of incoming) {
        const current = foldOut.pins[slot];
        if (current !== undefined && canonical(current) === canonical(entry)) continue;
        events.push({
          v: 1,
          op: 'resource.pin.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`pin|${slot}`] ?? null,
          slot,
          entry: toNfc(entry),
        });
      }
      for (const slot of Object.keys(foldOut.pins)) {
        if (incomingSlots.has(slot)) continue;
        events.push({
          v: 1,
          op: 'resource.pin.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`pin|${slot}`] ?? null,
          slot,
          removed: true,
        });
      }
      await this.publishAndRegenerate(events, [RESOURCES_IPATH]);
    });
  }

  /** §5.4 write: diff per settings path into settings.set events; a folded
   * top-level path absent from the document removes with removed: true. */
  async writeSettings(settings: SettingsFile): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const foldOut = this.foldNow();
      const events: JournalEvent[] = [];
      const incomingKeys = Object.keys(settings).filter((k) => k !== 'schemaVersion');
      for (const path of incomingKeys) {
        const current = foldOut.settings[path];
        const value = settings[path];
        if (current !== undefined && canonical(current) === canonical(value)) continue;
        if (current === undefined && value === undefined) continue;
        events.push({
          v: 1,
          op: 'settings.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`set|${path}`] ?? null,
          path,
          value: toNfc(value),
        });
      }
      for (const path of Object.keys(foldOut.settings)) {
        if (path.includes('.')) continue; // a dotted register is not a whole-document key
        if (incomingKeys.includes(path)) continue;
        events.push({
          v: 1,
          op: 'settings.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`set|${path}`] ?? null,
          path,
          removed: true,
        });
      }
      await this.publishAndRegenerate(events, [SETTINGS_IPATH]);
    });
  }

  /** §8.5 project.meta.set: diff per dotted path against the folded overlay.
   * The platform exposes NO HTTP metadata write route (D28), so the event is
   * journaled and commit() verifies materialization — refusing loudly when the
   * overlay cannot be applied, never emitting a silently incomplete checkpoint. */
  async writeProjectMeta(meta: Record<string, unknown>): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      const foldOut = this.foldNow();
      const events: JournalEvent[] = [];
      for (const [path, value] of Object.entries(meta)) {
        const current = foldOut.projectMeta[path];
        if (current !== undefined && canonical(current) === canonical(value)) continue;
        events.push({
          v: 1,
          op: 'project.meta.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`meta|${path}`] ?? null,
          path,
          value: toNfc(value),
        });
      }
      for (const path of Object.keys(foldOut.projectMeta)) {
        if (Object.hasOwn(meta, path)) continue;
        events.push({
          v: 1,
          op: 'project.meta.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`meta|${path}`] ?? null,
          path,
          removed: true,
        });
      }
      await this.publishAndRegenerate(events, []); // no HTTP-writable derived file
    });
  }

  /** The coordinated gateway change (issue #62): validate every precondition,
   * compute the COMPLETE multi-event action (every affected decision record +
   * every pin change), durably stage and publish it ONCE, then regenerate all
   * derived files from the fold. If a post-publication write fails, recovery is
   * FORWARD from the published action — canonical files are never byte-rolled
   * back behind it. */
  async applyGatewayChange(plan: GatewayChangePlan): Promise<void> {
    return this.queue(async () => {
      const journal = this.mustJournal();
      // 1. Validate ALL preconditions before anything is staged or written.
      await this.checkExpectMd5(RESOURCES_IPATH, plan.resourcesMd5);
      for (const write of plan.decisions)
        await this.checkExpectMd5(decisionsIpath(write.tool, write.book), write.expectMd5);

      // 2. Compute the complete action: every decision diff + the pin diff.
      const foldOut = this.foldNow();
      const events: JournalEvent[] = [];
      const affected: string[] = [];
      const changedResolutions: Record<string, Record<string, unknown>> = {};
      let anyResolutionChanged = false;
      for (const write of plan.decisions) {
        const diff = this.decisionDiffEvents(write.tool, write.book, write.file);
        events.push(...diff.events);
        anyResolutionChanged ||= diff.resolutionChanged;
        affected.push(decisionsIpath(write.tool, write.book.toUpperCase()));
        changedResolutions[`${write.tool}\n${write.book.toUpperCase()}`] =
          write.file.resource as Record<string, unknown>;
      }
      const incoming = flattenPins(plan.resources);
      const incomingSlots = new Set(incoming.map((p) => p.slot));
      for (const { slot, entry } of incoming) {
        const current = foldOut.pins[slot];
        if (current !== undefined && canonical(current) === canonical(entry)) continue;
        events.push({
          v: 1,
          op: 'resource.pin.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`pin|${slot}`] ?? null,
          slot,
          entry: toNfc(entry),
        });
      }
      for (const slot of Object.keys(foldOut.pins)) {
        if (incomingSlots.has(slot)) continue;
        events.push({
          v: 1,
          op: 'resource.pin.set',
          actor: journal.actorId,
          ts: journal.issueTs(),
          base: foldOut.headsTs[`pin|${slot}`] ?? null,
          slot,
          removed: true,
        });
      }
      affected.push(RESOURCES_IPATH);

      // 3–5. One publication, then regenerate + verify; forward-only recovery.
      // The NEW resolutions are durably staged with the action (P1): a crash
      // between publication and the sidecar writes must regenerate the new
      // decisions under the NEW resource, never the old disk file's. A change
      // whose ONLY effect is resolution records (every decision and pin
      // unchanged) still materializes them (round 2, P2).
      if (events.length) await this.publishAndRegenerate(events, affected, changedResolutions);
      else if (anyResolutionChanged) await this.applyResolutionOnly(changedResolutions, affected);
    });
  }

  // ---- BurritoStore: the checkpoint ---------------------------------------------

  /** The complete §8.7 checkpoint pipeline (issue #62): fold → materialize the
   * complete derived set (refusing incomplete or path-escaping output) →
   * detect divergence (never silently repaired) → install and byte-verify →
   * rescan → verify the regenerated metadata semantics → server commit. */
  async commit(message: string): Promise<void> {
    return this.queue(async () => {
      const repo = this.mustRepo();
      const foldOut = this.foldNow();

      // The §8.7 metadata overlay cannot be materialized over HTTP (D28: no
      // metadata write route). Refuse loudly rather than emit a checkpoint the
      // fold does not explain (R-8.7.4 posture).
      if (Object.keys(foldOut.projectMeta).length || foldOut.projectMetaRemoved.length)
        throw new Error(
          `checkpoint refused: the journal carries a project.meta.set overlay ` +
            `(${[...Object.keys(foldOut.projectMeta), ...foldOut.projectMetaRemoved].join(', ')}) ` +
            `and the platform exposes no HTTP metadata write route (D28) — the derived ` +
            `metadata.json cannot be regenerated to match the fold (§8.7)`,
        );

      // Materialize the COMPLETE set in memory first — derivedProjections
      // throws on any missing mandatory input or path-escaping key (§8.7).
      const baseMetadata = await this.api.getMetadataRaw(repo);
      const resolutions: Record<string, Record<string, unknown>> = {};
      for (const [key, resource] of this.resolutions) {
        const [tool, book] = key.split('\n');
        (resolutions[tool] ??= {})[book] = resource;
      }
      const projections = derivedProjections(foldOut, { baseMetadata, resolutions });
      delete projections['metadata.json']; // regenerated by the server rescan, not writable (D28)

      // Divergence detection (R-8.7.5): enumerate from the fold's expected set
      // and refuse an out-of-band edit or deletion — never silently repair it.
      // Per-mutation regeneration keeps disk == projection for every folded
      // path, so at checkpoint the only legitimate writes are (a) paths a
      // leftover crash marker recorded, and (b) the FIRST materialization of a
      // §8.7-complete empty document (resources/settings with nothing folded
      // yet) that no mutation has produced. Everything else that differs is
      // out-of-band and refuses.
      const marker = await this.kv.get(this.regenMarkerKey);
      const markerPaths = new Set(marker === undefined ? [] : (JSON.parse(marker) as string[]));
      const stale: string[] = [];
      const toWrite: Array<{ ipath: string; bytes: string }> = [];
      const diskPaths = (await this.api.listPaths(repo)).filter(
        (p) => !p.startsWith('checking/journal/') && !isUnjournaledIngredient(p),
      );
      for (const [ipath, bytes] of Object.entries(projections)) {
        const disk = await this.readIngredientOrNull(ipath);
        if (disk === bytes) continue; // byte-verified in place
        // Legitimate writes at checkpoint: a leftover crash marker's paths, and
        // the FIRST materialization of a §8.7-complete EMPTY document (an
        // absent file per-mutation regeneration never produces). An absent file
        // with a NON-empty projection was deleted out of band — refused.
        if (markerPaths.has(ipath) || (disk === null && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes))) {
          toWrite.push({ ipath, bytes });
          continue;
        }
        stale.push(
          `${ipath} (${disk === null ? 'deleted out of band' : 'edited out of band'})`,
        );
      }
      for (const ipath of diskPaths) {
        if (Object.hasOwn(projections, ipath)) continue;
        stale.push(`${ipath} (on disk, not derived by the fold)`);
      }
      if (stale.length)
        throw new Error(
          `checkpoint refused: derived state diverges out-of-band at ${stale.join(', ')} — ` +
            `never silently repaired (R-8.7.5); reopen the project to reconcile (§8.8)`,
        );

      // Install + byte-verify, bracketed by the durable OUTSTANDING-set marker
      // (installWithMarker also retries any older outstanding path inline).
      await this.installWithMarker(toWrite.map((w) => w.ipath));

      // Rescan (registers everything; rebuilds the ingredients table and
      // currentScope — the x-role wipe is the accepted condition, D28/W-2),
      // then verify the regenerated scope against the fold (R-8.7.2).
      await this.api.remakeIngredients(repo);
      const after = await this.api.getMetadataRaw(repo);
      const scopeAfter = (after?.type?.flavorType?.currentScope ?? {}) as Record<string, string[]>;
      if (canonical(scopeAfter) !== canonical(foldOut.scope))
        throw new Error(
          `checkpoint refused before commit: the rescanned currentScope ` +
            `(${canonical(scopeAfter)}) does not equal the fold's scope state ` +
            `(${canonical(foldOut.scope)}) — R-8.7.2; the derived writes stand and the ` +
            `journal remains authoritative`,
        );

      await this.api.addAndCommit(repo, message);
    });
  }
}

/** Read-only project access for surfaces that must not mutate and must not run
 * recovery (the Home progress bars, the settings dialog's read half, project
 * listing). Deliberately NOT a BurritoStore: it has no mutation surface at all,
 * and it never claims the platform's current-project slot. */
export class ProjectReader {
  private readonly raw: HttpStore;
  private repo: string | null = null;

  constructor(init: { api: ServerApi }) {
    this.raw = new HttpStore({ api: init.api });
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.raw.listProjects();
  }

  async open(repoPath: string): Promise<ProjectSummary> {
    // Bind WITHOUT setCurrentProject: a reader never claims the shell's
    // current-project slot (HttpStore.open does; this is read-only surface).
    const summaries = await this.raw.listProjects();
    const summary = summaries.find((p) => p.id === repoPath);
    if (!summary) throw new Error(`no such project: ${repoPath}`);
    this.repo = repoPath;
    return summary;
  }

  readBook(book: string): Promise<{ usfm: string; md5: string }> {
    return this.boundRaw().readBook(book);
  }

  readSettings(): Promise<SettingsFile | null> {
    return this.boundRaw().readSettings();
  }

  readResources(): Promise<ResourcesFile | null> {
    return this.boundRaw().readResources();
  }

  private boundRaw(): HttpStore {
    if (this.repo === null) throw new Error('ProjectReader: call open(repoPath) first');
    // HttpStore reads need the bound path; rebinding via a fresh instance keeps
    // HttpStore's own open() (with its current-project side effect) unused.
    return new HttpStore({ api: this.raw.api, repoPath: this.repo });
  }
}

export type { WriteBookOptions } from '../httpStore';
export { TOOL_IDS };
