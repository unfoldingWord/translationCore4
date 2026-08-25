// HttpStore — the BurritoStore interface (src/data/burritoStore.ts, the
// interface of record) over the live pankosmia-web server via ServerApi
// (checklist C3.2; semantics per docs/ARCHITECTURE.md §3.2 + BURRITO-SPEC §5/§6).
//
// Write policy (encoded once in serverApi.ts, applied here):
//   - USFM writes keep the .bak undo (omit no_bak — PLATFORM-NOTES #8) and pass
//     update_ingredients (registration + md5 refresh). The x-role wipe the
//     rescan causes is ACCEPTED (D28 addendum): no HTTP route can write
//     metadata.json at 0.18.5 [VERIFIED], so no role re-assertion is attempted.
//   - Sidecar writes pass update_ingredients and KEEP the .bak. W-3 permits
//     skipping it for HIGH-FREQUENCY writes; a decision write is one per user
//     action, so the single-level undo is worth its cost (OPEN-QUESTIONS #17).
//     Sidecar writes also accept an optional expectMd5 compare-and-swap.
//   - Nothing here auto-commits (W-4): commit(message) is invoked only by the
//     checkpoint scheduler.
import type {
  Decision,
  DecisionContextId,
  DecisionFile,
  ProjectSummary,
  ResourcesFile,
  SettingsFile,
} from './burritoStore';
import type { AlignedWord, Alignment, AlignmentFile, AlignmentVerseRecord } from './align/zaln';
import { normalizeOccurrences, type WithOccurrences } from './align/occurrences';
import {
  ServerApi,
  ServerApiError,
  type NewScriptureBookParams,
  type NewTextTranslationParams,
  type RepoSummary,
  type ServerApiInit,
} from './serverApi';
import { sortCanonical } from './bookNames';
import { samePath } from './resolve';
import { UNRECORDED_SCHEME, type VrsRegister } from './versification';

/** App-created projects live under this org; sideloaded resources live under
 * _local_/_sideloaded_/ and are NOT projects (they never list). */
const APP_ORG = '_local_/_local_';

// ---------------------------------------------------------------------------
// MD5 (RFC 1321), self-contained. crypto.subtle has no MD5, and the store runs
// in both the browser and node, so a tiny implementation lives here. readBook's
// md5 is computed from the exact bytes read — the metadata's recorded md5 may
// lag, the bytes are the truth (ARCHITECTURE §3.2).
// ---------------------------------------------------------------------------

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

/** md5 of the UTF-8 bytes of `text`, as lowercase hex. */
export const md5Hex = (text: string): string => {
  const data = new TextEncoder().encode(text);
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let j = 0; j < 16; j += 1) m[j] = view.getUint32(offset + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (f + a + MD5_K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << MD5_SHIFTS[i]) | (sum >>> (32 - MD5_SHIFTS[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return [...out].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------------------
// Errors and option shapes
// ---------------------------------------------------------------------------

/** In-process serialization of writes to a single ingredient path (B7). Each
 * call chains after the previous holder of the same key (whichever way it
 * settled), so a check→write runs to completion before the next begins. Keyed
 * per (repo, ipath), shared across all HttpStore instances in this process.
 *
 * This is scoped to ONE app instance ON PURPOSE. tC4 runs a single instance per
 * machine (D39, as tC3 did), so the only concurrency to serialize is this one
 * copy's own overlapping async writes. Two machines editing one project is NOT
 * a lock problem — each has its own git clone — and is handled by the Phase-2
 * journal merge (BURRITO-SPEC §8, gated after Phase 1), not here.
 *
 * Exported (ONE lock map per process): journal/journalStore.ts serializes its
 * read-check-write segment publishes through the same chains, so a journal write
 * and a sidecar write to one path can never interleave. */
const writeChains = new Map<string, Promise<unknown>>();
export const withPathLock = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const prior = writeChains.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  // Store a settled-either-way marker so a rejection never breaks the chain.
  writeChains.set(key, run.then(() => undefined, () => undefined));
  return run;
};

/** writeBook's optimistic check failed (D-3): the book changed since the
 * caller read it. Re-read, re-apply the splice, retry. */
export class StaleWriteError extends Error {
  readonly book: string;
  readonly expectedMd5: string;
  readonly actualMd5: string;

  constructor(book: string, expectedMd5: string, actualMd5: string) {
    super(
      `stale write refused for ${book}: expected md5 ${expectedMd5} but the stored bytes hash to ${actualMd5}`,
    );
    this.name = 'StaleWriteError';
    this.book = book;
    this.expectedMd5 = expectedMd5;
    this.actualMd5 = actualMd5;
  }
}

export interface WriteBookOptions {
  /** When present, the current stored bytes are read first and the write is
   * refused with StaleWriteError if their md5 differs (D-3 optimistic check). */
  expectMd5?: string;
}

export interface HttpStoreInit {
  /** Provide a configured ServerApi, or let the store build one from baseUrl/fetchFn. */
  api?: ServerApi;
  baseUrl?: ServerApiInit['baseUrl'];
  fetchFn?: ServerApiInit['fetchFn'];
  /** Optionally bind to a project immediately (equivalent to a later open()). */
  repoPath?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const bookIpath = (book: string): string => `${book.toUpperCase()}.usfm`;
const alignmentsIpath = (book: string): string => `checking/alignments/${book.toUpperCase()}.json`;
const decisionsIpath = (tool: string, book: string): string =>
  `checking/${tool}/${book.toUpperCase()}.json`;
const RESOURCES_IPATH = 'checking/resources.json';
const SETTINGS_IPATH = 'checking/settings.json';
/** §4.3. The platform writes this at creation and the client MUST NOT edit it. */
const VRS_IPATH = 'vrs.json';

const toProjectSummary = (repoPath: string, summary: RepoSummary): ProjectSummary => ({
  id: repoPath,
  name: summary.name,
  languageTag: summary.language_code,
  scriptDirection: summary.script_direction,
  // The platform lists book_codes alphabetically — the app shows canon order.
  bookCodes: sortCanonical(summary.book_codes),
  // The platform's `timestamp` is the SCAN time — identical for every repo, so it
  // cannot order writes [VERIFIED live 2026-07-31]; `generated_date` is the
  // project's creation date. Home orders by most-recently-USED — the
  // client-settings lastUsed record wins over this creation fallback.
  timestamp: Date.parse(summary.generated_date) || 0,
});

// The align/occurrences helper is typed against an index-signature shape;
// AlignedWord is an interface, so route through the intersection (I-2, PLATFORM-NOTES #2).
const normalizeWord = (word: AlignedWord): AlignedWord =>
  normalizeOccurrences(word as AlignedWord & WithOccurrences);

const normalizeAlignment = (alignment: Alignment): Alignment => ({
  ...alignment,
  topWords: alignment.topWords.map(normalizeWord),
  bottomWords: alignment.bottomWords.map(normalizeWord),
});

const normalizeVerseRecord = (record: AlignmentVerseRecord): AlignmentVerseRecord => ({
  ...record,
  alignments: record.alignments.map(normalizeAlignment),
  wordBank: record.wordBank.map(normalizeWord),
});

/** MUST normalize occurrence/occurrences to integers at the store boundary
 * (I-2): USFM attribute parsing yields strings and the alignment libraries
 * fail wholesale on them (PLATFORM-NOTES #2). */
export const normalizeAlignmentFile = (data: AlignmentFile): AlignmentFile => ({
  ...data,
  chapters: Object.fromEntries(
    Object.entries(data.chapters).map(([chapter, verses]) => [
      chapter,
      Object.fromEntries(
        Object.entries(verses).map(([verse, record]) => [verse, normalizeVerseRecord(record)]),
      ),
    ]),
  ),
});

/** The §5.2 identity key: (checkId, bookId lowercase, chapter, verse,
 * occurrence). Chapter and verse compare as String(...) BOTH sides — a span
 * verse is its exact span string ("9-10") and Number("9-10") is NaN; never
 * Number()-coerce (BURRITO-SPEC §5.2, harness check 24). */
export const identityKey = (contextId: DecisionContextId): string =>
  [
    contextId.checkId,
    contextId.reference.bookId.toLowerCase(),
    String(contextId.reference.chapter),
    String(contextId.reference.verse),
    String(contextId.occurrence),
  ].join('\u0000');

/** INVARIANT I-2 (BURRITO-SPEC §5): every occurrence/occurrences field is an
 * integer on disk. Parser-shaped inputs arrive as strings ("1"); coerce them,
 * and REJECT anything that is not an integer rather than persist a `NaN`/string
 * (a bare `Number("x")` would silently write `null`). Applied at every decision
 * write boundary — the single upsert AND the whole-file rewrite. */
const toIntegerOccurrence = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  throw new RangeError(
    `I-2: ${field} must be an integer occurrence, got ${JSON.stringify(value)}`,
  );
};

/** Normalize the occurrence-bearing fields of a decision's contextId: its own
 * `occurrence`, and (for a tN array quote) each quote word's `occurrence`. */
const normalizeContextId = (contextId: DecisionContextId): DecisionContextId => ({
  ...contextId,
  occurrence: toIntegerOccurrence(contextId.occurrence, 'contextId.occurrence'),
  ...(Array.isArray(contextId.quote)
    ? {
        quote: contextId.quote.map((word) => ({
          ...word,
          occurrence: toIntegerOccurrence(word.occurrence, 'quote.occurrence'),
        })),
      }
    : {}),
});

export const normalizeDecision = (decision: Decision): Decision => {
  // PLATFORM-NOTES #14: empty selections coerce to false — [] is not used.
  const selections = Array.isArray(decision.selections)
    ? decision.selections.length === 0
      ? false
      : decision.selections.map((selection) => ({
          ...selection,
          occurrence: toIntegerOccurrence(selection.occurrence, 'selection.occurrence'),
          occurrences: toIntegerOccurrence(selection.occurrences, 'selection.occurrences'),
        }))
    : decision.selections;
  return {
    ...decision,
    contextId: normalizeContextId(decision.contextId),
    selections,
    // §5.2: a writer that sets invalidated MUST NOT leave status:"valid" in place.
    ...(decision.invalidated && decision.status === 'valid'
      ? { status: 'invalid' as const }
      : {}),
    // §5.2: modifiedTimestamp is REQUIRED (Phase-2 forward-compat).
    modifiedTimestamp: decision.modifiedTimestamp ?? new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

// Since issue #62 HttpStore is the RAW server surface, deliberately NOT an
// implementation of the BurritoStore write boundary: every canonical mutation
// goes through JournalingStore (src/data/journal/journalingStore.ts), which
// journals the action FIRST and drives this class for the derived writes.
// Application code must not construct or call this class directly
// (test/noBypass.test.ts enforces the boundary).
export class HttpStore {
  readonly api: ServerApi;
  private boundRepoPath: string | null;

  constructor(init: HttpStoreInit = {}) {
    this.api = init.api ?? new ServerApi({ baseUrl: init.baseUrl, fetchFn: init.fetchFn });
    this.boundRepoPath = init.repoPath ?? null;
  }

  /** The repo path of the open project, or null before open(). */
  get repoPath(): string | null {
    return this.boundRepoPath;
  }

  private repo(): string {
    if (this.boundRepoPath === null) {
      throw new Error('HttpStore: no project open — call open(repoPath) first');
    }
    return this.boundRepoPath;
  }

  // ---- projects ------------------------------------------------------------

  /** App projects only: summaries filtered to org _local_/_local_ (server-side)
   * AND flavor textTranslation (client-side) — sideloaded resources and
   * broken-metadata repos never list. */
  async listProjects(): Promise<ProjectSummary[]> {
    const summaries = await this.api.getSummaries(APP_ORG);
    return Object.entries(summaries)
      .filter(([, summary]) => summary.flavor === 'textTranslation')
      .map(([repoPath, summary]) => toProjectSummary(repoPath, summary))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)); // newest first (owner, 2026-07-31)
  }

  async open(repoPath: string): Promise<ProjectSummary> {
    const summary = await this.api.getSummary(repoPath);
    this.boundRepoPath = repoPath;
    // Tell the shell which project is current (basis §3.1 app-state route).
    await this.api.setCurrentProject(repoPath);
    return toProjectSummary(repoPath, summary);
  }

  /** POST /git/new-text-translation (D25: versification required, eng default;
   * the platform writes ingredients/vrs.json and scaffolds the book with the
   * initial commit). Does not bind the store — call open() on the result. */
  async createProject(params: NewTextTranslationParams): Promise<{ repoPath: string }> {
    await this.api.newTextTranslation(params);
    return { repoPath: `${APP_ORG}/${params.content_abbr}` };
  }

  /** POST /git/new-scripture-book on the open project. The endpoint scaffolds
   * the book AND regenerates the metadata (the new <BOOK>.usfm is registered
   * and currentScope gains the book [VERIFIED live] — no remake call needed),
   * but it does NOT commit (verified against source; the upstream code comment
   * is misleading). The store never auto-commits (W-4): the caller decides the
   * checkpoint and calls commit(). */
  async addBook(params: NewScriptureBookParams): Promise<void> {
    await this.api.newScriptureBook(this.repo(), params);
  }

  // ---- book text -----------------------------------------------------------

  /** md5 is computed client-side from the exact bytes read — the metadata's
   * recorded md5 may lag; the bytes are the truth. */
  async readBook(book: string): Promise<{ usfm: string; md5: string }> {
    const usfm = await this.api.readIngredient(this.repo(), bookIpath(book));
    return { usfm, md5: md5Hex(usfm) };
  }

  /** The ONLY book-write path (D8/AD-1). Whole-book write that keeps the .bak
   * undo (omit no_bak — PLATFORM-NOTES #8) and passes update_ingredients
   * (registration + md5 refresh; the x-role wipe is accepted — D28 addendum). */
  async writeBook(book: string, usfm: string, opts: WriteBookOptions = {}): Promise<void> {
    // B13 — serialize the check→write per book path, exactly as writeJsonSidecar
    // does (B7). The md5 precheck alone is a TOCTOU race: two overlapping draft
    // writes both pass the check and the earlier edit is silently lost.
    await withPathLock(`${this.repo()} ${bookIpath(book)}`, async () => {
      if (opts.expectMd5 !== undefined) {
        const current = await this.api.readIngredient(this.repo(), bookIpath(book));
        const currentMd5 = md5Hex(current);
        if (currentMd5 !== opts.expectMd5) {
          throw new StaleWriteError(book.toUpperCase(), opts.expectMd5, currentMd5);
        }
      }
      await this.api.writeIngredient(this.repo(), bookIpath(book), usfm, {
        updateIngredients: true,
        keepBak: true,
      });
    });
  }

  /** Read a pinned source text from a sideloaded resource burrito (e.g.
   * '_local_/_sideloaded_/en_ult'). Sideloaded burritos keep the ingredients/
   * layout and ipath is relative to ingredients/, so the book ipath is
   * '<BOOK>.usfm' [VERIFIED live]. */
  async readSourceBook(sourceRepoPath: string, bookCode: string): Promise<{ usfm: string }> {
    const usfm = await this.api.readIngredient(sourceRepoPath, bookIpath(bookCode));
    return { usfm };
  }

  // ---- sidecars (BURRITO-SPEC §2 layout under checking/) ---------------------

  private async readJsonSidecar<T>(ipath: string): Promise<T | null> {
    return (await this.readJsonSidecarWithMd5<T>(ipath)).value;
  }

  /** Read a sidecar AND the hash of the exact bytes read, so the caller can
   * hand it back as `expectMd5` and turn a lost update into a refused write.
   * `md5` is null when the file does not exist — meaning "expect absence". */
  private async readJsonSidecarWithMd5<T>(
    ipath: string,
  ): Promise<{ value: T | null; md5: string | null }> {
    try {
      const text = await this.api.readIngredient(this.repo(), ipath);
      return { value: JSON.parse(text) as T, md5: md5Hex(text) };
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) return { value: null, md5: null };
      throw error;
    }
  }

  private async writeJsonSidecar(
    ipath: string,
    data: unknown,
    expectMd5?: string | null,
  ): Promise<string> {
    return this.writeSidecarPayload(ipath, JSON.stringify(data, null, 2), expectMd5);
  }

  /**
   * Write pre-serialized sidecar bytes, with OPTIONAL compare-and-swap
   * (OPEN-QUESTIONS #17). Callers that have a value serialize it via
   * writeJsonSidecar; callers restoring EXACT bytes (the gateway rollback, B21)
   * pass the raw text so no re-serialization changes it.
   *
   * The platform writes whole files unconditionally, so a read-modify-write
   * cycle can silently lose another writer's update (BURRITO-SPEC W-5). Passing
   * `expectMd5` re-reads immediately before writing and refuses when the bytes
   * moved. `null` means "the file must still not exist" (create/create race).
   * `.bak` is KEPT for sidecars (W-3's skip is for high-frequency writes).
   *
   * B7 — the md5 precheck alone is NOT an atomic compare-and-swap: the platform
   * has no conditional write, so between the check and the write a second writer
   * can pass the same check and clobber the first (TOCTOU). The whole check→write
   * is serialized per ingredient path (`withPathLock`) so overlapping guarded
   * writes cannot interleave; the loser re-reads and its expectMd5 no longer
   * matches, so it is refused, not lost. Airtight WITHIN this process; two
   * separate OS processes still need a platform CAS primitive (D39: tC4 is
   * single-instance per machine, so that is not a live concern).
   */
  private async writeSidecarPayload(
    ipath: string,
    payload: string,
    expectMd5?: string | null,
  ): Promise<string> {
    return withPathLock(`${this.repo()} ${ipath}`, async () => {
      if (expectMd5 !== undefined) {
        const { md5: currentMd5 } = await this.readJsonSidecarWithMd5<unknown>(ipath);
        if (currentMd5 !== expectMd5) {
          throw new StaleWriteError(ipath, expectMd5 ?? '(absent)', currentMd5 ?? '(absent)');
        }
      }
      await this.api.writeIngredient(this.repo(), ipath, payload, {
        updateIngredients: true,
        keepBak: true,
      });
      // The md5 of EXACTLY the bytes we wrote, captured while the lock is held
      // (B15) — a later CAS uses it instead of a racy read-back.
      return md5Hex(payload);
    });
  }

  async readAlignments(book: string): Promise<AlignmentFile | null> {
    return this.readJsonSidecar<AlignmentFile>(alignmentsIpath(book));
  }

  /** `expectMd5` opts into compare-and-swap; obtain it from
   * `readAlignmentsWithMd5`. Omit it only for a first write. */
  async writeAlignments(
    book: string,
    data: AlignmentFile,
    expectMd5?: string | null,
  ): Promise<void> {
    await this.writeJsonSidecar(alignmentsIpath(book), normalizeAlignmentFile(data), expectMd5);
  }

  /** Alignments plus the hash of the bytes read — the input to a safe
   * read-modify-write cycle (#17). */
  async readAlignmentsWithMd5(
    book: string,
  ): Promise<{ value: AlignmentFile | null; md5: string | null }> {
    return this.readJsonSidecarWithMd5<AlignmentFile>(alignmentsIpath(book));
  }

  /** null when the file does not exist yet (a project before its first check). */
  async readDecisions(tool: string, book: string): Promise<DecisionFile | null> {
    return this.readJsonSidecar<DecisionFile>(decisionsIpath(tool, book));
  }

  /** Decisions plus the hash of the bytes read — the input to a safe
   * read-modify-write cycle (OPEN-QUESTIONS #17). */
  async readDecisionsWithMd5(
    tool: string,
    book: string,
  ): Promise<{ value: DecisionFile | null; md5: string | null }> {
    return this.readJsonSidecarWithMd5<DecisionFile>(decisionsIpath(tool, book));
  }

  /** The RAW decision bytes + their md5 — for a byte-EXACT snapshot the caller
   * can restore verbatim later (B21). readDecisionsWithMd5 parses, and writing
   * a parsed value back through writeDecisions re-serializes/normalizes it,
   * which changes the bytes; the gateway rollback must leave the sidecar
   * byte-identical, so it captures and restores THIS raw text. */
  async readDecisionsText(
    tool: string,
    book: string,
  ): Promise<{ text: string | null; md5: string | null }> {
    try {
      const text = await this.api.readIngredient(this.repo(), decisionsIpath(tool, book));
      return { text, md5: md5Hex(text) };
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) return { text: null, md5: null };
      throw error;
    }
  }

  /** Restore decision bytes VERBATIM (no normalization) under compare-and-swap.
   * ONLY for undoing a partial gateway migration (B21): it writes back the exact
   * pre-migration text captured by readDecisionsText, so a failed transaction
   * leaves the sidecar byte-identical and the tree clean. Normal writes go
   * through writeDecisions, which normalizes (I-2). */
  async restoreDecisionsText(
    tool: string,
    book: string,
    text: string,
    expectMd5?: string | null,
  ): Promise<string> {
    return this.writeSidecarPayload(decisionsIpath(tool, book), text, expectMd5);
  }

  /** Write a whole decision file, optionally under compare-and-swap. Used by
   * flows that rewrite more than one decision at once (a gateway-language
   * change re-attaching a book's work); single decisions go through
   * `upsertDecision`, which does its own CAS. */
  async writeDecisions(
    tool: string,
    book: string,
    file: DecisionFile,
    expectMd5?: string | null,
  ): Promise<string> {
    // I-2: normalize EVERY decision in the file, not just the ones a single
    // upsert touches. This whole-file path (a gateway-language re-attach)
    // previously wrote parser-shaped string occurrences straight to disk.
    const normalized: DecisionFile = {
      ...file,
      decisions: (file.decisions ?? []).map(normalizeDecision),
    };
    // Returns the md5 of exactly what was written (B15) — the gateway commit
    // uses it to CAS a rollback without a racy read-back.
    return this.writeJsonSidecar(decisionsIpath(tool, book), normalized, expectMd5);
  }

  /** Merge by the §5.2 identity key with quoteString verification; persists the
   * additive status field; empty selections coerce to false (PLATFORM-NOTES #14).
   * A key match whose quoteString differs means the resource changed: the
   * stored record is treated as unmatched and never overwritten — the incoming
   * decision is appended instead (§5.2 "reject the match"). */
  async upsertDecision(
    tool: string,
    book: string,
    decision: Decision,
    resource?: { repoPath: string; version?: string; sha: string; languageSet?: string },
  ): Promise<void> {
    const ipath = decisionsIpath(tool, book);
    const { value: existing, md5: expectMd5 } = await this.readJsonSidecarWithMd5<DecisionFile>(
      ipath,
    );
    const file: DecisionFile = existing ?? {
      schemaVersion: 1,
      tool,
      book: book.toUpperCase(),
      decisions: [],
    };
    // §5.2 resolution record (D17/D30). Stamped ONLY when the file has no
    // record yet, or when it already agrees — by (repoPath + sha), the only
    // identity (D58/D59); the version tag is a display label. A decision
    // write must never relabel a file to a resource its stored decisions did
    // not come from: changing which resource a book is checked against is an
    // explicit, consequences-shown action (D23a / D30.2 §5 default #2), not a
    // side effect of someone marking one check.
    if (resource) {
      const stored = file.resource as { repoPath: string; sha?: string } | undefined;
      const agrees =
        !stored || (samePath(stored.repoPath, resource.repoPath) && stored.sha === resource.sha);
      if (agrees) file.resource = resource;
    }
    const incoming = normalizeDecision(decision);
    const key = identityKey(incoming.contextId);
    // The match is identity key AND quoteString together (§5.2: quoteString
    // verification is part of the match). Matching the key alone and then
    // testing the quote finds a stale-quote record first and appends forever
    // (review finding M4, 2026-07-30): records with the same key but another
    // quoteString are legitimately co-present (orphaned decisions), so the
    // upsert must update ITS OWN quote's record, wherever it sits.
    const matchIndex = file.decisions.findIndex(
      (d) =>
        identityKey(d.contextId) === key &&
        d.contextId.quoteString === incoming.contextId.quoteString,
    );
    if (matchIndex >= 0) {
      file.decisions[matchIndex] = incoming;
    } else {
      file.decisions.push(incoming);
    }
    // Compare-and-swap: refuse rather than clobber a concurrent update (#17).
    await this.writeJsonSidecar(ipath, file, expectMd5);
  }

  /** `null` when the project has no `resources.json` yet. Increment 2 makes the
   * distinction load-bearing: the check-session preflight must tell "no pins
   * recorded" apart from "pins recorded but not local" (§5.3, D30.4-5). */
  async readResources(): Promise<ResourcesFile | null> {
    return this.readJsonSidecar<ResourcesFile>(RESOURCES_IPATH);
  }

  /** Resources plus the hash of the bytes read — the input to a safe
   * read-modify-write cycle. `resources.json` is a shared, whole-file document
   * (pins for the whole project), so a blind write loses a concurrent editor's
   * change; hand this `md5` back to `writeResources` to make that a refused
   * write instead (W-5, OPEN-QUESTIONS #17). */
  async readResourcesWithMd5(): Promise<{ value: ResourcesFile | null; md5: string | null }> {
    return this.readJsonSidecarWithMd5<ResourcesFile>(RESOURCES_IPATH);
  }

  /** Written by the create wizard (J1) with the installed-suite pins, in the
   * §5.3 schemaVersion-2 two-language-set shape (D17/D30 — migrated for
   * Increment 2). Not part of the BurritoStore interface — an extra, like
   * createProject/addBook.
   *
   * `expectMd5` opts into compare-and-swap: obtain it from `readResourcesWithMd5`
   * and a stale write is refused with StaleWriteError rather than silently
   * clobbering the other writer's pins (B7). `null` means "must still be absent"
   * (the create/create race). */
  async writeResources(resources: ResourcesFile, expectMd5?: string | null): Promise<void> {
    await this.writeJsonSidecar(RESOURCES_IPATH, resources, expectMd5);
  }

  async readSettings(): Promise<SettingsFile | null> {
    return this.readJsonSidecar<SettingsFile>(SETTINGS_IPATH);
  }

  async writeSettings(settings: SettingsFile): Promise<void> {
    await this.writeJsonSidecar(SETTINGS_IPATH, settings);
  }

  /** The versification register, read straight from the ingredient.
   *
   * The raw store has no journal, so it cannot know the scheme NAME — the
   * platform discards the name it was given at creation (it only uses it to
   * pick a template file), and it writes no role and no name into the burrito.
   * So this reports the bytes with a placeholder name, and
   * `resolveProjectScheme` falls through to fingerprinting. The journaling
   * store overrides this with the sealed §8.5 register, which does carry the
   * name for any project tC4 created. */
  async readVersification(): Promise<VrsRegister | null> {
    try {
      const bytes = await this.api.readIngredient(this.repo(), VRS_IPATH);
      return { name: UNRECORDED_SCHEME, bytes };
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) return null;
      throw error;
    }
  }

  // ---- checkpoints -----------------------------------------------------------

  /** W-4: ONLY the caller (the checkpoint scheduler — D9) decides checkpoints;
   * the store never auto-commits. add-and-commit sweeps ALL pending changes in
   * the repo; a commit with nothing pending succeeds [VERIFIED live 0.18.5]. */
  async commit(message: string): Promise<void> {
    await this.api.addAndCommit(this.repo(), message);
  }
}
