// The import contract (issue #361, D79 point 7, docs/ARCHITECTURE.md §8). A
// parser is a pure function from the dropped files to one ImportBundle; the
// shell (./shell.ts) owns every side effect. The parsers arrive with their
// issues: USFM #195, Scripture Burrito #196, tC3 #21.
import type { RefusalCode } from '../journal/runtime';

/** One verse's §5.1 alignment record, as the sidecar holds it. */
export type AlignmentRecord = Record<string, unknown>;
/** One §5.2 checking decision, as the sidecar holds it. */
export type DecisionRecord = Record<string, unknown>;
/** A resource pin the bundle asks for; the guided fix resolves it later. */
export type PinRequest = Record<string, unknown>;

export type ImportBundle = {
  kind: 'bible' | 'obs';
  facts: { language: string; name: string; license?: string; contributors?: string[] };
  books: Array<{ code: string; usfm: string }>; // bible
  stories?: Array<{ n: number; markdown: string }>; // obs
  alignments?: Record<string, AlignmentRecord[]>; // §5.1 per book
  decisions?: DecisionRecord[]; // §5.2
  pins?: PinRequest[]; // resolved later by the guided fix
  archive?: Uint8Array; // a Scripture Burrito uploaded as it is (D80 point 2); the shell wraps a flat zip
  findings: Array<{ kind: 'license' | 'details' | 'missing-verses' | 'damaged'; text: string; warn: boolean; code?: RefusalCode }>;
};
export type ImportFile = { bytes: Uint8Array; name: string };
export type ImportParser = {
  id: 'usfm' | 'burrito' | 'tc3';
  accepts: (files: ImportFile[]) => boolean;
  parse: (files: ImportFile[]) => Promise<ImportBundle>;
};
