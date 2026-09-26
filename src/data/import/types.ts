// The import contract (issue #361, D79 point 7, docs/ARCHITECTURE.md §8). A
// parser is a pure function from the dropped files to one ImportBundle; the
// shell (./shell.ts) owns every side effect. The parsers arrive with their
// issues: USFM #195, Scripture Burrito #196, tC3 #21.
import type { RefusalCode } from '../journal/runtime';

/** One verse's §5.1 alignment record, as the sidecar holds it. */
export type AlignmentRecord = Record<string, unknown>;
/** One §5.2 checking decision, as the sidecar holds it. */
export type DecisionRecord = Record<string, unknown>;
/** A resource version the source project names (tC3: `manifest.json`
 * `externalResources`) for one book. The review step looks up each candidate's
 * sha; a pin is never stored without it (D58, D82). No candidate means the
 * project names no version. */
export type VersionRequest = {
  slot: 'translationNotes' | 'translationWords' | 'originalLanguage.nt' | 'originalLanguage.ot';
  book: string;
  candidates: Array<{ repoPath: string; version: string }>;
};

export type ImportBundle = {
  kind: 'bible' | 'obs';
  facts: { language: string; name: string; license?: string; contributors?: string[] };
  books: Array<{ code: string; usfm: string }>; // bible
  stories?: Array<{ n: number; markdown: string }>; // obs
  alignments?: Record<string, AlignmentRecord[]>; // §5.1 per book
  decisions?: DecisionRecord[]; // §5.2
  verses?: number; // the verses of text, for the review page
  sidecars?: Record<string, unknown>; // checking files the shell stores, by ingredient path (tC3)
  versions?: VersionRequest[]; // resolved to pins before the write (tC3: applyVersions)
  gateway?: { languageId: string; owner: string }; // the gateway language the decisions were made in
  licenseChoices?: string[]; // the files disagree: the review page asks which one
  archive?: Uint8Array; // a Scripture Burrito uploaded as it is (D80 point 2); the shell wraps a flat zip
  findings: Array<{ kind: 'license' | 'details' | 'missing-verses' | 'damaged'; text: string; warn: boolean; code?: RefusalCode }>;
};
export type ImportFile = { bytes: Uint8Array; name: string };
export type ImportParser = {
  id: 'usfm' | 'burrito' | 'tc3';
  accepts: (files: ImportFile[]) => boolean;
  parse: (files: ImportFile[]) => Promise<ImportBundle>;
};
