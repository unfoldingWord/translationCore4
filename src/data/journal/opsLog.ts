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
// The sync record (issue #676, G8) names its phase in `facts.phase`. The sync
// writes the phase BEFORE the step that the phase names, so the saved phase is
// the step that was running, or the step after it. Three folders take part:
// the project `repoPath`, the `scratch` copy (built and pushed), and the
// `previous` copy (`_local_/_archive_/`, so Home never lists either copy).
// A copy is a copy and a delete on the server, never one rename (#673), so the
// swap uses four separate calls. Each phase and its recovery rule:
//   clone                the fixed clone path and the scratch copy are being made.
//                        Recovery: delete both. The project did not change.
//   sync, push           the scratch copy is complete; the project did not change.
//                        Recovery: delete the scratch copy. (A push that Door43
//                        accepted is not lost: own work is in the project and on
//                        Door43, and the next sync gets it.)
//   swap.copy-previous   copy the project to `previous`.       Recovery: resume here.
//   swap.delete-project  delete the project.                   Recovery: resume here.
//   swap.copy-live       copy `scratch` to the project path.   Recovery: resume here.
//   swap.delete-scratch  delete `scratch`.                     Recovery: resume here.
//   live                 the copy is live; the outbox entries it carried are being
//                        cleared. Recovery: nothing. The next open replays any entry
//                        that is left: its bytes are at its path, so the replay
//                        clears it ('already-published').
// The rule for the direction: a recovery goes forward ONLY when nothing can
// have changed the live project since the phase was saved. The sync holds the
// project's queue for its whole run, so in the same run that is true. A server
// failure in the swap is handled in that run (syncOperation.ts): at
// swap.copy-previous the live project is still whole, so the sync goes back now
// (it deletes the scratch and previous copies and closes its record failed); at a
// later phase it runs the rest of the swap once more. Only when that also fails
// does the record stay open, and then the project cannot open, take an edit or
// start a sync (`sync.swap-pending`) until `recover()` at the next start.
// A start where `recover()` fails to load the log cannot see an open record, so
// the translator can open and change the project then. Two rules close that gap:
//   - no sync starts, and no project opens or takes an edit, until `recover()`
//     loads the log at this start (`opslog.not-loaded`, syncOperation.ts and
//     JournalingStore.refusePendingSwap). The app runs `recover()` once, at
//     boot (state.jsx); a restart loads the log again;
//   - the live mark: at swap.copy-previous the sync saves `liveMark`, the greatest
//     journal segment name in the live project. Each change writes a new segment,
//     and its name is greater than every segment that the writer saw (R-8.2.4); a
//     part delete only removes names. At swap.copy-previous or
//     swap.delete-project, when the live project is there and holds a greater
//     name, someone changed it after the swap began: recovery goes back (it
//     deletes the scratch copy, keeps the live project, and closes the record
//     failed, `sync.move-failed`). Otherwise it goes forward with the scratch
//     copy, which is pushed and complete.
// Each swap step is safe to run again when the
// step after it has not run: it first deletes the target that a stopped copy
// can leave in part. Two kill sweeps in test/sync/syncOperation.test.ts prove
// this: a kill after each server call, and a kill inside each one (the server
// stops with a part copy or a part delete). Recovery saves each phase before
// its step, like the sync.
import { Refusal, failedReport, okReport, type Report } from './runtime';
import { isNotFoundError } from '../serverApi';
import { idbKvStore, type KvStore } from './identity';

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
): SettingsWriter & { idle(): Promise<unknown> } {
  let chain: Promise<unknown> = Promise.resolve();
  const update: SettingsWriter = (mutate) => {
    const run = chain.then(async () => {
      const doc = await read();
      await write(mutate(doc));
    });
    chain = run.catch(() => {});
    return run;
  };
  /** Settles when every write queued so far has settled. */
  return Object.assign(update, { idle: () => chain });
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
  /** True while a record of `op` for `repoPath` is open (#676: an unfinished sync
   * swap), and, when `phase` is given, its saved phase is `phase` (#677). */
  isOpen?(op: OpsOp, repoPath: string, phase?: string): boolean;
  /** False until `recover()` loads the log at this start (#676: no sync before it). */
  readonly recovered?: boolean;
}

/** A failed ops write: which record, and why. */
export interface OpsWriteError {
  id: string;
  op: OpsOp;
  error: string;
}

export interface OpsLogInit {
  read: () => Promise<SettingsDoc>;
  update: SettingsWriter;
  now?: () => number;
  /** The installation store, where a recovered sync records its previous copy. Default: the shared IndexedDB store. */
  kv?: KvStore;
}

/** What recovery needs from the platform. */
export interface OpsRecoveryApi {
  listLocalRepos(): Promise<string[]>;
  deleteRepo(repoPath: string): Promise<void>;
  copyRepo(src: string, target: string, deleteSrc?: boolean): Promise<void>;
  listPaths(repoPath: string): Promise<string[]>;
}

/** The live mark (module header): the greatest journal segment name in a path listing, or ''. */
export const lastSegmentName = (paths: string[]): string => {
  let last = '';
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length === 5 && parts[0] === 'checking' && parts[1] === 'journal' && parts[3] === 'segments' && parts[4] > last) last = parts[4];
  }
  return last;
};

// ---- the sync swap (issue #676, G8) -------------------------------------------

/** The swap phases, in order. See the module header for each recovery rule. */
export const SWAP_PHASES = ['swap.copy-previous', 'swap.delete-project', 'swap.copy-live', 'swap.delete-scratch'] as const;
export type SwapPhase = (typeof SWAP_PHASES)[number];
export const isSwapPhase = (phase: unknown): phase is SwapPhase => SWAP_PHASES.includes(phase as SwapPhase);

export interface SwapPaths {
  repoPath: string;
  scratch: string;
  previous: string;
}

/** The scratch copy and the previous copy of a project. Under `_local_/_archive_/`,
 * which `list-local-repos` and the summaries skip (#673), so Home never lists them. */
export const syncPathsOf = (repoPath: string): SwapPaths => {
  const name = repoPath.split('/')[2];
  return { repoPath, scratch: `_local_/_archive_/tc4-sync--${name}`, previous: `_local_/_archive_/tc4-previous--${name}` };
};

// ---- the open from Door43 (issue #677) -----------------------------------------
// The open record (`op: 'open-door43'`) names its phase in `facts.phase`, saved
// BEFORE the step it names, like the sync. Three folders take part: the fixed
// clone path `clonePath`, the `scratch` copy (`_local_/_archive_/`, never listed),
// and the new project `repoPath`, which was not there when the open began. The
// recovery rule of each phase:
//   start                delete a stale scratch copy.     Recovery: delete the scratch copy.
//   clone                clone, then move to scratch.     Recovery: delete the clone path
//                        (cloneProject proved it absent before this phase, so it is the
//                        open's) and the scratch copy.
//   check                read and check the copy.         Recovery: delete the scratch copy.
//   move.copy            copy scratch to the project.     The phase also saves `targetAbsent`
//                        (the open checked that no project was at the path) and `liveMark`
//                        (the greatest segment name of the copy). Recovery decides by the
//                        scratch copy, because the open deletes it only after the copy
//                        finished: when it is gone, the project is whole and stays (ok). When
//                        it is there, the project can be a part copy: recovery deletes the
//                        project and the scratch copy, unless the project holds a segment
//                        newer than `liveMark` (someone changed it, so it opened whole: it
//                        stays). Without `targetAbsent`, the project is never deleted.
//   move.delete-scratch  the project is complete.        Recovery: delete the scratch copy;
//                        the project stays, and the record closes ok.
// The rule: the project stays when its copy finished, and a project that was there
// before the open is never deleted. The move is two calls (a copy, then a delete),
// not the platform's copy-and-delete in one call, so the scratch copy tells which
// side of the copy the stop was on. While a record is open at `move.copy`, the
// project takes no open and no edit (`open-door43.pending`, JournalingStore), so no
// change can be lost when recovery deletes a part copy. A cleanup that fails in the
// open leaves the record open, and the next start runs it again.

/** The phases of an open from Door43, in order. */
export const OPEN_PHASES = ['start', 'clone', 'check', 'move.copy', 'move.delete-scratch'] as const;
export type OpenPhase = (typeof OPEN_PHASES)[number];

/** The scratch copy of an open from Door43. Under `_local_/_archive_/`, so Home never lists it. */
export const openPathsOf = (repoPath: string): { repoPath: string; scratch: string } => ({
  repoPath,
  scratch: `_local_/_archive_/tc4-open--${repoPath.split('/')[2]}`,
});

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

/** Run the swap from `from` to its end. `note` saves a phase BEFORE its step and
 * answers whether it was saved; a phase that is not saved stops the swap before
 * its step, so the saved phase never lags behind the folders. */
export async function runSwap(
  api: Pick<OpsRecoveryApi, 'deleteRepo' | 'copyRepo'>,
  paths: SwapPaths,
  from: SwapPhase,
  note: (phase: SwapPhase) => Promise<boolean>,
): Promise<void> {
  const { repoPath, scratch, previous } = paths;
  const steps: Record<SwapPhase, () => Promise<void>> = {
    'swap.copy-previous': async () => {
      await deleteIfPresent(api, previous);
      await api.copyRepo(repoPath, previous);
    },
    'swap.delete-project': () => deleteIfPresent(api, repoPath),
    'swap.copy-live': async () => {
      await deleteIfPresent(api, repoPath);
      await api.copyRepo(scratch, repoPath);
    },
    'swap.delete-scratch': () => deleteIfPresent(api, scratch),
  };
  for (const phase of SWAP_PHASES.slice(SWAP_PHASES.indexOf(from))) {
    if (!(await note(phase))) throw new Error(`the ops log did not save the phase ${phase}; the swap stopped before it`);
    await steps[phase]();
  }
}

/** The installation-store key that names the previous copy of a project after a sync. */
export const previousCopyKey = (repoPath: string): string => `sync-previous:${repoPath}`;

/** Delete the previous copy that a sync left (issue #676), if there is one.
 * The checkpoint calls this after each successful save of the live project. */
export const deletePreviousCopy = async (
  api: Pick<OpsRecoveryApi, 'deleteRepo'>,
  kv: KvStore,
  repoPath: string,
): Promise<void> => {
  const previous = await kv.get(previousCopyKey(repoPath));
  if (previous === undefined) return;
  await deleteIfPresent(api, previous);
  await kv.delete(previousCopyKey(repoPath));
};

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
    this.kv = init.kv ?? null;
  }

  private readonly kv: KvStore | null;
  /** True after `recover()` loaded the log at this start. */
  recovered = false;

  isOpen(op: OpsOp, repoPath: string, phase?: string): boolean {
    return this.entries.some((e) => e.op === op && !e.report && e.facts.repoPath === repoPath && (phase === undefined || e.facts.phase === phase));
  }

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
  async recover(api: OpsRecoveryApi): Promise<OpsEntry[]> {
    const doc = await this.read();
    const resolved: OpsEntry[] = [];
    for (const entry of opsEntriesOf(doc)) {
      // A record this session began is running, not interrupted.
      if (entry.report || this.entries.some((e) => e.id === entry.id)) continue;
      // One record that cannot be resolved never stops the others: it stays
      // open (a sync swap then blocks its project) and is reported.
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

  /** The recovery rule of an interrupted sync (module header, G8). */
  private async resolveSync(entry: OpsEntry, api: OpsRecoveryApi, endedAt: string): Promise<Report> {
    const facts = { ...entry.facts, interrupted: true };
    const { phase, repoPath, clonePath } = entry.facts;
    if (typeof repoPath !== 'string')
      return failedReport('sync', entry.startedAt, endedAt, new Error('the sync was interrupted before it named its project'), facts);
    const paths = syncPathsOf(repoPath);
    if ((phase === 'swap.copy-previous' || phase === 'swap.delete-project') && typeof entry.facts.liveMark === 'string'
      && (await api.listLocalRepos()).includes(repoPath)
      && lastSegmentName(await api.listPaths(repoPath)) > entry.facts.liveMark) {
      // the live project changed after the swap began: go back and keep it
      await deleteIfPresent(api, paths.scratch);
      // at swap.delete-project the previous copy may hold files that a part delete
      // removed from the live project, so it stays (and no checkpoint deletes it)
      if (phase === 'swap.copy-previous') await deleteIfPresent(api, paths.previous);
      return failedReport('sync', entry.startedAt, endedAt,
        new Refusal('sync.move-failed', 'the project changed after the swap began; the sync went back and kept the project'),
        { ...facts, wentBack: true });
    }
    if (isSwapPhase(phase)) {
      let saved = entry;
      await runSwap(api, paths, phase, async (next) => {
        saved = { ...saved, facts: { ...saved.facts, phase: next } };
        await this.update((doc) => withEntries(doc, [saved]));
        return true;
      });
      // the next successful checkpoint deletes the previous copy, as after a sync that ran to its end
      await (this.kv ?? idbKvStore()).set(previousCopyKey(repoPath), paths.previous);
      return okReport('sync', entry.startedAt, endedAt, { ...facts, phase: 'live', finishedSwap: true });
    }
    if (phase === 'live') return okReport('sync', entry.startedAt, endedAt, facts);
    if (phase === 'clone' && typeof clonePath === 'string') await deleteIfPresent(api, clonePath);
    await deleteIfPresent(api, paths.scratch);
    return failedReport('sync', entry.startedAt, endedAt,
      new Error('the sync was interrupted before the swap; the project did not change'), { ...facts, rolledBack: true });
  }

  /** The recovery rule of an interrupted open from Door43 (the open section above). */
  private async resolveOpen(entry: OpsEntry, api: OpsRecoveryApi, endedAt: string): Promise<Report> {
    const facts = { ...entry.facts, interrupted: true };
    const { phase, repoPath, clonePath } = entry.facts;
    if (typeof repoPath !== 'string')
      return failedReport('open-door43', entry.startedAt, endedAt, new Error('the open was interrupted before it named its project'), facts);
    const { scratch } = openPathsOf(repoPath);
    if (phase === 'move.delete-scratch') {
      await deleteIfPresent(api, scratch);
      return okReport('open-door43', entry.startedAt, endedAt, { ...facts, finishedMove: true });
    }
    if (phase === 'move.copy' && entry.facts.targetAbsent === true && (await this.openCopyFinished(entry, api, scratch, repoPath))) {
      await deleteIfPresent(api, scratch);
      return okReport('open-door43', entry.startedAt, endedAt, { ...facts, finishedMove: true });
    }
    if (phase === 'clone' && typeof clonePath === 'string') await deleteIfPresent(api, clonePath);
    // a project that was there before the open is never the open's to delete
    if (phase === 'move.copy' && entry.facts.targetAbsent === true) await deleteIfPresent(api, repoPath);
    await deleteIfPresent(api, scratch);
    return failedReport('open-door43', entry.startedAt, endedAt,
      new Error('the open from Door43 was interrupted; no project was kept'), { ...facts, rolledBack: true });
  }

  /** At `move.copy`: is the project at `repoPath` whole? Yes when the scratch copy
   * is gone (the open deletes it only after the copy finished), or when the project
   * holds a journal segment newer than the copy's `liveMark` (someone changed it
   * after the copy, so it opened whole). A missing repository lists as `[]`
   * [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-09-29), live rig 2026-10-13]. */
  private async openCopyFinished(entry: OpsEntry, api: OpsRecoveryApi, scratch: string, repoPath: string): Promise<boolean> {
    if ((await api.listPaths(scratch)).length === 0) return true;
    const mark = typeof entry.facts.liveMark === 'string' ? entry.facts.liveMark : null;
    return mark !== null && lastSegmentName(await api.listPaths(repoPath)) > mark;
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
