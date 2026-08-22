// BurritoStore — the persistence interface of record (basis docs/ARCHITECTURE.md
// §3.2, with the D1–D10 revisions recorded in docs/guided-build/ARCHITECTURE.md §6).
// Since issue #62 the sole production implementation is JournalingStore
// (src/data/journal/journalingStore.ts), which journals every mutation as an
// immutable §8.5 action before any derived file changes; HttpStore is the raw
// pankosmia-web surface it drives, and application code never touches it
// (test/noBypass.test.ts).
import type { AlignmentFile } from './align/zaln';

export interface ProjectSummary {
  id: string;
  name: string;
  languageTag: string;
  scriptDirection: string;
  bookCodes: string[];
  /** Platform summary timestamp (last metadata write) — Home sorts newest first. */
  timestamp?: number;
}

export interface DecisionContextId {
  checkId: string;
  occurrenceNote: string;
  /** verse is a number for single verses (tC3 convention) and the exact USFM span
   * string (e.g. "9-10") for verse spans; identity keys compare String(verse) —
   * never Number() (BURRITO-SPEC §5.2). */
  reference: { bookId: string; chapter: number; verse: number | string };
  tool: string;
  groupId: string;
  quote: string | Array<{ word: string; occurrence: number }>;
  quoteString: string;
  glQuote: string;
  occurrence: number;
}

/** Full tC3 check-item shape (BURRITO-SPEC §5.2 — never simplify). */
export interface Decision {
  contextId: DecisionContextId;
  category?: string;
  selections: Array<{ text: string; occurrence: number; occurrences: number }> | false;
  comments: string | false;
  reminders: boolean;
  nothingToSelect: boolean;
  verseEdits: boolean;
  invalidated: boolean;
  modifiedTimestamp?: string;
  status?: 'valid' | 'invalid' | 'todo'; // additive D2 field — normative in BURRITO-SPEC §5.2 since 1.1-draft (2026-07-07)
}

export interface DecisionFile {
  schemaVersion: number;
  tool: string;
  book: string;
  resource?: { repoPath: string; version: string };
  decisions: Decision[];
}

/** One §5.3 resource pin. `sha` is the OPTIONAL expected commit SHA (40 lowercase
 * hex) verified at sb-zip import (OPEN-QUESTIONS #24). */
export interface ResourcePin {
  repoPath: string;
  version: string;
  flavor: string;
  sha?: string;
}

/** One language set: a coherent helps suite at pinned versions. The `twl` slot
 * carries the per-book links whose coverage drives (tool, book) resolution. */
export interface LanguageSet {
  gatewayLanguage: { languageId: string; owner: string };
  translationNotes: ResourcePin;
  translationWordsLinks: ResourcePin;
  translationWords: ResourcePin;
  translationAcademy: ResourcePin;
}

/** `checking/resources.json` — BURRITO-SPEC §5.3 schemaVersion 2 (D17/D30).
 * Exactly two rungs: `primary` (the project's gateway language) and `fallback`
 * (the installed English suite). The automatic ladder is primary → fallback by
 * per-book coverage; any other language is an explicit whole-project change. */
export interface ResourcesFile {
  schemaVersion: number;
  languageSets: { primary: LanguageSet; fallback: LanguageSet };
  resources: Record<string, unknown>;
  extraScripture?: Array<{ id: string } & ResourcePin>;
}

/** The two automatic rungs, in ladder order (D30.2). */
export const LADDER = ['primary', 'fallback'] as const;
export type Rung = (typeof LADDER)[number];

export interface SettingsFile {
  schemaVersion: number;
  [key: string]: unknown;
}

/** Parameters of the canonical addBook operation (issue #62). The server
 * scaffolds the container (the unavoidable container step); `initialUsfm`, when
 * present, is the book's REAL initial state (the client-side seed from the
 * pinned source, PLATFORM-NOTES #19) — the §8.5 `book.add` journals scope,
 * skeleton and initial verses from it, so creation is ONE self-contained action
 * rather than a scaffold followed by a topology-changing write. */
export interface AddBookParams {
  book_code: string;
  book_title: string;
  book_abbr: string;
  add_cv: boolean;
  vrs_name?: string;
  initialUsfm?: string;
}

/** Parameters of the canonical createProject operation (moved behind the
 * boundary by issue #62 — the shape is the platform's new-text-translation
 * payload, see serverApi.NewTextTranslationParams). */
export interface CreateProjectParams {
  content_name: string;
  content_abbr: string;
  content_language_code: string;
  content_language_name?: string | null;
  add_book: boolean;
  book_code?: string;
  book_title?: string;
  book_abbr?: string;
  add_cv?: boolean;
  versification: string;
}

/** One planned decision-file rewrite inside a coordinated gateway change. */
export interface GatewayDecisionWrite {
  tool: string;
  book: string;
  /** The carry-over output for this book (computed against the NEW resource). */
  file: DecisionFile;
  /** md5 of the decision file's bytes the preview read (null = was absent). */
  expectMd5: string | null;
}

/** The coordinated gateway change (issue #62): every affected decision record
 * and resource pin changes as ONE multi-event journal action — validated fully
 * before publication, recovered FORWARD after it, never byte-rolled back. */
export interface GatewayChangePlan {
  resources: ResourcesFile;
  /** md5 of checking/resources.json the preview read (null = was absent). */
  resourcesMd5: string | null;
  decisions: GatewayDecisionWrite[];
}

/**
 * The persistence interface of record — and, since issue #62, the CANONICAL
 * WRITE BOUNDARY: every production project mutation goes through an
 * implementation of this interface, and the sole production implementation
 * (JournalingStore) records each mutation as an immutable §8.5 journal action
 * before any derived file changes. State and feature code MUST NOT call the raw
 * HttpStore mutation surface (test/noBypass.test.ts enforces this).
 */
export interface BurritoStore {
  listProjects(): Promise<ProjectSummary[]>;
  open(repoPath: string): Promise<ProjectSummary>;

  /** Create the project container (server-side; the one unavoidable pre-journal
   * step) and publish the creation seed. Does not bind the store — call open()
   * on the result (a crash between the two is healed by universal seeding). */
  createProject(params: CreateProjectParams): Promise<{ repoPath: string }>;

  /** Scaffold + journal one new book as a self-contained §8.5 book.add. */
  addBook(params: AddBookParams): Promise<void>;

  readBook(book: string): Promise<{ usfm: string }>;
  /** The ONLY book-write path. Two producers feed it (D8/AD-1 as amended by
   * D31(1), 2026-07-31): the splice engine for every edit, and — until #62
   * moved creation seeding into addBook — the one-time creation seeder.
   * Callers never pass re-serialized USFM. Whole-USFM input is a boundary
   * adapter (issue #62): the store diffs it against the journal projection and
   * publishes the unambiguous action (text.verse.set per changed verse, or a
   * slot-preserving text.skeleton.set); a slot-set change is REFUSED — use
   * applyStructuralEdit. */
  writeBook(book: string, usfm: string): Promise<void>;

  /** The explicit structural-edit operation (issue #62): ONE §8.5
   * text.structure.apply carrying the complete transition/disposition set,
   * built conservatively from the new whole-book USFM. */
  applyStructuralEdit(book: string, usfm: string): Promise<void>;

  readAlignments(book: string): Promise<AlignmentFile | null>;
  /** MUST normalize occurrence/occurrences to integers at this boundary (I-2). */
  /** `expectMd5` opts into compare-and-swap (OPEN-QUESTIONS #17): pass the
   * hash returned when the file was read, and a concurrent update is refused
   * rather than clobbered. */
  writeAlignments(book: string, data: AlignmentFile, expectMd5?: string | null): Promise<void>;

  readDecisions(tool: string, book: string): Promise<DecisionFile | null>;
  /** Merge by the §5.2 identity key with quoteString verification; persists
   * the additive `status` field; empty selections coerce to `false`
   * (PLATFORM-NOTES #14). Implemented at Increment 2 (checklist C2.6). */
  /** `resource` stamps the §5.2 resolution record — which resource at which
   * version produced this book's checks (D17/D30). */
  upsertDecision(
    tool: string,
    book: string,
    decision: Decision,
    resource?: { repoPath: string; version: string; languageSet?: string },
  ): Promise<void>;

  /** Whole-file decision write (a gateway-language re-attach and migrations).
   * Issue #62: the store diffs ALL records against the journal projection and
   * publishes the resulting decision events as one action; a record whose
   * identity key disappears from the file is invalidated-and-retained (§8.5:
   * decisions are never deleted). */
  writeDecisions(
    tool: string,
    book: string,
    file: DecisionFile,
    expectMd5?: string | null,
  ): Promise<string>;

  /** `null` when the project has no `resources.json` yet — distinct from
   * "pins recorded but the version is not local" (the preflight cares). */
  readResources(): Promise<ResourcesFile | null>;
  /** Whole-file pin write. Issue #62: diffed per §5.3 slot into
   * resource.pin.set events (removals use the spec's removed: true form). */
  writeResources(resources: ResourcesFile, expectMd5?: string | null): Promise<void>;

  readSettings(): Promise<SettingsFile | null>;
  /** Issue #62: diffed per settings path into settings.set events; a folded
   * path absent from the document removes with {removed: true}. */
  writeSettings(settings: SettingsFile): Promise<void>;

  /** Project-metadata overlay write (§8.5 project.meta.set — issue #62). Diffed
   * per dotted path against the folded overlay; removals use removed: true.
   * NOTE the platform exposes no HTTP metadata write route (D28), so the event
   * is journaled and the checkpoint verifies/refuses materialization. */
  writeProjectMeta(meta: Record<string, unknown>): Promise<void>;

  /** The coordinated gateway change (issue #62): one multi-event action across
   * every affected decision record and resource pin, forward recovery only. */
  applyGatewayChange(plan: GatewayChangePlan): Promise<void>;

  /** Invoked only by the checkpoint scheduler (D9/W-4, Increment 3). Issue #62:
   * performs the complete §8.7 checkpoint pipeline — fold, materialize the
   * complete derived set, refuse incomplete/path-escaping output, install and
   * byte-verify, rescan, then the server commit. */
  commit(message: string): Promise<void>;
}
