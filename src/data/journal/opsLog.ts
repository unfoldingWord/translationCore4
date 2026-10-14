// The ops log (issue #374; TEAM-SYNC-PLAN 1.4): every store operation writes
// one record to the installation store BEFORE its first side effect and closes
// it with the operation's Report at the end. A record that is still open at the
// next start of the app belongs to an operation that was killed; `recover`
// resolves it — an interrupted import deletes its partial repository, an
// interrupted export is simply gone, and an interrupted open or checkpoint is
// left to the journal, whose outbox replays at the next open of that project.
//
// The records live in the platform's per-client settings document (the one
// store a client has outside its projects), beside `draftUnits` and `lastUsed`,
// so they never enter a burrito. Every write goes through ONE serialized
// read-modify-write writer, so an ops write and any other settings write can
// never overwrite each other.
//
// The sync (issue #676, G8; D101) keeps its safety record ON DISK, never in this
// settings document: the settings document is written in place by many writers
// and has no compare-and-set, so it never locks or unlocks a project. The record
// is the project's scratch copy (`scratchPathOf`, under `_local_/_archive_/`, so
// Home never lists it) and one marker file inside it, `ingredients/tc4-sync/apply.json`
// (`APPLY_MARKER`). The order of a sync, after its push:
//   write the marker -> move the sync generation on -> apply (`applyScratch`:
//   the project's `ingredients/`, except `audio/` and the marker, get the
//   scratch copy's journal files, then its derived files, then lose the files
//   the scratch copy does not hold; then a remake and a commit) -> delete the
//   marker (one file: a rename, so all or nothing) -> delete the scratch copy.
// The disk rule (`finishPendingApply`), at each start and at the start of each
// sync of the project:
//   scratch copy with the marker   -> an apply may have begun: run the same apply
//                                     again (it compares, then writes), delete
//                                     the marker, delete the scratch copy.
//                                     Any bytes at the marker path count: a torn
//                                     marker write may still have begun an apply.
//   scratch copy with no marker    -> delete it; the project did not change.
//   no scratch copy                -> nothing is pending.
// While the marker is there, the project takes no open (JournalingStore, one
// GET of the scratch copy's paths; a missing repository answers [] with HTTP 200
// [VERIFIED — pankosmia-web 0.18.15 (a83725b), live rig, 2026-10-14;
// `get_repo_file_paths.rs:32-33`]).
// Recovery only goes forward, and the apply never removes a journal file, so work
// saved in the project after the apply began stays: its derived files rebuild at
// the next open (the journal is ahead of them, so the open regenerates forward).
// The apply repairs a journal file that a stopped write left in part by writing
// it again: the ingredient POST replaces the whole file [VERIFIED — rig 0.18.15
// (a83725b), 2026-10-14: a write of "second" over "first bytes" reads back
// "second", and no .bak is made with `no_bak`].
// `recover()` runs the disk rule before it reads the settings document, so a
// settings read that fails never stops it. Before an open or a create, a store
// waits for the disk rule of the start recovery (`recoverySettled`), not for the
// settings read; an open that writes its own record here (`ops.begin`) still
// waits for that settings write. A store opens or creates only a project path
// (`_local_/_local_/<name>`): the fixed clone path of a sync is a listed
// repository for a moment, and the sync deletes it.
// The sync record in this log is only the Report for the dev Inspector; its
// `phase` fact says how far the sync got.
// A store opened before an apply is stale after it (JournalingStore): the sync
// moves the project's sync generation on before the first write to the project,
// and a store whose generation is older refuses every edit and checkpoint
// (`sync.project-replaced`).
// A settings document that does not parse (a write the platform stopped half way:
// `clients.rs` creates the file, then writes it) cannot lock anything, because no
// record in it can be read. `recover()` keeps its bytes under `unreadableSettings`,
// starts an empty ops log, and reports the incident; any other read failure fails
// closed after the disk rule (`opslog.not-loaded`: no sync starts).
import { Refusal, failedReport, isUnjournaledIngredient, okReport, type Report } from './runtime';
import type { ServerApi } from '../serverApi';
import { isNotFoundError } from '../serverApi';
import { readJournalZipOf } from './journalStore';
import { OPEN_MARKER, archiveNameOf, isReservedIngredient, openRunning, openScratchOf } from '../openCopyMarks';

/** The settings key that keeps the bytes of a settings document that did not parse. */
export const UNREADABLE_KEY = 'unreadableSettings';

export type OpsOp = Report['op'];

/** One record. Open while `report` is absent. */
export interface OpsEntry {
  id: string;
  op: OpsOp;
  startedAt: string;
  facts: Record<string, unknown>;
  report?: Report;
}

/** The key of the ops log in the client-settings document, and how many records it keeps. */
export const OPS_KEY = 'opsLog';
export const OPS_LIMIT = 50;

type SettingsDoc = Record<string, unknown>;
/** Apply `mutate` to the latest document and store the result. Rejects when the read or the write fails. */
export type SettingsWriter = (mutate: (doc: SettingsDoc) => SettingsDoc) => Promise<void>;

/** The one writer of the client-settings document: each mutation reads the
 * LATEST document and writes it back, in call order. A failure rejects that
 * call only; the calls after it still run. */
export function serialSettingsWriter(
  read: () => Promise<SettingsDoc>,
  write: (doc: SettingsDoc) => Promise<void>,
): SettingsWriter & { idle(): Promise<unknown>; replace(doc: SettingsDoc): Promise<void> } {
  let chain: Promise<unknown> = Promise.resolve();
  const queue = (step: () => Promise<void>): Promise<void> => {
    const run = chain.then(step);
    chain = run.catch(() => {});
    return run;
  };
  const update: SettingsWriter = (mutate) => queue(async () => {
    const doc = await read();
    await write(mutate(doc));
  });
  return Object.assign(update, {
    /** Settles when every write queued so far has settled. */
    idle: () => chain,
    /** #676: write a whole document with no read (a document that does not
     * parse), in the same queue as every update. */
    replace: (doc: SettingsDoc) => queue(() => write(doc)),
  });
}

export const opsEntriesOf = (doc: SettingsDoc | null | undefined): OpsEntry[] =>
  Array.isArray(doc?.[OPS_KEY]) ? (doc[OPS_KEY] as OpsEntry[]) : [];

/** The document with `entries` stored, oldest first; the oldest CLOSED records
 * go when the log is over its limit (an open record is never dropped). */
const withEntries = (doc: SettingsDoc, entries: OpsEntry[]): SettingsDoc => {
  const list = opsEntriesOf(doc).filter((e) => !entries.some((n) => n.id === e.id));
  list.push(...entries);
  while (list.length > OPS_LIMIT) {
    const i = list.findIndex((e) => e.report);
    if (i < 0) break;
    list.splice(i, 1);
  }
  return { ...doc, [OPS_KEY]: list };
};

/** The handle of one open record. Each call resolves `true` when the record was
 * saved and `false` when the write failed (the failure is reported, never thrown). */
export interface OpsHandle {
  /** Add facts before the next side effect (an import's repository path). */
  note(facts: Record<string, unknown>): Promise<boolean>;
  close(report: Report): Promise<boolean>;
}

/** What an operation needs to write its record. */
export interface OpsRecorder {
  begin(op: OpsOp, facts?: Record<string, unknown>): Promise<OpsHandle>;
  /** False until `recover()` loads the log at this start (#676: no sync before it). */
  readonly recovered?: boolean;
}

/** A failed ops write: which record, and why. */
export interface OpsWriteError {
  id: string;
  op: OpsOp;
  error: string;
  /** 'settings-unreadable': the settings document did not parse at this start (module header). */
  kind?: 'settings-unreadable';
}

export interface OpsLogInit {
  read: () => Promise<SettingsDoc>;
  update: SettingsWriter;
  now?: () => number;
  /** The raw text of the settings document, and a write that replaces it without
   * a read: for a document that does not parse (module header). */
  readText?: () => Promise<string>;
  replace?: (doc: SettingsDoc) => Promise<void>;
}

/** What recovery needs from the platform. */
export type OpsRecoveryApi = Pick<
  ServerApi,
  | 'listLocalRepos'
  | 'deleteRepo'
  | 'listPaths'
  | 'readIngredient'
  | 'readIngredientZipped'
  | 'writeIngredient'
  | 'deleteIngredient'
  | 'gitStatus'
  | 'remakeIngredients'
  | 'addAndCommit'
>;

/** What the open's disk recovery and gate need from the platform (#677). */
export type OpenRecoveryApi = OpsRecoveryApi & Pick<ServerApi, 'getMetadataRaw'>;

// ---- the sync apply (issue #676, G8; D101) --------------------------------------

/** The scratch copy of a project's sync. Under `_local_/_archive_/`, which
 * `list-local-repos` and the summaries skip (#673), so Home never lists it. */
export const scratchPathOf = (repoPath: string): string => `_local_/_archive_/tc4-sync--${archiveNameOf(repoPath)}`;

/** The apply marker (module header): an ingredient path inside the scratch copy.
 * The apply never writes it into the project and never removes it from there. */
export const APPLY_MARKER = 'tc4-sync/apply.json';
/** The reserved marker folders, `tc4-sync/` and `tc4-open/` (#677): one definition,
 * src/data/openCopyMarks.ts. The apply never writes or removes a file there. */
const isMarkerPath = isReservedIngredient;

/** The sync generation of each project in this process (module header): an
 * apply moves it on, and a store opened at an older one is stale. A restart
 * starts again at 0, and no store outlives a restart. */
const syncGenerations = new Map<string, number>();
export const syncGenerationOf = (repoPath: string): number => syncGenerations.get(repoPath) ?? 0;
export const nextSyncGeneration = (repoPath: string): void => {
  syncGenerations.set(repoPath, syncGenerationOf(repoPath) + 1);
};

// ---- the open from Door43 (issue #677) -----------------------------------------
// Safety comes from the DISK only. The client-settings document is written in
// place by many writers with no compare-and-swap, so a lost update or a torn read
// can regress or erase a record; the open record (`op: 'open-door43'`) is kept for
// the Report, the Inspector and one liveness hint (the clone path), never to decide
// whether a project is whole.
//
// The marker: one file, `ingredients/tc4-open/move.json` (OPEN_MARKER), in the
// scratch copy S of the project P. The platform copy copies the whole folder, so
// the marker travels to P. The open runs, in this order:
//   1. write the marker in S          (S is checked and complete; P is not there)
//   2. copy S to P                    (P now has the marker, unless the copy stopped
//                                      before it: the copy order is not known)
//   3. delete the marker in S         (the copy returned ok: P is whole)
//   4. delete the marker in P
//   5. delete S
// What the disk says, and what happens (`settleOpenCopy`):
//   S has the marker                  the copy is not proved finished. P, when it is
//                                     there, can be a part copy: delete P, then S. A P
//                                     that has no marker and whose metadata.json differs
//                                     from S's is not this open's copy: nothing is
//                                     deleted, and the open of P is refused.
//   S has no marker, P has it         the copy finished (step 3 ran): delete P's
//                                     marker, keep P, delete S.
//   neither has it                    P is a normal project. S is a stale scratch copy;
//                                     only recovery at start deletes it.
// Step 3 comes before step 4, so a stop after the copy goes forward, never back.
// The gate: before a project opens or syncs, `guardOpenCopy` reads the two listings.
// A marker means the copy is not finished: the gate settles it from the disk, then
// the project opens (forward), or the open refuses (`open-door43.removed`). While an
// open of P runs in this app, the gate refuses (`open-door43.pending`) and touches
// nothing. No project with a marker is ever opened, so no edit can be lost when a
// part copy is deleted. Edits need no gate: they run on an open store, and a marker
// can appear only by a copy to a path that is free, which an open store is not.
// A stale marked scratch copy never blocks a project made later at that path: every
// create goes through the platform's create routes, and those first delete the scratch
// copy for the path when no open of it runs here and no folder is at the path
// (ServerApi `clearStaleOpenScratch`).

/** The phases of an open from Door43, in order (the record only: a hint, not a safety input). */
export const OPEN_PHASES = ['start', 'clone', 'check', 'move.copy', 'move.delete-scratch'] as const;
export type OpenPhase = (typeof OPEN_PHASES)[number];

// The open's names and its running set live in src/data/openCopyMarks.ts (no imports), so
// the platform's create routes (serverApi.ts) can read them without a cycle.
export { archiveNameOf, openScratchOf, OPEN_MARKER, openRunning, forgetRunningOpens } from '../openCopyMarks';

/** What the disk says about a project's open from Door43, after `settleOpenCopy`. */
export type OpenCopyState = 'clear' | 'finished' | 'removed' | 'blocked' | 'running';

/** Is P this open's copy? Yes when P has no metadata.json yet (a part copy) or the
 * same one as S. A different one, or one that does not read, is not proved: no. */
async function isCopyOf(api: OpenRecoveryApi, scratch: string, repoPath: string): Promise<boolean> {
  let mine: unknown;
  try {
    mine = await api.getMetadataRaw(repoPath);
  } catch (error) {
    return isNotFoundError(error);
  }
  try {
    return JSON.stringify(await api.getMetadataRaw(scratch)) === JSON.stringify(mine);
  } catch {
    return false;
  }
}

/** Decide from the disk only (the open section above), and do what it says. A read
 * that fails throws: it never counts as "no marker". With `cleanStale`, a scratch
 * copy with no marker is deleted too (recovery at start, when no open runs). */
export async function settleOpenCopy(api: OpenRecoveryApi, repoPath: string, cleanStale = false): Promise<OpenCopyState> {
  const scratch = openScratchOf(repoPath);
  const inScratch = (await api.listPaths(scratch)).includes(OPEN_MARKER);
  const projectPaths = await api.listPaths(repoPath);
  const inProject = projectPaths.includes(OPEN_MARKER);
  if (!inScratch && !inProject) {
    if (cleanStale && !openRunning.has(repoPath)) await deleteIfPresent(api, scratch);
    return 'clear';
  }
  if (openRunning.has(repoPath)) return 'running';
  if (inScratch) {
    if (projectPaths.length > 0 && !inProject && !(await isCopyOf(api, scratch, repoPath))) return 'blocked';
    const there = projectPaths.length > 0 || (await api.listLocalRepos()).includes(repoPath);
    await deleteIfPresent(api, repoPath);
    await deleteIfPresent(api, scratch);
    return there ? 'removed' : 'clear';
  }
  await deleteIngredientIfPresent(api, repoPath, OPEN_MARKER);
  await deleteIfPresent(api, scratch);
  return 'finished';
}

/** The gate before a project opens or syncs (the open section above). */
export async function guardOpenCopy(api: OpenRecoveryApi, repoPath: string): Promise<void> {
  const state = await settleOpenCopy(api, repoPath);
  if (state === 'removed')
    throw new Refusal('open-door43.removed', `the open from Door43 of ${repoPath} did not finish; its part copy was removed`, { repoPath });
  if (state === 'running' || state === 'blocked')
    throw new Refusal('open-door43.pending', `the open from Door43 of ${repoPath} did not finish (${state})`, { repoPath, state });
}

/** Delete a repository; a repository that is not there is not an error. The
 * platform answers a delete of a missing repository with HTTP 400 "could not
 * delete repo: No such file or directory (os error 2)", which `isNotFound`
 * matches [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-09-29), rig
 * 2026-10-13; docs/evidence/sync-transport-spike-2026-10-13.md run 7]. */
export const deleteIfPresent = async (api: Pick<OpsRecoveryApi, 'deleteRepo'>, repoPath: string): Promise<void> => {
  try {
    await api.deleteRepo(repoPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
};

const JOURNAL_PREFIX = 'checking/journal/';
const isJournalPath = (ipath: string): boolean => ipath.startsWith(JOURNAL_PREFIX);
/** The tree an apply makes equal: every ingredient but `audio/`. Round 1 never
 * reads or writes the one class that can be binary (R-8.7.3), so a teammate's
 * audio does not reach this project, and own audio stays where it is. */
const inApplyTree = (ipath: string): boolean => !isUnjournaledIngredient(ipath) && !isMarkerPath(ipath);

/** Each ingredient file of `repoPath` that `keep` keeps, by ingredient path: the
 * journal in one zipped read (else one read per file), the rest one read per
 * file. Every file read here is text (R-8.7.1; audio is never read). */
export async function readIngredientFiles(
  api: Pick<OpsRecoveryApi, 'listPaths' | 'readIngredient' | 'readIngredientZipped'>,
  repoPath: string,
  keep: (ipath: string) => boolean,
): Promise<Map<string, string>> {
  const paths = (await api.listPaths(repoPath)).filter((p) => keep(p) && inApplyTree(p)).sort();
  const zip = paths.some(isJournalPath) ? await readJournalZipOf(api, repoPath) : null;
  const files = new Map<string, string>();
  for (const ipath of paths) files.set(ipath, zip?.get(ipath) ?? (await api.readIngredient(repoPath, ipath)));
  return files;
}

/** The platform's answer to a delete of an ingredient that is not there: HTTP 400
 * "No such file: <path>" (pankosmia-web a83725b `post_delete_ingredient.rs:32-36`). */
const isIngredientGone = (error: unknown): boolean => {
  const failure = error as { status?: number; reason?: string } | null;
  return failure?.status === 400 && /^No such file/.test(failure.reason ?? '');
};

const FLAGS = { updateIngredients: false, keepBak: false } as const;

/** The disk rule of the start recovery that runs now, settled when that rule
 * ends, either way (#676); the settings read after it does not count. A store
 * waits for it before an open or a create, so neither races the disk rule.
 * Before the first recovery it is already settled. */
let recovering: Promise<void> = Promise.resolve();
export const recoverySettled = (): Promise<void> => recovering;

/** True while the scratch copy of `repoPath` holds the apply marker (module header). */
export const isApplyPending = async (api: Pick<OpsRecoveryApi, 'listPaths'>, repoPath: string): Promise<boolean> =>
  (await api.listPaths(scratchPathOf(repoPath))).includes(APPLY_MARKER);

/** The disk rule (module header): finish an apply that the marker says may have
 * begun, or delete a scratch copy that has no marker. Safe to run again. */
export async function finishPendingApply(api: OpsRecoveryApi, repoPath: string): Promise<'applied' | 'deleted' | 'none'> {
  const scratch = scratchPathOf(repoPath);
  const paths = await api.listPaths(scratch);
  if (paths.includes(APPLY_MARKER)) {
    nextSyncGeneration(repoPath);
    await applyScratch(api, repoPath, scratch);
    await deleteIngredientIfPresent(api, scratch, APPLY_MARKER);
    await deleteIfPresent(api, scratch);
    return 'applied';
  }
  if (!paths.length) return 'none';
  await deleteIfPresent(api, scratch);
  return 'deleted';
}

/** Delete one ingredient; one that is not there is not an error. */
export const deleteIngredientIfPresent = async (api: Pick<OpsRecoveryApi, 'deleteIngredient'>, repoPath: string, ipath: string): Promise<void> => {
  try {
    await api.deleteIngredient(repoPath, ipath);
  } catch (error) {
    if (!isIngredientGone(error)) throw error;
  }
};

/** Delete every file in the reserved marker folders (`isReservedIngredient`) of
 * `repoPath`. A clone of Door43 content runs this at the fixed clone path before the
 * move (#677, as #676 deletes APPLY_MARKER there), so a marker that came with Door43
 * never reaches a scratch copy or a project. */
export const deleteReservedIngredients = async (api: Pick<OpsRecoveryApi, 'listPaths' | 'deleteIngredient'>, repoPath: string): Promise<void> => {
  for (const ipath of (await api.listPaths(repoPath)).filter(isReservedIngredient)) await deleteIngredientIfPresent(api, repoPath, ipath);
};

/** The apply (module header): make the project's `ingredients/`, except
 * `audio/`, equal to the scratch copy's. Journal files first (a journal file
 * never changes, R-8.1.4, so a different one is written again only when a stopped
 * write left it in part), derived files next, removes last (never a journal
 * file); then a remake and a commit. Safe to run again. */
export async function applyScratch(api: OpsRecoveryApi, repoPath: string, scratch: string): Promise<{ written: number; removed: number }> {
  const target = await readIngredientFiles(api, scratch, () => true);
  const livePaths = (await api.listPaths(repoPath)).filter(inApplyTree);
  const live = await readIngredientFiles(api, repoPath, isJournalPath);
  let written = 0;
  const write = async (ipath: string, bytes: string): Promise<void> => {
    await api.writeIngredient(repoPath, ipath, bytes, FLAGS);
    written += 1;
  };
  for (const [ipath, bytes] of target) if (isJournalPath(ipath) && live.get(ipath) !== bytes) await write(ipath, bytes);
  const present = new Set(livePaths);
  for (const [ipath, bytes] of target)
    if (!isJournalPath(ipath) && (!present.has(ipath) || (await api.readIngredient(repoPath, ipath)) !== bytes)) await write(ipath, bytes);
  let removed = 0;
  for (const ipath of livePaths) {
    if (isJournalPath(ipath) || target.has(ipath)) continue;
    await deleteIngredientIfPresent(api, repoPath, ipath);
    removed += 1;
  }
  if ((await api.gitStatus(repoPath)).length) {
    await api.remakeIngredients(repoPath);
    await api.addAndCommit(repoPath, 'Sync with Door43 (tC4)');
  }
  return { written, removed };
}

export class OpsLog implements OpsRecorder {
  /** The records this session knows, oldest first — including any whose write failed. */
  entries: OpsEntry[] = [];
  /** Every failed ops write. A failure is kept here and announced, never dropped. */
  errors: OpsWriteError[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly read: OpsLogInit['read'];
  private readonly update: SettingsWriter;
  private readonly now: () => number;
  private seq = 0;

  constructor(init: OpsLogInit) {
    this.read = init.read;
    this.update = init.update;
    this.now = init.now ?? (() => Date.now());
    this.readText = init.readText ?? null;
    this.replace = init.replace ?? null;
  }

  private readonly readText: (() => Promise<string>) | null;
  private readonly replace: ((doc: SettingsDoc) => Promise<void>) | null;

  /** True after `recover()` loaded the log at this start. */
  recovered = false;


  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async begin(op: OpsOp, facts: Record<string, unknown> = {}): Promise<OpsHandle> {
    const startedAt = new Date(this.now()).toISOString();
    const entry: OpsEntry = { id: `${startedAt}#${(this.seq += 1)}`, op, startedAt, facts: { ...facts } };
    await this.put(entry);
    return {
      note: (more) => this.put({ ...this.current(entry.id), facts: { ...this.current(entry.id).facts, ...more } }),
      close: (report) => this.put({ ...this.current(entry.id), report }),
    };
  }

  /** Resolve every record a killed operation left open, and load the log.
   * Run once, when the app starts, before any operation begins. */
  recover(api: OpsRecoveryApi): Promise<OpsEntry[]> {
    let settle = (): void => {};
    recovering = new Promise<void>((resolve) => (settle = resolve));
    const run = this.recoverOnce(api, () => settle());
    run.then(settle, settle);
    return run;
  }

  /** The disk rule for each repository at any path (a project opened from Door43
   * can be outside `_local_/_local_/`). The platform lists no `_local_/_archive_/`
   * folder (list_local_repos.rs, pankosmia-web a83725b), so the scan goes from
   * each repository to its scratch copy: one GET each, and a missing scratch copy
   * answers [] with HTTP 200. Returns the failure of the list, or null. */
  private async runDiskRule(api: OpsRecoveryApi): Promise<unknown> {
    this.applied = new Set();
    let repos: string[];
    try {
      repos = await api.listLocalRepos();
    } catch (error) {
      return error;
    }
    for (const repoPath of repos) {
      try {
        if ((await finishPendingApply(api, repoPath)) === 'applied') this.applied.add(repoPath);
      } catch (error) {
        const failure = { id: `apply:${repoPath}`, op: 'sync' as OpsOp, error: `the pending apply of ${repoPath} did not finish: ${String((error as Error)?.message ?? error)}` };
        this.errors = [...this.errors, failure];
        console.error(`ops log: ${failure.error}`);
      }
    }
    return null;
  }

  private async recoverOnce(api: OpsRecoveryApi, diskRuleDone: () => void): Promise<OpsEntry[]> {
    // The disk rule first, before the settings read: the settings document never
    // decides it, and a settings read that fails never stops it. Opens and creates
    // wait only for the disk rule (`recoverySettled`): a settings read that never
    // answers holds none of them. A failed repo list settles the gate too: the
    // marker check of each open still refuses a pending apply.
    let listFailure: unknown;
    try {
      listFailure = await this.runDiskRule(api);
    } finally {
      diskRuleDone();
    }
    const doc = await this.readOrSetAside();
    // no list, no disk rule: the log does not load (fail closed; a sync refuses)
    if (listFailure) throw listFailure;
    const resolved: OpsEntry[] = [];
    for (const entry of opsEntriesOf(doc)) {
      // A record this session began is running, not interrupted.
      if (entry.report || this.entries.some((e) => e.id === entry.id)) continue;
      // One record that cannot be resolved never stops the others: it stays
      // open and is reported.
      try {
        resolved.push({ ...entry, report: await this.resolve(entry, api) });
      } catch (error) {
        const failure = { id: entry.id, op: entry.op, error: `recovery failed: ${String((error as Error)?.message ?? error)}` };
        this.errors = [...this.errors, failure];
        console.error(`ops log: the ${entry.op} record was not recovered: ${failure.error}`);
      }
    }
    if (resolved.length) await this.update((latest) => withEntries(latest, resolved));
    this.entries = withEntries(doc, resolved)[OPS_KEY] as OpsEntry[];
    this.recovered = true;
    this.notify();
    return resolved;
  }

  private async resolve(entry: OpsEntry, api: OpsRecoveryApi): Promise<Report> {
    const endedAt = new Date(this.now()).toISOString();
    const facts = { ...entry.facts, interrupted: true };
    if (entry.op === 'import') {
      const repoPath = typeof entry.facts.repoPath === 'string' ? entry.facts.repoPath : null;
      if (repoPath && (await api.listLocalRepos()).includes(repoPath)) {
        await api.deleteRepo(repoPath);
        return failedReport('import', entry.startedAt, endedAt,
          new Refusal('import.write-failed', 'the import was interrupted; the partly written project was removed', { repoPath }),
          { ...facts, rolledBack: true });
      }
      return failedReport('import', entry.startedAt, endedAt, new Error('the import was interrupted before it created a project'), facts);
    }
    if (entry.op === 'export')
      return failedReport('export', entry.startedAt, endedAt, new Error('the export was interrupted; no file was delivered'), facts);
    if (entry.op === 'sync') return this.resolveSync(entry, api, endedAt);
    if (entry.op === 'open-door43') return this.resolveOpen(entry, api, endedAt);
    return failedReport(entry.op, entry.startedAt, endedAt,
      new Error(`the ${entry.op} was interrupted; the journal replays its staged actions at the next open of the project`), facts);
  }

  /** The projects whose pending apply this start finished (the disk rule). */
  private applied = new Set<string>();

  /** The Report of an interrupted sync. The disk rule has already run: a scratch
   * copy left now has no marker, so it goes, with a fixed clone path that the
   * record names. */
  private async resolveSync(entry: OpsEntry, api: OpsRecoveryApi, endedAt: string): Promise<Report> {
    const facts = { ...entry.facts, interrupted: true };
    const { phase, repoPath, clonePath } = entry.facts;
    if (typeof repoPath !== 'string')
      return failedReport('sync', entry.startedAt, endedAt, new Error('the sync was interrupted before it named its project'), facts);
    if (phase === 'clone' && typeof clonePath === 'string') await deleteIfPresent(api, clonePath);
    await finishPendingApply(api, repoPath);
    if (this.applied.has(repoPath)) return okReport('sync', entry.startedAt, endedAt, { ...facts, finishedApply: true });
    // The record is not a lock: at `apply`, the push is done and the marker (gone
    // now) decided. No apply is pending, so the sync is over: the apply ended (its
    // marker was deleted), or the stop came before the marker write, and then the
    // next sync brings Door43 main, which has the work, to the project.
    if (phase === 'apply') return okReport('sync', entry.startedAt, endedAt, { ...facts, applyPending: false });
    return failedReport('sync', entry.startedAt, endedAt,
      new Error('the sync was interrupted before the apply; the project did not change'), { ...facts, rolledBack: true });
  }

  /** The settings document; one that does not parse is kept under
   * `UNREADABLE_KEY` and replaced by an empty ops log (module header). Any other
   * failure throws: the log did not load. */
  private async readOrSetAside(): Promise<SettingsDoc> {
    try {
      return await this.read();
    } catch (error) {
      if (!(error instanceof SyntaxError) || !this.readText || !this.replace) throw error;
      const doc: SettingsDoc = { [UNREADABLE_KEY]: [{ at: new Date(this.now()).toISOString(), bytes: await this.readText() }] };
      await this.replace(doc);
      const failure: OpsWriteError = { id: 'settings', op: 'open', error: String(error.message), kind: 'settings-unreadable' };
      this.errors = [...this.errors, failure];
      console.error(`ops log: the settings document did not parse; its bytes are kept under ${UNREADABLE_KEY}: ${failure.error}`);
      return doc;
    }
  }

  /** The recovery rule of an interrupted open from Door43 (the open section above). */
  private async resolveOpen(entry: OpsEntry, api: OpsRecoveryApi, endedAt: string): Promise<Report> {
    const facts = { ...entry.facts, interrupted: true };
    const { phase, repoPath, clonePath } = entry.facts;
    if (typeof repoPath !== 'string')
      return failedReport('open-door43', entry.startedAt, endedAt, new Error('the open was interrupted before it named its project'), facts);
    // A liveness hint only: a clone that the record names, left by a stop in the clone
    // window. cloneProject proved the path absent before it saved this phase.
    if (phase === 'clone' && typeof clonePath === 'string') await deleteIfPresent(api, clonePath);
    // Safety: the disk decides (the open section above). A project that is not this
    // open's copy stays, and its record stays open (the throw), so it is reported.
    if (!(api as Partial<OpenRecoveryApi>).getMetadataRaw) throw new Error('the open recovery needs getMetadataRaw');
    const state = await settleOpenCopy(api as OpenRecoveryApi, repoPath, true);
    if (state === 'blocked') throw new Error(`a marked scratch copy for ${repoPath} and a project that is not its copy: nothing was deleted`);
    const kept = state === 'finished' || (state === 'clear' && String(phase).startsWith('move.') && (await api.listLocalRepos()).includes(repoPath));
    if (kept) return okReport('open-door43', entry.startedAt, endedAt, { ...facts, finishedMove: true });
    return failedReport('open-door43', entry.startedAt, endedAt,
      new Error('the open from Door43 was interrupted; no project was kept'), { ...facts, rolledBack: true });
  }

  private current(id: string): OpsEntry {
    return this.entries.find((e) => e.id === id) as OpsEntry;
  }

  /** `true` when the record was saved. */
  private async put(entry: OpsEntry): Promise<boolean> {
    this.entries = withEntries({ [OPS_KEY]: this.entries }, [entry])[OPS_KEY] as OpsEntry[];
    this.notify();
    try {
      await this.update((doc) => withEntries(doc, [entry]));
      return true;
    } catch (error) {
      const failure = { id: entry.id, op: entry.op, error: String((error as Error)?.message ?? error) };
      this.errors = [...this.errors, failure];
      console.error(`ops log: the ${entry.op} record was not saved: ${failure.error}`);
      this.notify();
      return false;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
