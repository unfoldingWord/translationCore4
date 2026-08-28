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
import type { VrsRegister } from '../versification';
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

/** One append-only intent-ledger record (issue #62, round 6): everything
 * recovery needs that the journal does not carry, written ONCE (setIfAbsent)
 * BEFORE the action publishes, and deleted only by a provably-safe prune once
 * convergence is derived from reality. ~261 bytes per record; appends are O(1)
 * against the old whole-blob rewrites. */
export interface IntentRecord {
  /** The record's key: the action's first event ts ('mutation'/'seed'), or a
   * fresh HLC ts of the record's own ('unconditional'). */
  ts: string;
  /** 'mutation' applies when ts is in the journal union; 'unconditional' is
   * its own whole intent (a resolution-only change has no action to gate on);
   * 'seed' marks an in-flight §8.8 universal seed. */
  kind: 'mutation' | 'unconditional' | 'seed';
  /** Every derived ipath this intent's regeneration must converge. */
  affectedPaths: string[];
  /** The (tool\nBOOK) §5.2 resolution records the action's decision files
   * depend on (derive-time state the journal does not carry, D30). */
  resolutions?: Record<string, Record<string, unknown>>;
  /** Deterministic resume parameters (kind 'seed' only). */
  seed?: { source: 'creation' | 'sidecar-migration'; vrsName?: string };
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

interface DiskInventory {
  books: Record<string, { usfm: string; scope: string[] }>;
  decisionFiles: Record<string, DecisionFile>;
  decisionFilesByBook: Record<string, Record<string, DecisionFile>>;
  alignmentFiles: Record<string, AlignmentFile>;
  resources: ResourcesFile | null;
  settings: SettingsFile | null;
  vrsBytes: string | null;
  diskBytes: Record<string, string>;
  unknown: string[];
}

interface DivergedPath {
  ipath: string;
  diskMd5: string | null;
  projectedMd5: string | null;
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

  /** The versification register from the FOLD, not from disk (issue #15).
   *
   * The fold is the authority here because the scheme NAME exists only in the
   * §8.5 `project.vrs.set` event — it is nowhere in the burrito. The platform
   * takes the name at creation, uses it to pick a template file, and discards
   * it; the ingredient it writes carries no name and no role. So disk gives
   * bytes only, while the sealed register gives bytes AND the name tC4 chose.
   *
   * A creation seed records the real name. Any other seed records the
   * `UNRECORDED_SCHEME` placeholder, which `resolveProjectScheme` rejects as a
   * scheme name and fingerprints past. */
  readVersification(): Promise<VrsRegister | null> {
    const vrs = this.foldNow().vrs;
    return Promise.resolve(vrs === null ? null : { name: vrs.name, bytes: vrs.bytes });
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

  /** Remove one derived file whose projection disappeared (official review
   * round 6, R1): a structural edit can retire a book's last alignment (or
   * book.remove the book itself), after which the fold derives NOTHING for
   * the path — leaving the old file would be an extra derived path every
   * later open, checkpoint, and verifier run refuses. The platform delete
   * renames to `.bak` (hidden from listPaths), so the undo survives. */
  private async removeDerived(ipath: string): Promise<void> {
    await this.api.deleteIngredient(this.mustRepo(), ipath);
    const readBack = await this.readIngredientOrNull(ipath);
    if (readBack !== null)
      throw new Error(
        `derived delete verification failed for ${ipath}: the file is still readable — ` +
          `the journal remains authoritative; reopening recovers forward`,
      );
  }

  /** Is this a derived path CLASS whose projection can legitimately disappear
   * (and whose stale file must then be removed)? Books (book.remove),
   * alignment and decision sidecars (structural retirement) — never
   * resources/settings (they project the §8.7 EMPTY document instead) and
   * never vrs.json (creation-only, retained forever). */
  private static isRemovableDerivedClass(ipath: string): boolean {
    return (
      /^[A-Z0-9]{3}\.usfm$/.test(ipath) ||
      /^checking\/alignments\/[A-Z0-9]{3}\.json$/.test(ipath) ||
      /^checking\/(translationWords|translationNotes)\/[A-Z0-9]{3}\.json$/.test(ipath)
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

  // ---- the intent ledger ---------------------------------------------------

  /** The append-only intent-ledger prefix (issue #62, round 6). ONE kv surface
   * replaces the retired regeneration marker, seed marker and pending-resolution
   * candidate lists: `intent:<repoPath>:<actorId>:<ts>` holds one immutable
   * IntentRecord, written ONCE via setIfAbsent and never rewritten. Completion
   * is never recorded — it is DERIVED (intentConverged), recovery folds the
   * ledger against the world, and the only destructive writes are the
   * provably-safe prunes (pruneConvergedIntents; the stale-record prune in
   * recoverAndConverge). */
  private get intentPrefix(): string {
    return `intent:${this.mustRepo()}:${this.actorId}:`;
  }

  /** Append one immutable ledger record. setIfAbsent is the ONLY write path:
   * a DIFFERENT record already holding the key is refused loudly, never
   * replaced (append-only); a byte-identical re-append is an idempotent no-op
   * (the deterministic seed resume re-appends its own record). */
  private async appendIntent(record: IntentRecord): Promise<void> {
    const bytes = JSON.stringify(record);
    const stored = await this.kv.setIfAbsent(`${this.intentPrefix}${record.ts}`, bytes);
    if (stored !== bytes)
      throw new Error(
        `refuse to append intent at ts ${record.ts}: the ledger already holds a DIFFERENT ` +
          `record at this key — records are immutable, never rewritten`,
      );
  }

  /** Read the whole ledger, ts-sorted (key order is HLC/causal order — every
   * record is appended inside the per-project queue by this one actor). A
   * record that does not parse is a diagnosable stop, never silently skipped. */
  private async readIntents(): Promise<IntentRecord[]> {
    const keys = (await this.kv.keys(this.intentPrefix)).sort();
    const records: IntentRecord[] = [];
    for (const key of keys) {
      const raw = await this.kv.get(key);
      if (raw === undefined) continue; // pruned concurrently
      try {
        records.push(JSON.parse(raw) as IntentRecord);
      } catch {
        throw new Error(`refuse to proceed: intent-ledger record ${key} does not parse`);
      }
    }
    return records;
  }

  /** Is a record's gate satisfied — may its content apply? A 'mutation' or
   * 'seed' record applies only when its action's ts is actually in the
   * journal; an 'unconditional' record IS the whole intent (there is no
   * action to gate on) and always applies. */
  private intentGateSatisfied(record: IntentRecord, journaledTs: ReadonlySet<string>): boolean {
    return record.kind === 'unconditional' || journaledTs.has(record.ts);
  }

  /** The (tool, BOOK) resolution view regeneration must project under (the
   * round-5 durable-overlay rule, now reading the ledger): the in-memory
   * register overlaid, in ts order, with the resolutions of every record
   * whose gate holds — so the LATEST gate-satisfied intent wins per key.
   * Supersession is this QUERY at fold time, never a destructive write at
   * stage time. */
  private async ledgerResolutionOverlay(
    intents?: IntentRecord[],
    journaledTs?: ReadonlySet<string>,
  ): Promise<Map<string, Record<string, unknown>>> {
    const records = intents ?? (await this.readIntents());
    const merged = new Map(this.resolutions);
    if (records.length === 0) return merged;
    const gate = journaledTs ?? new Set(this.events.map((e) => e.ts));
    for (const record of records) {
      if (!record.resolutions || !this.intentGateSatisfied(record, gate)) continue;
      for (const [key, resource] of Object.entries(record.resolutions)) merged.set(key, resource);
    }
    return merged;
  }

  /** Is `record` CONVERGED? Derived from reality, never recorded: the gate
   * holds AND every affectedPath's disk bytes equal the fold's projection
   * under the ledger overlay. Tolerances match the recovery classifier's: a
   * path the fold does not derive has nothing to install, and an absent file
   * whose projection is the §8.7 EMPTY document is "not yet checkpointed". */
  private async intentConverged(
    record: IntentRecord,
    foldOut: FoldOutput,
    overlay: Map<string, Record<string, unknown>>,
    journaledTs: ReadonlySet<string>,
  ): Promise<boolean> {
    if (!this.intentGateSatisfied(record, journaledTs)) return false;
    for (const ipath of record.affectedPaths) {
      let bytes: string | null;
      try {
        bytes = this.withResolutions(overlay, () => this.projectionBytes(foldOut, ipath));
      } catch {
        return false; // e.g. a decision file whose resolution record is gone
      }
      const disk = await this.readIngredientOrNull(ipath);
      if (bytes === null) {
        // The fold derives nothing here — converged only once the stale file
        // is actually GONE (round 6 R1: a skipped removal is not convergence).
        if (disk !== null && JournalingStore.isRemovableDerivedClass(ipath)) return false;
        continue;
      }
      if (disk === bytes) continue;
      if (disk === null && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes)) continue;
      return false;
    }
    return true;
  }

  /** The provably-safe prune: delete a ledger record only when it is
   * derived-CONVERGED, and only after the intentConverged check that proves
   * it. Runs lazily — at the end of a successful mutation and at the end of a
   * successful open(). kv.delete's early-resolve is acceptable HERE by
   * construction: a delete that did not survive a crash merely leaves a
   * converged record behind, which costs one re-check at the next open and
   * can never lose an intent — the deletion is not load-bearing. */
  private async pruneConvergedIntents(): Promise<void> {
    const intents = await this.readIntents();
    if (intents.length === 0) return;
    const journaledTs = new Set(this.events.map((e) => e.ts));
    const overlay = await this.ledgerResolutionOverlay(intents, journaledTs);
    const foldOut = this.foldNow();
    // Round 6 B2 — the prune must never change the overlay's value for any
    // key. The overlay is "latest live record wins per key", so deleting a
    // NEWER record while an OLDER live record shares one of its resolution
    // keys would resurrect the superseded resolution at the next query (and
    // the inline retry would then rewrite the derived file backwards). Walk
    // ts-ascending: a record whose resolution keys overlap a RETAINED older
    // record stays, converged or not, until that older record goes.
    const heldKeys = new Set<string>();
    for (const record of intents) {
      const keys = Object.keys(record.resolutions ?? {});
      const blocked = keys.some((key) => heldKeys.has(key));
      if (!blocked && (await this.intentConverged(record, foldOut, overlay, journaledTs))) {
        await this.kv.delete(`${this.intentPrefix}${record.ts}`);
        continue;
      }
      for (const key of keys) heldKeys.add(key);
    }
  }

  // ---- publication core --------------------------------------------------------

  /** Publish one action journal-first, then regenerate + verify the affected
   * derived files from the NEW fold. ONE immutable ledger record brackets the
   * step: appended BEFORE publication, it carries everything recovery needs
   * that the journal does not — the affected derived paths, and the
   * (tool\nBOOK) resolution records this action's decision files depend on
   * (derive-time state, D30). A crash anywhere after the append is classified
   * from the record + reality on the next open; the record is pruned only
   * once convergence is PROVEN. If publication fails, no derived file
   * changes. The seal is pre-validated so a seal-rejected action leaves NO
   * trace — no ledger record and no register stamp (round-5 M4). */
  private async publishAndRegenerate(
    events: JournalEvent[],
    affected: string[],
    resolutions?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    if (events.length === 0) return;
    const stamped =
      events.length > 1 ? events.map((e) => ({ ...e, batch: events[0].ts })) : events;
    await sealAction(stamped); // pre-validate: a refusable action appends nothing
    const record: IntentRecord = {
      ts: stamped[0].ts,
      kind: 'mutation',
      affectedPaths: [...new Set(affected)],
    };
    if (resolutions && Object.keys(resolutions).length) record.resolutions = resolutions;
    await this.appendIntent(record);
    await this.mustJournal().publish(stamped);
    this.events.push(...stamped.map(normalizeEvent));
    this.foldCache = null;
    // INTERIM round-5 rule 3 (REGISTER STAMPS AFTER ACCEPTANCE ONLY): the
    // in-memory resolution register moves only once the action is PUBLISHED —
    // a seal-rejected or otherwise failed publish leaves no trace in it, so a
    // later mutation or inline retry can never regenerate a sidecar under a
    // resource intent that was never accepted (round-5 M4/M5).
    if (resolutions)
      for (const [key, resource] of Object.entries(resolutions)) this.resolutions.set(key, resource);
    try {
      await this.installAndConverge(affected);
    } finally {
      // Lazy prune: only records the check PROVES converged are deleted — an
      // earlier write's still-unmaterialized intent is never erased by this
      // mutation's cleanup (review of 2026-08-20 round 3, P1).
      await this.pruneConvergedIntents();
    }
  }

  /** Regenerate this mutation's own derived paths from the current fold, then
   * retry every OTHER live intent's non-converged path inline (the retired
   * regeneration marker's self-healing, re-expressed as a ledger QUERY): a
   * mixed disk state is always explained by "the fold minus the paths of the
   * non-converged gate-satisfied records", and later mutations heal older
   * outstanding work without a reopen. This mutation fails only for ITS OWN
   * paths; a still-failing retry simply stays non-converged for the next
   * attempt (a missed retry costs a re-check, never a loss). */
  private async installAndConverge(affected: string[]): Promise<void> {
    const own = [...new Set(affected)];
    const foldOut = this.foldNow();
    for (const ipath of own) await this.installOwnProjection(foldOut, ipath);
    // INTERIM round-5 rule 4 (RETRIES READ DURABLE STATE): an inline retry
    // projects under the LEDGER overlay — never under the bare in-memory
    // register, which rule 3 keeps clean but an earlier accepted intent may
    // not have reached yet (M5).
    const intents = await this.readIntents();
    if (intents.length === 0) return;
    const journaledTs = new Set(this.events.map((e) => e.ts));
    const overlay = await this.ledgerResolutionOverlay(intents, journaledTs);
    const seen = new Set(own);
    for (const record of intents)
      await this.retryIntentPaths(record, journaledTs, seen, overlay, foldOut);
  }

  private async installOwnProjection(foldOut: FoldOutput, ipath: string): Promise<void> {
    const bytes = this.projectionBytes(foldOut, ipath);
    if (bytes !== null) {
      await this.installDerived(ipath, bytes);
      return;
    }
    if (!JournalingStore.isRemovableDerivedClass(ipath)) return;
    if ((await this.readIngredientOrNull(ipath)) === null) return;
    // The projection disappeared (structural retirement / book.remove):
    // converging means REMOVING the stale derived file (round 6 R1).
    await this.removeDerived(ipath);
  }

  private async retryIntentPaths(
    record: IntentRecord,
    journaledTs: ReadonlySet<string>,
    seen: Set<string>,
    overlay: Map<string, Record<string, unknown>>,
    foldOut: FoldOutput,
  ): Promise<void> {
    if (!this.intentGateSatisfied(record, journaledTs)) return;
    for (const ipath of record.affectedPaths) {
      if (seen.has(ipath)) continue;
      seen.add(ipath);
      let installed = false;
      try {
        installed = await this.retryProjectedPath(foldOut, overlay, ipath);
      } catch {
        continue; // a still-failing retry never fails this mutation's own work
      }
      if (installed) this.acceptRetriedResolution(ipath, overlay);
    }
  }

  private async retryProjectedPath(
    foldOut: FoldOutput,
    overlay: Map<string, Record<string, unknown>>,
    ipath: string,
  ): Promise<boolean> {
    const bytes = this.withResolutions(overlay, () => this.projectionBytes(foldOut, ipath));
    const disk = await this.readIngredientOrNull(ipath);
    if (bytes === null) {
      if (disk !== null && JournalingStore.isRemovableDerivedClass(ipath)) await this.removeDerived(ipath);
      return false;
    }
    if (disk === bytes) return false;
    if (disk === null && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes)) return false;
    await this.installDerived(ipath, bytes);
    return true;
  }

  private acceptRetriedResolution(
    ipath: string,
    overlay: Map<string, Record<string, unknown>>,
  ): void {
    const dec = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
    if (!dec) return;
    const key = `${dec[1]}\n${dec[2]}`;
    const resource = overlay.get(key);
    if (resource !== undefined) this.resolutions.set(key, resource);
  }

  /** INTERIM round-5 rule 1 (REPLAY-BEFORE-DIFF): inside the per-project
   * queue, BEFORE any mutation computes its diff, replay this actor's own
   * staged outbox intents (#61 replayStaged) and refresh the fold from the
   * union. This restores the linear-prefix invariant for the running session:
   * a mutation never diffs against a fold that lacks a durably accepted
   * action, so a failed publish can neither be silently re-lost by a later
   * whole-file write nor land mid-history at the next open (M1/M2). No paths
   * are marked here: every replayable action's ledger record was appended
   * before its publish attempt, so the replay satisfying its gate is all it
   * takes for the record to explain its paths — this mutation's
   * installAndConverge retries them inline, and a crash before that still
   * classifies as journal-ahead on the next open (rule 2, now derived). */
  private async replayOwnStagedBeforeDiff(): Promise<void> {
    const journal = this.mustJournal();
    const replayed = await journal.replayStaged();
    const stagedInvalid = replayed.filter((r) => r.outcome === 'staged-invalid');
    if (stagedInvalid.length)
      throw new Error(
        `refuse to mutate ${this.mustRepo()}: the outbox holds staged intents whose bytes are ` +
          `invalid (${stagedInvalid.map((r) => `${r.ts}: ${r.reason ?? ''}`).join('; ')}) — ` +
          `surfaced, never silently dropped (R-8.1.7/R-8.1.8)`,
      );
    const conflicts = replayed.filter((r) => r.outcome === 'conflict');
    if (conflicts.length)
      throw new Error(
        `refuse to mutate ${this.mustRepo()}: a staged intent's path is held by a DIFFERENT ` +
          `valid segment (${conflicts.map((r) => r.ts).join(', ')}) — diffing over it would ` +
          `build on a fold this actor cannot explain (R-8.1.5/R-8.1.8)`,
      );
    if (replayed.length === 0) return;
    // 'republished' AND 'already-published' both prove the journal holds an
    // accepted action the in-memory fold may lack: 'already-published' is the
    // lost-response window — publish() wrote the segment, threw before the
    // stage cleared, and this.events was never pushed (round 6 B1). Diffing
    // without the refresh re-emits the same edit on the old base.
    const union = await journal.readUnion();
    this.events = union.events;
    this.foldCache = null;
    // The replayed action's derived paths are still the FAILED attempt's disk
    // state. A retry that then diffs to nothing returns before any
    // installAndConverge, so converge the outstanding ledger paths here —
    // the retry completes the interrupted work instead of deferring it to the
    // next unrelated mutation or open (round 6 B1).
    await this.installAndConverge([]);
    await this.pruneConvergedIntents();
  }

  /** Persist and materialize a RESOLUTION-ONLY change (review of 2026-08-20
   * round 2, P2): a whole-file decision write may validly change the
   * authoritative §5.2 `resource` while leaving every decision unchanged.
   * That is derive-time state the journal does not carry (D30), so there is
   * no event to publish — the intent is ONE 'unconditional' ledger record
   * keyed by its own fresh ts (with no action to gate on, the record itself
   * is the whole intent), the sidecars regenerate under the new resolution,
   * and the record is pruned once disk has provably converged. */
  private async applyResolutionOnly(
    entries: Record<string, Record<string, unknown>>,
    affected: string[],
  ): Promise<void> {
    await this.appendIntent({
      ts: this.mustJournal().issueTs(),
      kind: 'unconditional',
      affectedPaths: [...new Set(affected)],
      resolutions: entries,
    });
    // Rule 3 (round 5): the durable unconditional record IS this intent's
    // acceptance (there is no action to publish) — the register moves only now.
    for (const [key, resource] of Object.entries(entries)) this.resolutions.set(key, resource);
    try {
      await this.installAndConverge(affected);
    } finally {
      await this.pruneConvergedIntents();
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

  /** The four-way recovery classifier (issue #62): replay the outbox, read
   * the union, FOLD THE INTENT LEDGER AGAINST REALITY, then classify derived
   * state as seeded / converged / journal-ahead (regenerate forward) /
   * out-of-band (reconcile via §8.8) — anything else is a visible,
   * diagnosable stop. */
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
    const unionTs = new Set(union.events.map((e) => e.ts));

    // 3. The intent ledger, classified against reality. A 'mutation' record
    // whose ts is in neither the union nor the still-staged outbox is
    // provably DEAD: the replay above already republished every surviving
    // staged intent, and events are never regenerated (D50 v2 §3), so that
    // action can never enter the journal — the record is stale and pruned.
    // Dropping it is the provably-safe half of the asymmetric rule (the same
    // never-published proof the round-1 review established), and it also
    // closes the re-mint hazard: a gate that can never be satisfied must not
    // linger where a future clock could accidentally re-issue its ts. A
    // 'seed' record is never dropped here — it routes this open into the seed.
    let intents = await this.readIntents();
    const stillStaged = new Set(replayed.filter((r) => r.outcome === 'conflict').map((r) => r.ts));
    const dead = intents.filter(
      (r) => r.kind === 'mutation' && !unionTs.has(r.ts) && !stillStaged.has(r.ts),
    );
    for (const record of dead) await this.kv.delete(`${this.intentPrefix}${record.ts}`);
    if (dead.length) intents = intents.filter((r) => !dead.includes(r));

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

    // 4. Journal-less project → universal seeding (§8.8, all-or-nothing). A
    // live 'seed' ledger record routes an INTERRUPTED seed back here too
    // (review of 2026-08-20, P1): its replayed segments make the union
    // non-empty, but the ordinary classifier cannot finish a seed's sidecar
    // canonicalization. "Seed incomplete" is DERIVED like any other intent:
    // the record exists exactly until its convergence is proven and pruned.
    const seedRecord = intents.find((r) => r.kind === 'seed');
    if (union.events.length === 0 || seedRecord !== undefined) {
      await this.seedProject(options, report, union.events, seedRecord);
    } else {
      this.events = union.events;
      this.foldCache = null;
      await this.harvestResolutions();
      const harvested = new Map(this.resolutions);
      // The register regenerates under the LEDGER OVERLAY: per (tool, BOOK)
      // key, the resolution of the LATEST record whose gate holds (ts in the
      // union, or unconditional) — the round-5 durable-overlay rule, now
      // reading the ledger. A record whose gate is not satisfied never
      // applies (a still-staged 'conflict' record waits for a later replay).
      const overlay = await this.ledgerResolutionOverlay(intents, unionTs);
      for (const [key, resource] of overlay) this.resolutions.set(key, resource);
      await this.classifyAndRecover(union.actions, report, intents, harvested);
      // A successful classification leaves every derived path converged (any
      // install failure throws) — the lazy prune now PROVES it per record.
      await this.pruneConvergedIntents();
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
  private async inventoryDisk(): Promise<DiskInventory> {
    const repo = this.mustRepo();
    // SORTED: a resumed seed recomputes its events from this inventory, and the
    // recomputation must be deterministic — event order (and so each event's
    // ts) must not depend on the platform's directory-walk order.
    const paths = (await this.api.listPaths(repo))
      .filter((p) => !p.startsWith('checking/journal/') && !isUnjournaledIngredient(p))
      .sort();
    const inventory: DiskInventory = {
      books: {},
      decisionFiles: {},
      decisionFilesByBook: {},
      alignmentFiles: {},
      resources: null,
      settings: null,
      vrsBytes: null,
      diskBytes: {},
      unknown: [],
    };

    // A metadata-read FAILURE aborts (official review round 6, R4): scope is
    // journaled forever in book.add, and defaulting a failed read to {} gives
    // every book `[]` — whole-book scope — silently admitting out-of-scope
    // work. An ABSENT currentScope key on a readable document stays {}: that
    // is a real (legacy) state, not a transient failure.
    let scope: Record<string, string[]>;
    try {
      const meta = await this.api.getMetadataRaw(repo);
      scope = (meta?.type?.flavorType?.currentScope ?? {}) as Record<string, string[]>;
    } catch (error) {
      throw new Error(
        `refuse to inventory ${repo}: the project scope could not be read ` +
          `(${String((error as Error).message ?? error)}) — seeding or recovery with a ` +
          `defaulted scope would journal a widened scope permanently`,
      );
    }

    for (const ipath of paths) {
      const text = await this.readIngredientOrNull(ipath);
      if (text === null) continue; // listed, then gone — treated as absent
      this.inventoryPath(inventory, scope, ipath, text);
    }
    return inventory;
  }

  private inventoryPath(
    inventory: DiskInventory,
    scope: Record<string, string[]>,
    ipath: string,
    text: string,
  ): void {
    inventory.diskBytes[ipath] = text;
    const book = /^([A-Z0-9]{3})\.usfm$/.exec(ipath)?.[1];
    if (book) return void (inventory.books[book] = { usfm: text, scope: scope[book] ?? [] });
    const align = /^checking\/alignments\/([A-Z0-9]{3})\.json$/.exec(ipath)?.[1];
    if (align) {
      const file = this.parseInventoryJson<AlignmentFile>(inventory, ipath, text);
      if (file) inventory.alignmentFiles[align] = file;
      return;
    }
    const dec = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
    if (dec) return void this.inventoryDecisionFile(inventory, dec[1], dec[2], ipath, text);
    if (ipath === RESOURCES_IPATH)
      return void (inventory.resources = this.parseInventoryJson<ResourcesFile>(inventory, ipath, text) ?? null);
    if (ipath === SETTINGS_IPATH)
      return void (inventory.settings = this.parseInventoryJson<SettingsFile>(inventory, ipath, text) ?? null);
    if (ipath === VRS_IPATH) return void (inventory.vrsBytes = text);
    inventory.unknown.push(ipath);
  }

  private parseInventoryJson<T>(inventory: DiskInventory, ipath: string, text: string): T | undefined {
    try {
      return JSON.parse(text) as T;
    } catch {
      inventory.unknown.push(ipath);
      return undefined;
    }
  }

  private inventoryDecisionFile(
    inventory: DiskInventory,
    tool: string,
    book: string,
    ipath: string,
    text: string,
  ): void {
    const file = this.parseInventoryJson<DecisionFile>(inventory, ipath, text);
    if (!file) return;
    (inventory.decisionFilesByBook[tool] ??= {})[book] = file;
    const merged = inventory.decisionFiles[tool] ?? { ...file, decisions: [] };
    merged.decisions = [...merged.decisions, ...(file.decisions ?? [])];
    inventory.decisionFiles[tool] = merged;
  }

  /** §8.8 universal seeding: one all-or-nothing seed covering every existing
   * journal-derived surface. Verified to reproduce the pre-seed state BEFORE
   * anything is published; staged completely before the first publish; ONE
   * 'seed' ledger record - appended before staging, carrying the deterministic
   * resume parameters - makes an INTERRUPTED seed resume here on the next open
   * (review of 2026-08-20, P1): finishing the sidecar canonicalization when
   * the published union already covers the disk, or re-staging the
   * DETERMINISTIC seed idempotently when it does not. */
  private async seedProject(
    options: OpenOptions,
    report: OpenReport,
    unionEvents: JournalEvent[],
    seedRecord?: IntentRecord,
  ): Promise<void> {
    const journal = this.mustJournal();
    const disk = await this.inventoryDisk();
    this.assertSeedInventory(disk);
    if (await this.resumeSeedIfComplete(unionEvents, disk, report)) return;

    const { seedSource, seedVrsName, seedEvents } = this.seedCandidate(
      journal,
      options,
      seedRecord,
      disk,
    );
    if (seedEvents.length === 0) {
      // An empty repo has nothing to seed - and nothing to converge, so a
      // leftover record from an interrupted seed of since-removed content is
      // provably safe to prune.
      if (seedRecord) await this.kv.delete(`${this.intentPrefix}${seedRecord.ts}`);
      return;
    }
    const normalizedSeed = seedEvents.map(normalizeEvent);
    this.assertSeedCandidate(normalizedSeed, unionEvents, disk);
    await this.publishSeedCandidate(journal, seedEvents, normalizedSeed, seedSource, seedVrsName);
    this.events = normalizedSeed;
    this.foldCache = null;
    await this.finishSeedConvergence(disk, report);
  }

  private assertSeedInventory(disk: DiskInventory): void {
    if (disk.unknown.length)
      throw new UnexplainedDivergenceError(
        this.mustRepo(),
        disk.unknown.map((ipath) => ({
          ipath,
          diskMd5: md5Hex(disk.diskBytes[ipath] ?? ''),
          projectedMd5: null,
        })),
      );
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
  }

  private async resumeSeedIfComplete(
    unionEvents: JournalEvent[],
    disk: DiskInventory,
    report: OpenReport,
  ): Promise<boolean> {
    if (unionEvents.length === 0) return false;
    this.events = unionEvents;
    this.foldCache = null;
    if (this.seedStateProblems(this.foldNow(), disk).length !== 0) return false;
    await this.finishSeedConvergence(disk, report);
    return true;
  }

  private seedCandidate(
    journal: JournalStore,
    options: OpenOptions,
    seedRecord: IntentRecord | undefined,
    disk: DiskInventory,
  ): {
    seedSource: 'creation' | 'sidecar-migration';
    seedVrsName: string | undefined;
    seedEvents: JournalEvent[];
  } {
    const seedSource = seedRecord?.seed?.source ?? options.seedSource ?? 'sidecar-migration';
    const seedVrsName = seedRecord?.seed?.vrsName ?? options.vrsName;
    return {
      seedSource,
      seedVrsName,
      seedEvents: seedFromSidecars({
        actor: journal.actorId,
        books: disk.books,
        decisionFiles: disk.decisionFiles as never,
        alignmentFiles: disk.alignmentFiles as never,
        resources: disk.resources,
        settings: disk.settings,
        meta: null,
        vrs: disk.vrsBytes === null ? null : { name: seedVrsName ?? 'unrecorded', bytes: disk.vrsBytes },
        source: seedSource,
      }),
    };
  }

  private assertSeedCandidate(
    normalizedSeed: JournalEvent[],
    unionEvents: JournalEvent[],
    disk: DiskInventory,
  ): void {
    const mismatches = this.seedStateProblems(fold(normalizedSeed), disk);
    if (mismatches.length) throw new SeedMismatchError(this.mustRepo(), mismatches);
    if (unionEvents.length === 0) return;
    const candidate = new Map(normalizedSeed.map((e) => [e.ts, canonical(e)]));
    const torn = unionEvents.filter((e) => candidate.get(e.ts) !== canonical(e)).map((e) => e.ts);
    if (torn.length)
      throw new Error(
        `refuse to resume the interrupted seed of ${this.mustRepo()}: published seed events at ` +
          `${torn.join(', ')} are not reproduced by the recomputed deterministic seed - ` +
          `resolve by hand; nothing was overwritten (R-8.8.2/R-8.8.3)`,
      );
  }

  private async publishSeedCandidate(
    journal: JournalStore,
    seedEvents: JournalEvent[],
    normalizedSeed: JournalEvent[],
    seedSource: 'creation' | 'sidecar-migration',
    seedVrsName: string | undefined,
  ): Promise<void> {
    const seedMeta: IntentRecord['seed'] = { source: seedSource };
    if (seedVrsName !== undefined) seedMeta.vrsName = seedVrsName;
    await this.appendIntent({
      ts: normalizedSeed[0].ts,
      kind: 'seed',
      affectedPaths: this.derivedPathsOf(fold(normalizedSeed)),
      seed: seedMeta,
    });
    for (const chunk of await this.chunkForSealing(seedEvents)) await journal.stage(chunk);
    const failed = (await journal.replayStaged()).filter(
      (o) => o.outcome !== 'republished' && o.outcome !== 'already-published',
    );
    if (failed.length)
      throw new Error(
        `universal seed publication incomplete: ${failed
          .map((f) => `${f.ts}: ${f.outcome}${f.reason ? ` (${f.reason})` : ''}`)
          .join('; ')}`,
      );
  }

  /** The seed's tail: converge legacy sidecar bytes to the canonical projection
   * form (content proven identical by seedStateProblems; only the byte form
   * changes), then prune the ledger - the 'seed' record deletes only once its
   * convergence is PROVEN, like every other intent. */
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
      // checkpointed" - seeding must not materialize it (a fresh creation's
      // first writeResources still expects absence).
      if (disk.diskBytes[ipath] === undefined && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes)) continue;
      toConverge.push(ipath);
    }
    await this.installAndConverge(toConverge);
    await this.pruneConvergedIntents();

    report.seeded = true;
    report.classification = 'seeded';
    report.regeneratedPaths = toConverge;
  }

  /** Does `folded` reproduce the pre-seed disk state (R-8.8.2)? USFM and vrs
   * bytes must match EXACTLY; sidecars canonically (their byte form converges
   * to the projection right after). Shared by the pre-publish verification and
   * by the resumed-seed coverage check, so the two can never disagree. The pin
   * and settings round-trips are included, and every sidecar compares as its
   * WHOLE document: content the checkpoint projection cannot represent — an
   * unknown top-level field on ANY sidecar (decisions and alignments too,
   * round 6 B4), or a co-present §5.2 record — REFUSES here instead of being
   * silently dropped by convergence (R-8.8.2). */
  private seedStateProblems(
    folded: FoldOutput,
    disk: DiskInventory,
  ): string[] {
    return [
      ...this.seedBookAndVrsProblems(folded, disk),
      ...this.seedDecisionProblems(folded, disk),
      ...this.seedAlignmentProblems(folded, disk),
      ...this.seedResourceProblems(folded, disk),
      ...this.seedSettingsProblems(folded, disk),
    ];
  }

  private seedBookAndVrsProblems(folded: FoldOutput, disk: DiskInventory): string[] {
    const problems: string[] = [];
    for (const [book, entry] of Object.entries(disk.books)) {
      if (folded.books[book]?.usfm !== entry.usfm)
        problems.push(`${bookIpath(book)}: fold-of-seed differs from disk bytes (is the file NFC?)`);
    }
    if (disk.vrsBytes !== null && folded.vrs?.bytes !== disk.vrsBytes)
      problems.push('vrs.json: fold-of-seed differs from disk bytes');
    if (disk.vrsBytes === null && folded.vrs !== null)
      problems.push('vrs.json: the fold carries a versification frame the disk lacks');
    return problems;
  }

  private seedDecisionProblems(folded: FoldOutput, disk: DiskInventory): string[] {
    const problems: string[] = [];
    const inFoldOrder = <T extends { contextId: unknown }>(list: T[]): T[] =>
      [...list].sort((a, b) => (canonical(a.contextId) < canonical(b.contextId) ? -1 : 1));
    for (const [tool, byBook] of Object.entries(disk.decisionFilesByBook)) {
      for (const [book, file] of Object.entries(byBook)) {
        const projected = (folded.decisions[tool] ?? []).filter(
          (d) => d.contextId.reference.bookId.toUpperCase() === book,
        );
        const expectedDoc = {
          schemaVersion: 1,
          tool,
          book,
          // §5.2 resolution records are derive-time state (D30) the seed
          // carries through verbatim — the file's own record is the expected
          // record; its integrity is judged by the resolution machinery.
          resource: file.resource,
          decisions: inFoldOrder(projected),
        };
        // §5.2's OPTIONAL `summary` is a derived cache the spec marks
        // "regenerable ... MUST be treated as disposable" — convergence
        // dropping it is the specified behavior, never content loss, so it is
        // excluded from the round-trip (the sample burrito carries one).
        const fileSansSummary: Record<string, unknown> = {
          ...(file as unknown as Record<string, unknown>),
        };
        delete fileSansSummary.summary;
        const actualDoc = { ...fileSansSummary, decisions: inFoldOrder(file.decisions ?? []) };
        if (canonical(expectedDoc) !== canonical(actualDoc))
          problems.push(
            `${decisionsIpath(tool, book)}: fold-of-seed does not reproduce the stored document ` +
              `(an unknown top-level field, or co-present records on one §5.2 identity key, ` +
              `cannot round-trip — resolve by hand)`,
          );
      }
    }
    return problems;
  }

  private seedAlignmentProblems(folded: FoldOutput, disk: DiskInventory): string[] {
    const problems: string[] = [];
    for (const [book, file] of Object.entries(disk.alignmentFiles)) {
      // Same whole-document rule: the projection emits exactly
      // {schemaVersion, book, chapters} — an extra top-level field refuses.
      const chapters: Record<string, Record<string, unknown>> = {};
      for (const [key, record] of Object.entries(folded.alignments[book] ?? {})) {
        const colon = key.indexOf(':');
        const [chapter, verse] = [key.slice(0, colon), key.slice(colon + 1)];
        (chapters[chapter] ??= {})[verse] = record;
      }
      const expectedDoc = { schemaVersion: 1, book, chapters };
      if (canonical(expectedDoc) !== canonical({ ...file, chapters: file.chapters ?? {} }))
        problems.push(
          `${alignmentsIpath(book)}: fold-of-seed does not reproduce the stored document ` +
            `(records differ, or a top-level field the projection cannot represent)`,
        );
    }
    return problems;
  }

  private seedResourceProblems(folded: FoldOutput, disk: DiskInventory): string[] {
    const problems: string[] = [];
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
    return problems;
  }

  private seedSettingsProblems(folded: FoldOutput, disk: DiskInventory): string[] {
    const problems: string[] = [];
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

  private compareDisk(foldOut: FoldOutput, disk: DiskInventory): DivergedPath[] {
    const diverged: DivergedPath[] = [];
    const expected = new Set(this.derivedPathsOf(foldOut));
    for (const ipath of expected) {
      let projected: string | null;
      try {
        projected = this.projectionBytes(foldOut, ipath);
      } catch {
        projected = null;
      }
      const onDisk = disk.diskBytes[ipath];
      if (onDisk === undefined && projected !== null && EMPTY_CHECKPOINT_DOCUMENTS.has(projected)) continue;
      if (projected !== (onDisk ?? null))
        diverged.push({
          ipath,
          diskMd5: onDisk === undefined ? null : md5Hex(onDisk),
          projectedMd5: projected === null ? null : md5Hex(projected),
        });
    }
    for (const ipath of Object.keys(disk.diskBytes))
      if (!expected.has(ipath))
        diverged.push({ ipath, diskMd5: md5Hex(disk.diskBytes[ipath]), projectedMd5: null });
    for (const ipath of disk.unknown)
      if (!diverged.some((d) => d.ipath === ipath))
        diverged.push({ ipath, diskMd5: md5Hex(disk.diskBytes[ipath] ?? ''), projectedMd5: null });
    return diverged;
  }

  private explainedPaths(intents: IntentRecord[], journaledTs: ReadonlySet<string>): Set<string> {
    const explained = new Set<string>();
    for (const record of intents)
      if (this.intentGateSatisfied(record, journaledTs))
        for (const ipath of record.affectedPaths) explained.add(ipath);
    return explained;
  }

  private isAheadExplained(ipath: string, explained: ReadonlySet<string>, foldOut: FoldOutput): boolean {
    if (!explained.has(ipath)) return false;
    try {
      return (
        this.projectionBytes(foldOut, ipath) !== null ||
        JournalingStore.isRemovableDerivedClass(ipath)
      );
    } catch {
      return false;
    }
  }

  private liveResolutionRecords(
    intents: IntentRecord[],
    journaledTs: ReadonlySet<string>,
  ): IntentRecord[] {
    return intents.filter(
      (record) =>
        record.resolutions !== undefined &&
        Object.keys(record.resolutions).length > 0 &&
        this.intentGateSatisfied(record, journaledTs),
    );
  }

  private prefixMatchesDisk(
    actions: Array<{ actor: string; ts: string; events: JournalEvent[] }>,
    resolutionRecords: IntentRecord[],
    harvested: Map<string, Record<string, unknown>>,
    disk: DiskInventory,
  ): boolean {
    const maxPrefix = 8;
    for (let drop = 1; drop <= Math.min(maxPrefix, actions.length); drop += 1) {
      const prefixEvents = actions.slice(0, actions.length - drop).flatMap((action) => action.events);
      let prefixFold: FoldOutput;
      try {
        prefixFold = fold(prefixEvents);
      } catch {
        break;
      }
      if (resolutionRecords.length === 0 && this.compareDisk(prefixFold, disk).length === 0) return true;
      if (resolutionRecords.length === 0) continue;
      const prefixTs = new Set(prefixEvents.map((event) => event.ts));
      const prefixResolutions = new Map(harvested);
      for (const record of resolutionRecords)
        if (record.kind !== 'unconditional' && prefixTs.has(record.ts))
          for (const [key, resource] of Object.entries(record.resolutions!))
            prefixResolutions.set(key, resource);
      if (this.withResolutions(prefixResolutions, () => this.compareDisk(prefixFold, disk).length === 0))
        return true;
    }
    return false;
  }

  private reconciliationPaths(after: FoldOutput, disk: DiskInventory): string[] {
    const sweep = new Set([
      ...this.derivedPathsOf(after),
      ...Object.keys(disk.diskBytes).filter((path) => JournalingStore.isRemovableDerivedClass(path)),
    ]);
    const paths: string[] = [];
    for (const ipath of sweep) {
      let bytes: string | null;
      try {
        bytes = this.projectionBytes(after, ipath);
      } catch {
        continue;
      }
      const onDisk = disk.diskBytes[ipath];
      if (bytes === null) {
        if (onDisk !== undefined) paths.push(ipath);
        continue;
      }
      if (bytes === onDisk) continue;
      if (onDisk === undefined && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes)) continue;
      paths.push(ipath);
    }
    return paths;
  }

  private async reconcileDivergence(
    remainder: DivergedPath[],
    disk: DiskInventory,
    report: OpenReport,
  ): Promise<void> {
    const journal = this.mustJournal();
    const clock = { issue: (): string => journal.issueTs() };
    let lastReconcileTs: string | null = null;
    for (const entry of remainder) {
      const book = entry.ipath.slice(0, 3);
      const committed = disk.diskBytes[entry.ipath];
      if (committed === undefined) throw new UnexplainedDivergenceError(this.mustRepo(), [entry]);
      const events = reconcileUsfm(book, committed, this.foldNow(), clock, journal.actorId);
      if (events.length === 0) continue;
      await journal.publish(events);
      this.events.push(...events.map(normalizeEvent));
      this.foldCache = null;
      lastReconcileTs = events[events.length - 1].ts;
      report.reconciledBooks.push(book);
    }
    const paths = this.reconciliationPaths(this.foldNow(), disk);
    if (paths.length)
      await this.appendIntent(
        lastReconcileTs !== null
          ? { ts: lastReconcileTs, kind: 'mutation', affectedPaths: paths }
          : { ts: journal.issueTs(), kind: 'unconditional', affectedPaths: paths },
      );
    await this.installAndConverge(paths);
    await this.api.remakeIngredients(this.mustRepo());
    report.classification = 'reconciled';
    report.regeneratedPaths = paths;
  }

  /** Classify derived disk state against the journal projection and recover. */
  private async classifyAndRecover(
    actions: Array<{ actor: string; ts: string; events: JournalEvent[] }>,
    report: OpenReport,
    /** The live intent ledger (stale records already pruned), ts-sorted. */
    intents: IntentRecord[],
    /** The (tool, BOOK) resolutions the DISK reflects - prefix-comparison
     * state, before any ledger overlay was applied to the register. */
    harvested: Map<string, Record<string, unknown>>,
  ): Promise<void> {
    const foldOut = this.foldNow();
    const disk = await this.inventoryDisk();
    const journaledTs = new Set(this.events.map((e) => e.ts));

    const compare = (candidate: FoldOutput): DivergedPath[] => this.compareDisk(candidate, disk);

    const diverged = compare(foldOut);
    if (diverged.length === 0) {
      report.classification = 'converged'; // leftover converged records prune at the caller
      return;
    }

    const regenerateForward = async (): Promise<void> => {
      // A diverged path the fold does not derive would have been refused below
      // as unexplained before any branch chose this recovery.
      const paths = diverged.map((d) => d.ipath);
      await this.installAndConverge(paths);
      report.classification = 'regenerated-forward';
      report.regeneratedPaths = paths;
    };

    // (a) Journal-ahead paths the LEDGER itself explains: a gate-satisfied
    // record's affected paths are journal-ahead by construction - the action
    // is in the journal (or the record is its own unconditional intent) while
    // the disk still lags. This composes over a just-republished staged
    // intent automatically (round-5 rule 2): its record was appended before
    // its publish attempt, so the replay satisfying its gate is all it takes.
    // Each explained path must be one the fold actually derives forward.
    const explained = this.explainedPaths(intents, journaledTs);
    const aheadExplained = (ipath: string): boolean => this.isAheadExplained(ipath, explained, foldOut);
    if (diverged.every((d) => aheadExplained(d.ipath))) {
      await regenerateForward();
      return;
    }

    // (0) The ONLY divergence is a pending resolution overlay (review of
    // 2026-08-20 round 2, P2): disk matches the fold exactly under the
    // DISK-HARVESTED resolutions, so what remains is materializing the
    // ledger's resolution intent - recovered forward like a journal-ahead
    // state.
    const resolutionRecords = this.liveResolutionRecords(intents, journaledTs);
    if (
      resolutionRecords.length > 0 &&
      this.withResolutions(harvested, () => compare(foldOut).length === 0)
    ) {
      await regenerateForward();
      return;
    }

    // (b) Disk equals the projection of a journal PREFIX (the journal is ahead
    // by the trailing action(s)) -> regenerate forward. Bounded walk. This
    // branch survives even a lost ledger record: the journal itself still
    // explains the lag.
    if (this.prefixMatchesDisk(actions, resolutionRecords, harvested, disk)) {
      await regenerateForward();
      return;
    }

    // (c) Every UNEXPLAINED diverged path is a book USFM (edited or created
    // out-of-band) -> §8.8 reconcile those - and ONLY those (round-5 rule 2,
    // M3): a path a gate-satisfied ledger record already explains as
    // journal-ahead is NEVER re-journaled from its (stale) disk bytes; those
    // paths regenerate forward in the same recovery's convergence below.
    const remainder = diverged.filter((d) => !aheadExplained(d.ipath));
    const usfmOnly = remainder.every((d) => /^[A-Z0-9]{3}\.usfm$/.test(d.ipath));
    if (usfmOnly) {
      await this.reconcileDivergence(remainder, disk, report);
      return;
    }

    // (d) Unexplained - a visible, diagnosable stop. Nothing is overwritten.
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
    return this.queue(() => this.writeAlignmentsQueued(book, data, expectMd5));
  }

  private async writeAlignmentsQueued(
    book: string,
    data: AlignmentFile,
    expectMd5?: string | null,
  ): Promise<void> {
    await this.replayOwnStagedBeforeDiff();
    const journal = this.mustJournal();
    const code = book.toUpperCase();
    await this.checkExpectMd5(alignmentsIpath(code), expectMd5);
    const foldOut = this.foldNow();
    const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
    if (generation === undefined)
      throw new Error(`writeAlignments(${code}): the journal projects no such book`);
    const events = this.alignmentEvents(data, foldOut, journal, code, generation);
    await this.publishAndRegenerate(events, [alignmentsIpath(code)]);
  }

  private alignmentEvents(
    data: AlignmentFile,
    foldOut: FoldOutput,
    journal: JournalStore,
    code: string,
    generation: string,
  ): JournalEvent[] {
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
        base: foldOut.headsTs[`align|${code}|${vkey}`] ?? null,
        generation,
        book: code,
        chapter: vkey.slice(0, sep),
        verse: vkey.slice(sep + 1),
        ...record,
      });
    };
    for (const [vkey, record] of Object.entries(incoming)) {
      const current = projected[vkey];
      if (current !== undefined && canonical(current) === canonical(record)) continue;
      pushRecord(vkey, record as unknown as Record<string, unknown>);
    }
    for (const [vkey, record] of Object.entries(projected)) {
      if (incoming[vkey] !== undefined || isEmptyAlignmentRecord(record)) continue;
      const verseContent = foldOut.books[code]?.verses?.[vkey];
      pushRecord(vkey, {
        alignments: [],
        wordBank: [],
        targetVerseMd5:
          verseContent !== undefined ? verseTextMd5(verseContent) : (record.targetVerseMd5 as string),
      });
    }
    return events;
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
    resource?: { repoPath: string; version?: string; sha: string; languageSet?: string },
  ): Promise<void> {
    return this.queue(() => this.upsertDecisionQueued(tool, book, decision, resource));
  }

  private async upsertDecisionQueued(
    tool: string,
    book: string,
    decision: Decision,
    resource?: { repoPath: string; version?: string; sha: string; languageSet?: string },
  ): Promise<void> {
    await this.replayOwnStagedBeforeDiff();
    const journal = this.mustJournal();
    const code = book.toUpperCase();
    const foldOut = this.foldNow();
    const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
    if (generation === undefined)
      throw new Error(`upsertDecision(${tool}, ${code}): the journal projects no such book`);
    const resolutionKey = `${tool}\n${code}`;
    const effective = await this.effectiveDecisionResolution(tool, code, resolutionKey, resource);
    const event = this.decisionEvent(tool, code, decision, foldOut, journal, generation);
    if (!event) return;
    await this.publishAndRegenerate([event], [decisionsIpath(tool, code)], {
      [resolutionKey]: effective,
    });
  }

  private async effectiveDecisionResolution(
    tool: string,
    code: string,
    resolutionKey: string,
    resource?: { repoPath: string; version?: string; sha: string; languageSet?: string },
  ): Promise<Record<string, unknown>> {
    const stored = (await this.ledgerResolutionOverlay()).get(resolutionKey) as
      | { repoPath: string; version?: string; sha?: string }
      | undefined;
    if (!resource && stored) return stored as unknown as Record<string, unknown>;
    if (!resource)
      throw new Error(
        `upsertDecision(${tool}, ${code}): no (tool, book) resolution record — §5.2 requires ` +
          `\`resource\` (D30); pass the session's resolution`,
      );
    if (!resource.sha)
      throw new Error(
        `upsertDecision(${tool}, ${code}): the session resolution carries no sha — ` +
          `identity is (repoPath + sha) (D58/D59)`,
      );
    const agrees = !stored || (samePath(stored.repoPath, resource.repoPath) && stored.sha === resource.sha);
    if (!agrees)
      throw new Error(
        `upsertDecision(${tool}, ${code}): the stored §5.2 record ` +
          `(${stored?.repoPath} @ ${stored?.sha ?? 'no sha'}) does not match the session's ` +
          `resolution (${resource.repoPath} @ ${resource.sha}) — a decision write never ` +
          `relabels the file; resolve through the gateway-change flow (D36/D59)`,
      );
    return resource as unknown as Record<string, unknown>;
  }

  private decisionEvent(
    tool: string,
    code: string,
    decision: Decision,
    foldOut: FoldOutput,
    journal: JournalStore,
    generation: string,
  ): JournalEvent | null {
    const incoming = normalizeDecision(decision);
    const key = decisionRegisterKey(tool, incoming);
    const projected = (foldOut.decisions[tool] ?? []).find(
      (candidate) => decisionRegisterKey(tool, candidate as unknown as Decision) === key,
    );
    const quoteChanged =
      projected &&
      (projected as { contextId: { quoteString?: unknown } }).contextId.quoteString !==
        incoming.contextId.quoteString;
    if (quoteChanged)
      throw new Error(
        `upsertDecision(${tool}, ${code}): the stored decision at this §5.2 identity key carries ` +
          `a different quoteString — the resource behind this check changed; re-derive and carry ` +
          `over (a warned update) instead of overwriting (§5.2, issue #62)`,
      );
    if (projected && canonical(projected) === canonical(incoming)) return null;
    return {
      v: 1,
      op: 'check.decision.set',
      actor: journal.actorId,
      ts: journal.issueTs(),
      base: foldOut.headsTs[key] ?? null,
      generation,
      toolId: tool,
      decision: incoming as unknown as Record<string, unknown>,
    };
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
    // Rule 3 (round 5): NO register stamp here — the diff only OBSERVES the
    // register; the file's resource enters it after acceptance (the caller
    // passes it to publishAndRegenerate / applyResolutionOnly), so a
    // seal-rejected whole-file write leaves the register untouched (M4).
    const resolutionChanged =
      canonical(this.resolutions.get(`${tool}\n${code}`) ?? null) !== canonical(file.resource);

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
        decision: decision as unknown as Record<string, unknown>,
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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

  /** §8.5 `note.add`, verse-targeted — the Understand screen's comprehension
   * notes (D63, #106). Grow-only by design (v1: no edit/delete op): each save
   * appends, and readers show the LATEST note per target. Notes project into
   * the fold only (no checkpoint file), so `affected` is empty. */
  async addNote(book: string, chapter: number | string, verse: number | string, text: string): Promise<void> {
    return this.queue(async () => {
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
      const journal = this.mustJournal();
      const foldOut = this.foldNow();
      const code = book.toUpperCase();
      // Round 26: a retry must be IDEMPOTENT across the lost-response window
      // (round 6 B1: publish() wrote the segment, threw before the stage
      // cleared, the caller saw a failure). The replay above has already
      // recovered any such accepted note into the fold — so the same
      // diff-to-nothing rule every state-setting op enjoys applies here as
      // content equality: when the target's LATEST note already carries this
      // exact text, there is nothing to add, and appending would multiply
      // permanent grow-only events the reader hides.
      const targetChapter = String(chapter);
      const targetVerse = String(verse);
      const notes = (foldOut as unknown as { notes?: Array<Record<string, unknown>> }).notes ?? [];
      const latest = notes
        .filter((n) => {
          const tg = n.target as Record<string, unknown> | undefined;
          return (
            tg &&
            typeof tg.book === 'string' &&
            tg.book.toUpperCase() === code &&
            tg.decisionKey === undefined &&
            String(tg.chapter) === targetChapter &&
            String(tg.verse) === targetVerse
          );
        })
        .pop();
      if (latest && String(latest.text ?? '') === (toNfc(text) as string)) return;
      const generation = foldOut.books[code] ? foldOut.headsTs[`book|${code}`] : undefined;
      if (generation === undefined) {
        throw new Error(`addNote(${code}): the journal projects no such book — a note needs its §8.5 generation root`);
      }
      const event: JournalEvent = {
        v: 1,
        op: 'note.add',
        actor: journal.actorId,
        ts: journal.issueTs(),
        target: { book: code, chapter: String(chapter), verse: String(verse) },
        text: toNfc(text) as string,
        generation,
      };
      await this.publishAndRegenerate([event], []);
    });
  }

  /** Verse-targeted notes of one book from the fold, in journal order (so the
   * last entry per target is the latest — the one the Understand screen shows). */
  readNotes(book: string): Array<{ ts: string; chapter: string; verse: string; text: string }> {
    const code = book.toUpperCase();
    const notes = (this.foldNow() as unknown as { notes?: Array<Record<string, unknown>> }).notes ?? [];
    return notes
      .filter((n) => {
        const tg = n.target as Record<string, unknown> | undefined;
        return tg && typeof tg.book === 'string' && tg.book.toUpperCase() === code && tg.decisionKey === undefined;
      })
      .map((n) => {
        const tg = n.target as { chapter: string; verse: string };
        return { ts: String(n.ts), chapter: String(tg.chapter), verse: String(tg.verse), text: String(n.text ?? '') };
      });
  }

  /** §8.5 project.meta.set: diff per dotted path against the folded overlay.
   * The platform exposes NO HTTP metadata write route (D28), so the event is
   * journaled and commit() verifies materialization — refusing loudly when the
   * overlay cannot be applied, never emitting a silently incomplete checkpoint. */
  async writeProjectMeta(meta: Record<string, unknown>): Promise<void> {
    return this.queue(async () => {
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
      await this.replayOwnStagedBeforeDiff(); // round-5 rule 1: REPLAY-BEFORE-DIFF
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
    return this.queue(() => this.commitQueued(message));
  }

  private async commitQueued(message: string): Promise<void> {
    const repo = this.mustRepo();
    const foldOut = this.foldNow();
    this.assertCheckpointMetadataWritable(foldOut);
    const projections = await this.checkpointProjections(repo, foldOut);
    const ledgerPaths = await this.checkpointLedgerPaths();
    const toWrite = await this.checkpointWrites(repo, projections, ledgerPaths);
    try {
      await this.installAndConverge(toWrite.map((entry) => entry.ipath));
    } finally {
      await this.pruneConvergedIntents();
    }
    await this.api.remakeIngredients(repo);
    await this.verifyCheckpointScope(repo, foldOut);
    await this.api.addAndCommit(repo, message);
  }

  private assertCheckpointMetadataWritable(foldOut: FoldOutput): void {
    if (!Object.keys(foldOut.projectMeta).length && !foldOut.projectMetaRemoved.length) return;
    throw new Error(
      `checkpoint refused: the journal carries a project.meta.set overlay ` +
        `(${[...Object.keys(foldOut.projectMeta), ...foldOut.projectMetaRemoved].join(', ')}) ` +
        `and the platform exposes no HTTP metadata write route (D28) — the derived ` +
        `metadata.json cannot be regenerated to match the fold (§8.7)`,
    );
  }

  private async checkpointProjections(
    repo: string,
    foldOut: FoldOutput,
  ): Promise<Record<string, string>> {
    const baseMetadata = await this.api.getMetadataRaw(repo);
    const resolutions: Record<string, Record<string, unknown>> = {};
    for (const [key, resource] of this.resolutions) {
      const [tool, book] = key.split('\n');
      (resolutions[tool] ??= {})[book] = resource;
    }
    const projections = derivedProjections(foldOut, { baseMetadata, resolutions });
    delete projections['metadata.json'];
    return projections;
  }

  private async checkpointLedgerPaths(): Promise<Set<string>> {
    const intents = await this.readIntents();
    const journaledTs = new Set(this.events.map((event) => event.ts));
    const ledgerPaths = new Set<string>();
    for (const record of intents)
      if (this.intentGateSatisfied(record, journaledTs))
        for (const ipath of record.affectedPaths) ledgerPaths.add(ipath);
    return ledgerPaths;
  }

  private async checkpointWrites(
    repo: string,
    projections: Record<string, string>,
    ledgerPaths: ReadonlySet<string>,
  ): Promise<Array<{ ipath: string; bytes: string }>> {
    const stale: string[] = [];
    const toWrite: Array<{ ipath: string; bytes: string }> = [];
    const diskPaths = (await this.api.listPaths(repo)).filter(
      (path) => !path.startsWith('checking/journal/') && !isUnjournaledIngredient(path),
    );
    for (const [ipath, bytes] of Object.entries(projections)) {
      const disk = await this.readIngredientOrNull(ipath);
      if (disk === bytes) continue;
      if (ledgerPaths.has(ipath) || (disk === null && EMPTY_CHECKPOINT_DOCUMENTS.has(bytes))) {
        toWrite.push({ ipath, bytes });
        continue;
      }
      stale.push(`${ipath} (${disk === null ? 'deleted out of band' : 'edited out of band'})`);
    }
    for (const ipath of diskPaths)
      if (!Object.hasOwn(projections, ipath)) stale.push(`${ipath} (on disk, not derived by the fold)`);
    if (stale.length)
      throw new Error(
        `checkpoint refused: derived state diverges out-of-band at ${stale.join(', ')} — ` +
          `never silently repaired (R-8.7.5); reopen the project to reconcile (§8.8)`,
      );
    return toWrite;
  }

  private async verifyCheckpointScope(repo: string, foldOut: FoldOutput): Promise<void> {
    const after = await this.api.getMetadataRaw(repo);
    const scopeAfter = (after?.type?.flavorType?.currentScope ?? {}) as Record<string, string[]>;
    if (canonical(scopeAfter) === canonical(foldOut.scope)) return;
    throw new Error(
      `checkpoint refused before commit: the rescanned currentScope ` +
        `(${canonical(scopeAfter)}) does not equal the fold's scope state ` +
        `(${canonical(foldOut.scope)}) — R-8.7.2; the derived writes stand and the ` +
        `journal remains authoritative`,
    );
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

  /** Bytes only — a reader has no journal, so it cannot supply the name. The
   * placeholder sends `resolveProjectScheme` to the fingerprint rung. */
  readVersification(): Promise<VrsRegister | null> {
    return this.boundRaw().readVersification();
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
