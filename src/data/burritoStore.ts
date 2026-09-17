// BurritoStore — the persistence interface of record (basis docs/ARCHITECTURE.md
// §3.2, with the D1–D10 revisions recorded in docs/guided-build/ARCHITECTURE.md §6).
// Since issue #62 the sole production implementation is JournalingStore
// (src/data/journal/journalingStore.ts), which journals every mutation as an
// immutable §8.5 action before any derived file changes; HttpStore is the raw
// pankosmia-web surface it drives, and application code never touches it
// (test/noBypass.test.ts).
import type { AlignmentFile } from './align/zaln';
import type { VrsRegister } from './versification';

export interface ProjectSummary {
  id: string;
  name: string;
  languageTag: string;
  scriptDirection: string;
  /** The project kind (BURRITO-SPEC §1/§10, D74): a Bible project or an OBS
   * project — the platform's `flavor` field of the summary. */
  flavor: 'textTranslation' | 'textStories';
  /** Empty for an OBS project: the platform reports the scope table's Bible
   * book codes there, which are not books of the project [VERIFIED —
   * pankosmia-web 0.18.5, rig, 2026-09-15]. */
  bookCodes: string[];
  /** Platform summary timestamp (last metadata write) — Home sorts newest first. */
  timestamp?: number;
}

export interface DecisionContextId {
  checkId: string;
  occurrenceNote: string;
  /** verse is a number for single verses (tC3 convention) and the exact USFM span
   * string (e.g. "9-10") for verse spans; identity keys compare String(verse) —
   * never Number() (BURRITO-SPEC §5.2). A story decision (§10.5) carries
   * `{story, frame}` instead, and the two forms never mix. */
  reference:
    | { bookId: string; chapter: number; verse: number | string; story?: undefined; frame?: undefined }
    | { story: number; frame: number; bookId?: undefined; chapter?: undefined; verse?: undefined };
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
  /** §5.2 checked-against record. Identity is (repoPath + sha) — D58/D59;
   * `version` is a display label. `sha` stays optional in the TYPE only for
   * the future tC3 import boundary (FR-25 unresolved records); every tC4
   * writer supplies it. */
  resource?: { repoPath: string; version?: string; sha?: string; languageSet?: string };
  decisions: Decision[];
}

/** One §5.3 resource pin. `sha` is the REQUIRED commit identity (40 lowercase
 * hex, D58) verified at sb-zip import (OPEN-QUESTIONS #24); `version` is an
 * OPTIONAL release-tag display label — tags are not enforced upstream, so it
 * is never compared as identity. */
export interface ResourcePin {
  repoPath: string;
  version?: string;
  flavor: string;
  sha: string;
  /** The books this exact pinned commit contains, uppercase (issue #16, D41).
   *
   * OPTIONAL and additive, so `schemaVersion` stays 2 (§9). Recorded at pin
   * time, while the resource is local and its real contents can be read.
   *
   * WHY IT MATTERS: without it, coverage can only be computed from what is
   * installed right now, so "this resource does not have Titus" and "this
   * resource is not downloaded yet" are indistinguishable — and the resolver has
   * to fall back to English for both. Recorded coverage tells them apart, so a
   * covered-but-absent resource is FETCHED rather than silently substituted.
   *
   * Because a pin is immutable — identity is `repoPath` + `sha` (D58) — the
   * content behind it can never change, so recorded coverage never goes stale.
   * It is a fact about that commit, not a cache. */
  books?: string[];
}

/** One language set: a coherent helps suite at pinned versions. The `twl` slot
 * carries the per-book links whose coverage drives (tool, book) resolution. */
export interface LanguageSet {
  gatewayLanguage: { languageId: string; owner: string };
  translationNotes: ResourcePin;
  translationWordsLinks: ResourcePin;
  translationWords: ResourcePin;
  translationAcademy: ResourcePin;
  /** OPTIONAL (§5.3 1.10, D64): the language's comprehension questions (tq).
   * Absent = covers no book; the set stays complete without it. */
  translationQuestions?: ResourcePin;
  /** OPTIONAL (§5.3 1.10, D64): the language's simplified, meaning-based
   * Bible — `en_ust` for English, `<lang>_gst` where a gateway publishes one. */
  simplifiedText?: ResourcePin;
  /** OPTIONAL (§10.6, D75): the OBS source and two checking resources. An OBS
   * set is complete when these three pins and the shared tW/tA pins exist. */
  obs?: ResourcePin;
  'obs-tn'?: ResourcePin;
  'obs-twl'?: ResourcePin;
  /** OPTIONAL (§10.6, D75): a language-set image-pack override. The bundled
   * default pack is independent of this slot and needs no project pin. */
  'obs-images'?: ResourcePin;
}

export const isCompleteBibleLanguageSet = (set: Partial<LanguageSet>): boolean =>
  !!set.translationNotes && !!set.translationWordsLinks && !!set.translationWords && !!set.translationAcademy;

export const isCompleteObsLanguageSet = (set: Partial<LanguageSet>): boolean =>
  !!set.obs && !!set['obs-tn'] && !!set['obs-twl'] && !!set.translationWords && !!set.translationAcademy;

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

/** Parameters of createObsProject (J20, #287): the platform's
 * new-obs-resource payload. The scope is always all fifty stories (R-10.2.2). */
export interface CreateObsProjectParams {
  content_name: string;
  content_abbr: string;
  content_language_code: string;
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
/** #63: `intent: 'spans'` says the slot-set change is verse spans created or
 * broken. The store maps the keys it projects to the new keys by the verse
 * numbers they share ("2:9","2:10" to "2:9-10" is a create; the reverse a
 * break) — from ITS projection at write time, never from the app's
 * bookkeeping (Codex rounds 1–2: a retained failure or a replay makes any
 * app-side guess of the projected keys wrong). */
export interface StructuralEditOptions {
  intent?: 'spans';
}

/** One parsed OBS story (BURRITO-SPEC §10.3): the title (frame 0), the frames
 * in file order (`frames[0]` is frame 1), and the reference line's text or
 * null. Produced by the reference parser (journal/story.mjs). */
export interface Story {
  number: number;
  title: string;
  frames: Array<{ image: string; text: string }>;
  ref: string | null;
}

export interface BurritoStore {
  listProjects(): Promise<ProjectSummary[]>;
  open(repoPath: string): Promise<ProjectSummary>;

  /** Create the project container (server-side; the one unavoidable pre-journal
   * step) and publish the creation seed. Does not bind the store — call open()
   * on the result (a crash between the two is healed by universal seeding). */
  createProject(params: CreateProjectParams): Promise<{ repoPath: string }>;

  /** Scaffold + journal one new book as a self-contained §8.5 book.add. */
  addBook(params: AddBookParams): Promise<void>;

  /** Create an OBS project (J20, #287; BURRITO-SPEC §10.2, D74): the platform
   * copies its `text_stories` template and commits; the store then writes the
   * fifty stories in the SEED FORM (every title `# N.`, R-10.2.4) and commits
   * that base, so the repository differs from the template only in
   * `metadata.json` and the fifty title lines. Does not bind the store — call
   * open() on the result. */
  createObsProject(params: CreateObsProjectParams): Promise<{ repoPath: string }>;

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
   * built conservatively from the new whole-book USFM. With `intent: 'spans'`
   * (#63) the old and new slot keys of each verse span created or broken are
   * mapped by shared verse numbers: the new slot claims the old text heads as
   * its sources, alignments and decisions on the old keys are
   * `invalidate-retain`, and each new key gets an empty `invalid` §5.1 record
   * when an alignment was affected (D70). */
  applyStructuralEdit(book: string, usfm: string, opts?: StructuralEditOptions): Promise<void>;

  // ---- the story path (OBS projects, BURRITO-SPEC §10 — issue #286) ---------
  // The ingredient path rule is `content/NN.md` with a two-digit story number
  // (R-10.2.2). Reads and writes go through the reference story module
  // (journal/story.mjs): there is ONE parser and ONE set of writers.

  /** The story numbers the project holds on disk, ascending. */
  listStories(): Promise<number[]>;
  /** One story: the exact bytes read, their md5, and the parsed §10.3 form. */
  readStory(story: number): Promise<{ bytes: string; md5: string; story: Story }>;
  /** Set one frame's paragraph (frame 0 is the title). The store removes
   * blank lines and carriage returns before it seals (R-10.3.2, D74 §5);
   * single newlines survive. A frame the story does not have is refused
   * (R-10.7.5). The write is a `v: 2` text.frame.set; on disk it replaces
   * that frame's region and nothing else (R-10.3.4). */
  writeFrame(story: number, frame: number, text: string): Promise<void>;
  /** Set the title text (the same register as frame 0), one trimmed line. */
  writeTitle(story: number, text: string): Promise<void>;
  /** Set the reference line's text without the underscores, one trimmed
   * non-empty line (R-10.3.3); a `v: 2` text.story.ref.set. */
  writeRef(story: number, text: string): Promise<void>;

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
   * exact commit produced this book's checks (D17/D30). Identity is
   * (repoPath + sha); the version tag is a display label (D58/D59). */
  upsertDecision(
    tool: string,
    book: string,
    decision: Decision,
    resource?: { repoPath: string; version?: string; sha: string; languageSet?: string },
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
  /** #9: the settings document AND the md5 of the bytes read — hand it back
   * as `expectMd5` so a concurrent write is refused, not overwritten (the
   * same compare-and-swap every other sidecar already has, OPEN-QUESTIONS #17). */
  readSettingsWithMd5(): Promise<{ value: SettingsFile | null; md5: string | null }>;
  /** Issue #62: diffed per settings path into settings.set events; a folded
   * path absent from the document removes with {removed: true}. `expectMd5`
   * (#9): refuse with StaleWriteError when the file no longer hashes to it;
   * `null` = must still be absent (a first write); omitted = no check. */
  writeSettings(settings: SettingsFile, expectMd5?: string | null): Promise<void>;

  /** The project's versification register (issue #15) — the scheme NAME chosen
   * at creation plus the exact `ingredients/vrs.json` bytes. `null` when the
   * project carries no versification ingredient at all, which is common: three
   * of five sampled published burritos have none, so absence is NOT `eng`.
   *
   * The name is a §8.5 `project.vrs.set` first-value register, sealed in the
   * creation seed and immutable thereafter. A project tC4 did not create has no
   * name to read (the platform DISCARDS the name it was given — it uses it only
   * to pick a template file), so the store reports a non-scheme placeholder and
   * `resolveProjectScheme` fingerprints the bytes instead. */
  readVersification(): Promise<VrsRegister | null>;

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
  /** A checkpoint commit (#183, D9): read the repository's pending changes and
   * commit them with the message `messageFor` derives from them, or do nothing
   * and return null when `messageFor` returns null (a clean tree — the platform
   * would record an EMPTY commit, PLATFORM-NOTES #9). The read and the commit
   * run as ONE queued operation, so two checkpoints that overlap cannot both see
   * the same pending changes. Returns the message committed, or null. */
  commitPending(messageFor: (changes: Array<{ path: string; change_type: string }>) => string | null): Promise<string | null>;
}
