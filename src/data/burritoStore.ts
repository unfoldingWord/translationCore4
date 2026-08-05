// BurritoStore — the persistence interface of record (basis docs/ARCHITECTURE.md
// §3.2, with the D1–D10 revisions recorded in docs/guided-build/ARCHITECTURE.md §6).
// Implementations: FixtureStore (fixtureBurritoStore.ts, Increment 0) and
// HttpStore over pankosmia-web (Increment 3, BACKLOG I1.2.1/I1.2.2).
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

export interface BurritoStore {
  listProjects(): Promise<ProjectSummary[]>;
  open(repoPath: string): Promise<ProjectSummary>;

  readBook(book: string): Promise<{ usfm: string }>;
  /** The ONLY book-write path. Two producers feed it (D8/AD-1 as amended by
   * D31(1), 2026-07-31): the splice engine for every edit, and the one-time
   * creation seeder for a brand-new stub book. Callers never pass
   * re-serialized USFM. */
  writeBook(book: string, usfm: string): Promise<void>;

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

  /** `null` when the project has no `resources.json` yet — distinct from
   * "pins recorded but the version is not local" (the preflight cares). */
  readResources(): Promise<ResourcesFile | null>;
  readSettings(): Promise<SettingsFile | null>;
  writeSettings(settings: SettingsFile): Promise<void>;

  /** Invoked only by the checkpoint scheduler (D9/W-4, Increment 3). */
  commit(message: string): Promise<void>;
}
