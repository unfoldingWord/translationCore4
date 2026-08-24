// The production fold/materialization library — BURRITO-SPEC §8.6/§8.7/§8.8 at
// runtime (issue #62).
//
// This module IMPORTS the reference conformance implementation directly and adds
// only TypeScript shapes. There is deliberately no port: the reference modules
// were made environment-agnostic in this change set (no Node builtins), so the
// browser bundle and the conformance suite execute the SAME fold, checkpoint
// projections, reconcile and seeding code. test/journalRuntime.test.ts holds the
// proof: the vite-pipeline import and a native require of the reference produce
// identical output on the same vectors.
//
// Types are deliberately loose-but-named (the vendor.d.ts discipline): shapes are
// asserted behaviorally by the conformance suite, not re-invented here.
import { fold as foldRef, verseTextMd5 as verseTextMd5Ref } from '../../../conformance/journal/fold.mjs';
import { decompose as decomposeRef, recompose as recomposeRef, slotKeysOf as slotKeysOfRef, SLOT as SLOT_REF } from '../../../conformance/journal/skeleton.mjs';
import {
  derivedProjections as derivedProjectionsRef,
  classifyDivergence as classifyDivergenceRef,
  isUnjournaledIngredient as isUnjournaledIngredientRef,
  projectAlignments as projectAlignmentsRef,
  projectResources as projectResourcesRef,
  projectSettings as projectSettingsRef,
} from '../../../conformance/journal/checkpoint.mjs';
import { reconcileUsfm as reconcileUsfmRef, seedFromSidecars as seedFromSidecarsRef } from '../../../conformance/journal/reconcile.mjs';
import { makeClock as makeClockRef } from '../../../conformance/journal/hlc.mjs';
import { normalizeEvent as normalizeEventRef } from '../../../conformance/journal/schema.mjs';
import { toNfc as toNfcRef } from '../../../conformance/journal/grammar.mjs';
import type { JournalEvent } from './seal';

/** One live head as the fold reports it (liveHeads values). */
export interface LiveHead {
  ts: string;
  actor: string;
  book: string | null;
}

/** The §8.6 fold output — the fields the runtime dereferences, named. */
export interface FoldOutput {
  /** book code -> { usfm (recomposed bytes), verses: {"C:V": content} } */
  books: Record<string, { usfm: string; verses: Record<string, string> }>;
  /** toolId -> projected §5.2 decision records (sorted by contextId) */
  decisions: Record<string, Array<Record<string, unknown> & { contextId: { reference: { bookId: string; chapter: unknown; verse: unknown } } }>>;
  /** book -> { "C:V": §5.1 record } */
  alignments: Record<string, Record<string, Record<string, unknown>>>;
  /** §5.3 pin slot -> entry */
  pins: Record<string, unknown>;
  projectMeta: Record<string, unknown>;
  projectMetaRemoved: string[];
  settings: Record<string, unknown>;
  notes: Array<Record<string, unknown>>;
  forks: Array<{ key: string; heads: string[]; provisional: string }>;
  invalid: Array<{ book: string; verse: string; ts: string; orphaned?: boolean }>;
  retained: Array<{ key: string; ts: string; reason: string }>;
  autoMerged: Array<{ key: string; heads: string[]; winner: string }>;
  /** book -> §3 rule-4 scope value (folded book.add scope state) */
  scope: Record<string, string[]>;
  vrs: { name: string; bytes: string } | null;
  vrsRejected: string[];
  pendingStructural: Array<{ ts: string; book: string; status: string; detail: string[] }>;
  /** resolved head ts per register key (`book|`, `skel|`, `text|`, `align|`, `dec|`, `pin|`, `meta|`, `set|`) */
  headsTs: Record<string, string>;
  supersedeRefused: Array<{ key: string; ts: string; by: string }>;
  liveHeads: Record<string, LiveHead[]>;
  liveNotes: Array<{ ts: string; target: unknown; generation?: string }>;
}

/** §8.6: the pure fold of an event SET. Throws on a corrupt/malformed union. */
export const fold = foldRef as (events: JournalEvent[]) => FoldOutput;

/** §5.1 plain-text validity hash of ONE content slot (I-3). */
export const verseTextMd5 = verseTextMd5Ref as (content: string) => string;

/** §8.4 codec. decompose throws on reserved U+0001 / duplicate slots. */
export const decompose = decomposeRef as (usfm: string) => { skeleton: string; verses: Record<string, string> };
export const recompose = recomposeRef as (skeleton: string, verses: Record<string, string>) => string;
export const slotKeysOf = slotKeysOfRef as (skeleton: string) => string[];
export const SLOT = SLOT_REF as string;

/** The §8.7 regeneration set: every journal-derived shared file as {ipath: bytes}.
 * Throws (refuses) on any missing mandatory input or path-escaping key. */
export const derivedProjections = derivedProjectionsRef as (
  foldOut: FoldOutput,
  opts: { baseMetadata: unknown; resolutions: Record<string, Record<string, unknown>> },
) => Record<string, string>;

/** §8.8 divergence classification over the union of projected + on-disk paths. */
export const classifyDivergence = classifyDivergenceRef as (
  diskFiles: Record<string, string>,
  projections: Record<string, string>,
) => { tolerated: string[]; diverged: string[]; clean: string[] };

/** §8.5: a tolerated unjournaled ingredient class (ingredients/audio/). */
export const isUnjournaledIngredient = isUnjournaledIngredientRef as (ipath: string) => boolean;

export const projectAlignments = projectAlignmentsRef as (foldOut: FoldOutput, book: string) => string;
export const projectResources = projectResourcesRef as (pins: FoldOutput['pins']) => string;
export const projectSettings = projectSettingsRef as (settings: FoldOutput['settings']) => string;

/** The two EMPTY checkpoint documents. §8.7's regeneration set is complete, so
 * a checkpoint materializes resources.json/settings.json even when nothing is
 * folded for them; between checkpoints those files legitimately do not exist
 * yet. An ABSENT disk file whose projection is exactly the empty document is
 * therefore "not yet checkpointed", never divergence — ONE definition, shared
 * by the store's regeneration/classifier/checkpoint and by the verifier. */
export const EMPTY_CHECKPOINT_DOCUMENTS: ReadonlySet<string> = new Set([
  projectResources({}),
  projectSettings({}),
]);

/** §8.8 out-of-band reconcile / #62 explicit structural edit (opts.seed: null omits
 * the seed marker — an in-app action is not migrated data). */
export const reconcileUsfm = reconcileUsfmRef as (
  book: string,
  committedUsfm: string,
  foldOut: FoldOutput,
  clock: { issue(): string },
  actor: string,
  opts?: { seed?: { source: string; batch?: string } | null },
) => JournalEvent[];

export interface SeedInputs {
  actor: string;
  books?: Record<string, string | { usfm: string; scope: string[] }>;
  decisionFiles?: Record<string, { decisions: Array<Record<string, unknown>> }>;
  alignmentFiles?: Record<string, { chapters: Record<string, Record<string, unknown>> }>;
  resources?: unknown;
  settings?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  vrs?: { name: string; bytes: string } | null;
  source?: 'creation' | 'sidecar-migration' | 'tc3-import';
}

/** §8.8 universal seeding: state without a journal becomes seed events. */
export const seedFromSidecars = seedFromSidecarsRef as (inputs: SeedInputs) => JournalEvent[];

export const makeClock = makeClockRef as (
  actorId: string,
  now?: () => number,
) => { issue(): string; ratchet(ts: string): void };

/** I-4 content normalization (write-side NFC). */
export const toNfc = toNfcRef as <T>(value: T) => T;

/** The I-4 seal transform for ONE event (content NFC'd, identity untouched) —
 * what the sealed bytes will actually carry. The seed verifier folds the
 * normalized form so what it proves is what a reader will fold. */
export const normalizeEvent = normalizeEventRef as (event: JournalEvent) => JournalEvent;
