// The sync shell (issue #676; layer 3 of epic #24, D98, D101). The thin part that
// touches the server, beside the share operation. One sync of one project:
//
//   1. checks: a Door43 username and token (`sync.auth-failed`, before any
//      request), the internet gate (`sync.offline`, D95), and an `origin` on the
//      Door43 server (`sync.not-shared`), and a project that is not at the fixed
//      clone path (`sync.clone-path-exists`).
//   2. get a full copy of Door43 `main` into the scratch copy: a clone to the
//      fixed path, then a move (#673, `cloneProject`), under the lock of that
//      path (`withClonePath`). A folder at the path is a clone that a kill left
//      there, and the clone deletes it first.
//   3. the name action (R-8.5.25): when this actor has no `actor.name.set` in
//      its journal, its outbox or on Door43 main, the app writer seals one with
//      the Door43 username only (`JournalStore.sealName`). It goes in as an
//      outbox entry of this sync, so a refused sync changes nothing.
//   4. `syncCore` (#675) with the file maps, the outbox, `resolve` over the
//      installed resources, and the app validator (seal.ts). A refusal deletes
//      the scratch copy and stops.
//   5. write `write`, delete `remove`, commit, then `verifyProjectAgainstJournal`
//      on the scratch copy (`sync.verify-failed`).
//   6. push. Not a fast-forward: start again at step 2; after three tries stop
//      with `sync.non-fast-forward` (G4). Never a force push: the platform push
//      has no force form.
//   7. the apply (G8, D101): write the apply marker into the scratch copy, move
//      the project's sync generation on (a store opened before it is stale), and
//      `applyScratch` makes the project's `ingredients/`, except `audio/`, equal
//      to the pushed scratch copy: journal files, then derived files, then
//      removes, then a remake and a commit. The project stays at its path, so it
//      keeps its actor id (G5: the id is HMAC(secret, repoPath), identity.ts).
//      src/data/journal/opsLog.ts gives the disk rule that finishes a stopped apply.
//   8. delete the marker, clear the outbox entries the sync carried, delete the
//      scratch copy, and close the ops record with the Report (`op: 'sync'`).
// Before step 2, a sync finishes an apply that the marker says may have begun.
//
// The sync holds the project's mutation queue for its whole run, so no save of
// the open store lands between the read of the journal and the apply. After an
// ok sync the caller MUST open the project again: the open store's fold is the
// old one (#678).
//
// Audio: round 1 never reads or writes `ingredients/audio/` (the one class that
// can be binary, R-8.7.3). A teammate's audio does not reach this project, and
// own audio stays where it is (D101).
//
// The HTTPS answer for a refused token is recorded: HTTP 500 with
// `code=Auth (-16)` (docs/evidence/sync-transport-spike-2026-10-13.md, owner run
// step 3), matched on the code, not on the text. The answer for no write access
// (403) is [PENDING — the owner's run on the Door43 QA server, #710];
// until then `refusalForPush` maps it by the HTTP status in the reason text.
import { checkpointMessage } from '../checkpoint';
import { Refusal, checkJournalFile, failedReport, isObsMetadata, okReport, projectResources, syncCore, type Report } from '../journal/runtime';
import { JournalStore } from '../journal/journalStore';
import { inProjectQueue } from '../journal/journalingStore';
import { idbKvStore, type KvStore } from '../journal/identity';
import { segmentName, validateActorDoc, validateSegment, type JournalEvent } from '../journal/seal';
import { verifyProjectAgainstJournal } from '../journal/verify';
import {
  APPLY_MARKER,
  applyScratch,
  deleteIfPresent,
  deleteIngredientIfPresent,
  deleteReservedIngredients,
  finishPendingApply,
  nextSyncGeneration,
  readIngredientFiles,
  scratchPathOf,
  guardOpenCopy,
  OPEN_MARKER,
  openRunning,
  openScratchOf,
  type OpenPhase,
  type OpsHandle,
  type OpsRecorder,
} from '../journal/opsLog';
import { assertRepoPath, type ServerApi } from '../serverApi';
import { resolutionRecord, resolveToolBook, type Coverage, type Tool } from '../resolve';
import type { ResourcesFile } from '../burritoStore';
import { NO_CONSENT } from '../internet';
import { remoteAllowed } from './shareOperation';
import type { Door43Session } from './door43Api';

const JOURNAL_PREFIX = 'checking/journal/';
const REMOTE = 'origin';
/** G4: how many times a sync gets Door43 main again after a push that is not a fast-forward. */
export const SYNC_TRIES = 3;

/** One Door43 repository: `https://<host>/<org>/<repo>`. */
export interface CloneSource {
  host: string;
  org: string;
  repo: string;
}

export interface SyncDeps {
  /** The platform. The caller passes `getNetEnabled` as the D95 barrier
   * (`internetAllowed`), as state.jsx does for the share. The rig and the
   * development build pass `cloneRepo` from `standInCloneRepo`. */
  api: ServerApi;
  /** The installation store: the actor id (identity.ts) and the outbox. Default: the shared IndexedDB store. */
  kv?: KvStore;
  /** The Door43 server (`dcsServer`): `origin` must be on it. */
  door43Server: string;
  /** The book coverage of the installed resources (`resolutionContext`), for `resolve`. */
  coverage: Coverage;
  /** The ops log the sync writes its record and its phases to. Without it the
   * sync refuses (`opslog.not-loaded`) before any request (G8). */
  ops?: OpsRecorder;
  /** Accept a `file://` origin (the rig stand-in). Production leaves it unset. */
  allowFileRemote?: boolean;
  /** Injectable physical clock for the name action's ts (tests). */
  now?: () => number;
}

export interface SyncRequest {
  repoPath: string;
  session: Door43Session | null;
}

/** The Door43 repository an `origin` url names: `https://<host>/<org>/<repo>[.git]`.
 * A `file://` url (the rig stand-in, only when `allowFileRemote`) names
 * `file/<parent folder>/<folder>`. Null for any other url. */
export const cloneSourceOf = (url: string, allowFileRemote = false): CloneSource | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = decodeURIComponent(parsed.pathname).split('/').filter(Boolean);
  const repo = parts[parts.length - 1]?.replace(/\.git$/, '');
  if (parsed.protocol === 'https:' && parts.length === 2 && repo) return { host: parsed.host, org: parts[0], repo };
  if (parsed.protocol === 'file:' && allowFileRemote && parts.length >= 2 && repo)
    return { host: 'file', org: parts[parts.length - 2], repo };
  return null;
};

/** The rig stand-in for the Door43 clone (#673 "The rig stand-in"): copy the
 * never-committed mirror `_local_/_archive_/<org>--<repo>` to the fixed path,
 * then pull `origin`. Only the development build and the rig tests use it.
 * The mirror MUST carry a local `user.name` and `user.email`, as the server's own
 * clone writes them (`clone_repo.rs:84-93`): the platform commit panics without a
 * git identity [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-09-29),
 * `add_and_commit.rs:157` `repo.signature().expect("signature")`, rig with no
 * global git config, 2026-10-14]. */
export const standInCloneRepo =
  (api: ServerApi) =>
  async (host: string, org: string, repo: string): Promise<void> => {
    const fixed = `${host}/${org}/${repo}`;
    await api.copyRepo(`_local_/_archive_/${org}--${repo}`, fixed);
    await api.pullRepo(REMOTE, fixed);
  };

const failureOf = (error: unknown): { status: number; reason: string } => {
  const failure = error as { status?: number; reason?: string; message?: string } | null;
  return { status: failure?.status ?? 0, reason: failure?.reason ?? failure?.message ?? String(error) };
};

const refusalForClone = (error: unknown): Error => {
  const facts = failureOf(error);
  if (facts.status === 401 && /offline mode/.test(facts.reason)) return new Refusal('sync.offline', NO_CONSENT, facts);
  if (/code=Exists \(-4\)/.test(facts.reason))
    return new Refusal('sync.clone-path-exists', 'the clone path already holds a folder', facts);
  return new Refusal('sync.clone-failed', `Door43 main did not clone: ${facts.reason}`, facts);
};

/** The refusal a platform push answer maps to. NotFastForward is G4's retry signal. */
const refusalForPush = (error: unknown): Error => {
  const facts = failureOf(error);
  const { status, reason } = facts;
  if (status === 401 && /offline mode/.test(reason)) return new Refusal('sync.offline', NO_CONSENT, facts);
  if (/NotFastForward/.test(reason))
    return new Refusal('sync.non-fast-forward', 'Door43 main moved while this computer synced', facts);
  // A refused token: libgit2's code, recorded by the owner run (step 3); the text
  // ("authentication that we do not support") is misleading, so never match it.
  if (/code=Auth \(-16\)/.test(reason))
    return new Refusal('sync.auth-failed', 'Door43 did not accept the sign-in', facts);
  // [PENDING — the owner's run on the Door43 QA server, #710]: the reply for
  // no write access is not recorded yet; libgit2 names the HTTP status in its
  // reason, so the status number is the best-known match.
  if (status === 403 || /\b403\b/.test(reason))
    return new Refusal('sync.no-write-access', 'Door43 did not accept the push: no write access', facts);
  return new Refusal('sync.push-failed', `the push failed: ${reason}`, facts);
};

/** The fixed path the clone route writes to (PLATFORM-NOTES #49). */
export const clonePathOf = (source: CloneSource): string => `${source.host}/${source.org}/${source.repo}`;

/** One in-process lock per fixed clone path. A clone holds it from the delete of
 * a stale folder at the path to the move off the path, so two clones of the same
 * repository (a sync, and #677 open from Door43) never meet there. `cloneProject`
 * takes it; other code that uses the fixed path takes it too. The key has its
 * own prefix, so it never waits on a project queue.
 * Lock order: the project queue (`inProjectQueue`) first, then this lock; never
 * the reverse. A sync holds its project queue when it clones; code that holds
 * this lock must never wait on a project queue, or the two can deadlock. */
export const withClonePath = <T>(clonePath: string, fn: () => Promise<T>): Promise<T> =>
  inProjectQueue(`clone-path:${clonePath}`, fn);

/** Clone Door43 `main` of `source` into `repoPath`, by the #673 method: a full
 * clone (no `branch`) to the fixed path `<host>/<org>/<repo>`, then a move.
 * `repoPath` must not exist. `beforeClone` runs after the checks and before the
 * first side effect (the sync records its phase there). Throws a Refusal:
 * `sync.clone-path-exists`, `sync.offline`, `sync.clone-failed` or `sync.move-failed`.
 * For #677 (open a project from Door43). */
export function cloneProject(
  api: Pick<ServerApi, 'listLocalRepos' | 'cloneRepo' | 'copyRepo' | 'deleteRepo' | 'listBranches'>,
  source: CloneSource,
  repoPath: string,
  beforeClone?: (clonePath: string) => Promise<unknown>,
  beforeMove?: (clonePath: string) => Promise<unknown>,
): Promise<void> {
  return withClonePath(clonePathOf(source), () => cloneLocked(api, source, repoPath, beforeClone, beforeMove));
}

async function cloneLocked(
  api: Pick<ServerApi, 'listLocalRepos' | 'cloneRepo' | 'copyRepo' | 'deleteRepo' | 'listBranches'>,
  source: CloneSource,
  repoPath: string,
  beforeClone?: (clonePath: string) => Promise<unknown>,
  beforeMove?: (clonePath: string) => Promise<unknown>,
): Promise<void> {
  const clonePath = clonePathOf(source);
  if (clonePath === repoPath)
    throw new Refusal('sync.clone-path-exists', `the clone path ${clonePath} is the target`, { clonePath });
  // A folder at the fixed path, while this process holds its lock, is a clone
  // that a kill left between the clone and the move: no clone of this process is
  // running there. tC4 installs resources under `_local_/_sideloaded_/`
  // (installed.ts), never here, and the caller refuses a project at this path.
  if ((await api.listLocalRepos()).includes(clonePath)) await deleteIfPresent(api, clonePath);
  if ((await beforeClone?.(clonePath)) === false)
    throw new Error('the ops log did not save the clone phase; nothing was cloned');
  try {
    await api.cloneRepo(source.host, source.org, source.repo);
  } catch (error) {
    throw refusalForClone(error);
  }
  try {
    // `beforeMove` runs at the fixed path, before the clone can reach `repoPath`
    await beforeMove?.(clonePath);
    await api.copyRepo(clonePath, repoPath, true);
  } catch (error) {
    // A clone path the clean-up cannot delete stays on Home and blocks every later
    // clone: say so (`clonePathLeft`), so the caller keeps its record for recovery.
    const left = await deleteIfPresent(api, clonePath).then(() => null, (cleanup: unknown) => failureOf(cleanup).reason);
    throw new Refusal('sync.move-failed', `the clone did not move to ${repoPath}`,
      { clonePath, ...failureOf(error), ...(left === null ? {} : { clonePathLeft: true, cleanupError: left }) });
  }
  // Door43 `main` only (G4): the full clone checks out the repository's default
  // branch, and the push pushes the checked-out branch. The pinned platform has no
  // route that checks out `main` from `origin` with full history (`git/branch`
  // needs a local branch, `git/new-branch` branches from HEAD, a `branch` clone is
  // shallow), so a default branch other than `main` refuses.
  const head = (await api.listBranches(repoPath)).find((branch) => branch.is_head);
  if (head?.name !== 'main') {
    const left = await deleteIfPresent(api, repoPath).then(() => null, (cleanup: unknown) => failureOf(cleanup).reason);
    throw new Refusal('sync.not-main', 'the Door43 repository does not have main as its default branch',
      { branch: head?.name ?? null, ...(left === null ? {} : { targetLeft: true, cleanupError: left }) });
  }
}

// ---- Open a project from Door43 (#677; layer 4 of epic #24) -----------------
// A translator on another computer starts from the same project: a full copy of
// Door43 `main` by `cloneProject`, into a scratch path that Home never lists
// (`_local_/_archive_/`). The copy must hold a tC4 journal, and every journal
// file passes the one validator (G2); then a copy and a delete put it at
// `_local_/_local_/<name>`, the only place the app lists projects. A refusal
// deletes the scratch copy: no project is written. (The platform can leave an empty
// `<host>/<org>/` folder after a clone or a move; it is not a repository, and
// `list-local-repos` and Home do not list it.) The new path gives a new actor id
// (identity.ts), and the clone keeps `origin`, so the card reads "Sync with
// Door43" (#678: the shared state is `origin`, D84 point 1).
// Safety after a stop comes from the disk only: a marker file travels with the copy,
// and the gate before each open or sync of the project (`guardOpenCopy`) and the
// recovery at start decide from it (opsLog.ts, the open section, `settleOpenCopy`).
// The ops record (`op: 'open-door43'`) is for the Report, the Inspector and the
// clone-path hint. No open starts until the ops log loads at this start
// (`opslog.not-loaded`).
// Out of scope: private repositories, a branch choice, OBS projects (D98).

const APP_ORG = '_local_/_local_';

/** The Door43 repository the dialog's field names: `owner/repo` on the Door43
 * server, or a link to a repository on it. A `file://` link (the rig stand-in)
 * only when `allowFileRemote`. Null for anything else. */
export const openSourceOf = (input: string, door43Server: string, allowFileRemote = false): CloneSource | null => {
  const text = input.trim().replace(/\/+$/, '');
  if (/^[^/\s:]+\/[^/\s:]+$/.test(text)) return cloneSourceOf(`${new URL(door43Server).origin}/${text}`);
  return remoteAllowed(text, door43Server, allowFileRemote) ? cloneSourceOf(text, allowFileRemote) : null;
};

/** The project path of a name, or null when the name is not a folder name of
 * letters, numbers, hyphens and underscores (the field's hint says so). */
export const openRepoPathOf = (name: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) return null;
  const repoPath = `${APP_ORG}/${name.trim()}`;
  try {
    assertRepoPath(repoPath);
    return repoPath;
  } catch {
    return null;
  }
};

/** The default project name of a repository name: each run of signs that a
 * project name cannot hold becomes one `-`, and no `-` stays at either end. */
export const openDefaultName = (repo: string): string =>
  repo.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

/** Is `repoPath` in the listing already? Compared without case: the disk of
 * macOS and Windows holds one folder for two names that differ only in case. */
export const repoPathInUse = (listing: string[], repoPath: string): boolean =>
  listing.some((p) => p.toLowerCase() === repoPath.toLowerCase());

export interface OpenDeps {
  /** The platform. The caller passes `getNetEnabled` as the D95 barrier, and on
   * the rig a `cloneRepo` from `standInCloneRepo`, as for the sync. */
  api: ServerApi;
  /** The ops log the open writes its record and its phases to. */
  ops?: OpsRecorder;
}

/** The checks before the internet: the ops log is loaded, and the name is free. */
async function openChecks(deps: OpenDeps, repoPath: string | null): Promise<void> {
  if (deps.ops?.recovered === false)
    throw new Refusal('opslog.not-loaded', 'the ops log did not load at this start; restart the app to open a project from Door43');
  if (repoPath && repoPathInUse(await deps.api.listLocalRepos(), repoPath))
    throw new Refusal('open-door43.name-exists', `a project at ${repoPath} is on this computer already`, { repoPath });
}

/** The order of the dialog's "Open project": the local checks come first; then
 * `ask` (the D95 question: the caller passes its `internetTask('open', …)`) runs
 * the open after a yes. Not now answers undefined, and nothing is sent or written. */
export async function openFromDoor43Asking(
  deps: OpenDeps & { ask: (run: () => Promise<{ repoPath: string }>) => Promise<{ repoPath: string } | undefined> },
  request: { source: CloneSource; name: string },
): Promise<{ repoPath: string } | undefined> {
  await openChecks(deps, openRepoPathOf(request.name));
  return deps.ask(() => openFromDoor43(deps, request));
}

/** The checks of the copy at `scratch`. Throws a Refusal: `sync.obs-unsupported`,
 * `open-door43.no-journal`, or `sync.incoming-invalid` (G2). */
async function checkOpenCopy(api: ServerApi, scratch: string, repoPath: string): Promise<void> {
  // D98: Bible projects only
  if (isObsMetadata(await api.getMetadataRaw(scratch)))
    throw new Refusal('sync.obs-unsupported', 'only Bible projects open from Door43 (D98)', { repoPath });
  // a tC4 project holds a journal; another repository is an import (#365)
  const journal = await readFiles(api, scratch, (p) => p.startsWith(JOURNAL_PREFIX), false);
  if (![...journal.keys()].some((p) => /^checking\/journal\/[^/]+\/segments\//.test(p)))
    throw new Refusal('open-door43.no-journal', 'the repository holds no tC4 journal, so it is not a tC4 project', { repoPath });
  // G2: every journal file passes the one validator, or no project is written
  const failures: Array<{ path: string; reason: string }> = [];
  for (const [ipath, bytes] of journal) {
    const verdict = await checkJournalFile({ validateSegment, validateActorDoc, segmentName }, ipath, bytes);
    if (!verdict.ok) failures.push({ path: ipath, reason: verdict.reason });
  }
  if (failures.length)
    throw new Refusal('sync.incoming-invalid', `${failures.length} journal file(s) on Door43 fail the validator`, { failures });
}

/** The two HTTP 400 collision replies from pankosmia-web 0.18.15 (a83725b,
 * 2026-09-29), copy_repo.rs:50-56,73-82 and copy_dir 0.1.3 lib.rs:68-71.
 * Verified 2026-10-15; docs/evidence/sync-copy-collisions-2026-10-15.md.
 * Both checks precede any destination write. Other copy errors can leave a
 * partial copy and still require its cleanup. */
const isCopyCollision = ({ status, reason }: { status: number; reason: string }): boolean =>
  status === 400 && (reason === 'Target repo already exists' || reason === 'could not copy repo: target path exists');

/** Steps 1 to 3 of the marker order (opsLog.ts, the open section): the marker in the
 * scratch copy, the copy, then the scratch marker's delete. Throws `sync.move-failed`.
 * `keepScratch` is called when a part copy of this open can stay at `repoPath`: the
 * marked scratch copy must then stay too, as the only proof that it is not whole. */
async function copyMarked(
  api: ServerApi,
  scratch: string,
  repoPath: string,
  startedAt: string,
  cleanup: (step: () => Promise<void>, what: string) => Promise<boolean>,
  keepScratch: () => void,
): Promise<void> {
  // 1. from here the copy is not finished until step 3
  await api.writeIngredient(scratch, OPEN_MARKER, JSON.stringify({ open: repoPath, startedAt }), { updateIngredients: false, keepBak: false });
  // 2. the copy
  try {
    await api.copyRepo(scratch, repoPath);
  } catch (error) {
    const facts = failureOf(error);
    // A target that is there already belongs to someone else: the marker goes first,
    // so that no gate can take that project for this open's part copy.
    if (isCopyCollision(facts)) await cleanup(() => deleteIngredientIfPresent(api, scratch, OPEN_MARKER), 'the marker delete');
    // a part copy at the free path is this open's
    else if (!(await cleanup(() => deleteIfPresent(api, repoPath), 'the part copy delete'))) keepScratch();
    throw new Refusal('sync.move-failed', `the copy did not move to ${repoPath}`, { repoPath, ...facts });
  }
  // 3. the copy returned ok, so the project is whole: the scratch marker goes first
  try {
    await deleteIngredientIfPresent(api, scratch, OPEN_MARKER);
  } catch (error) {
    if (!(await cleanup(() => deleteIfPresent(api, repoPath), 'the project delete after a failed marker delete'))) keepScratch();
    throw new Refusal('sync.move-failed', `the copy at ${repoPath} was not confirmed`, { repoPath, ...failureOf(error) });
  }
}

/** Open a project from Door43: put a full copy of `source` at
 * `_local_/_local_/<name>` and answer its path. Throws a Refusal, and then
 * no project is written: `opslog.not-loaded` and `open-door43.name-exists` (checked
 * first, before the internet), `sync.offline`, the `cloneProject` codes,
 * `sync.obs-unsupported`, `open-door43.no-journal`, or `sync.incoming-invalid`
 * (G2, with each failing path in `failures`). */
export async function openFromDoor43(deps: OpenDeps, request: { source: CloneSource; name: string }): Promise<{ repoPath: string }> {
  const { api } = deps;
  const repoPath = openRepoPathOf(request.name);
  if (!repoPath) throw new Error(`the project name ${JSON.stringify(request.name)} is not a folder name`);
  await openChecks(deps, repoPath);
  if (!(await api.getNetEnabled())) throw new Refusal('sync.offline', NO_CONSENT);
  if (openRunning.has(repoPath))
    throw new Refusal('open-door43.pending', `an open from Door43 of ${repoPath} runs now`, { repoPath, state: 'running' });
  const scratch = openScratchOf(repoPath);
  const startedAt = new Date().toISOString();
  const source = `${request.source.host}/${request.source.org}/${request.source.repo}`;
  // The record is for the Report, the Inspector and the clone-path hint. Safety comes
  // from the marker on disk (opsLog.ts, the open section), so a phase that does not
  // save never stops the open.
  const record = await deps.ops?.begin('open-door43', { repoPath, scratch, source });
  const phase = (name: OpenPhase, facts: Record<string, unknown> = {}): Promise<unknown> =>
    record?.note({ phase: name, ...facts }) ?? Promise.resolve(true);
  // A cleanup that fails is logged, and the record stays open, so the next start runs
  // its recovery (the clone-path hint, a stale scratch copy). Safety is the marker on disk.
  let allClean = true;
  const cleanup = async (step: () => Promise<void>, what: string): Promise<boolean> => {
    try {
      await step();
      return true;
    } catch (error) {
      allClean = false;
      console.error(`open from Door43: ${what} failed; the next gate or start finishes it: ${failureOf(error).reason}`);
      return false;
    }
  };
  // A clone path that `cloneProject` could not delete keeps the record open (phase
  // clone), so the next start deletes it, as for the sync.
  const keepIfCloneLeft = (error: unknown): void => {
    if ((error as { facts?: { clonePathLeft?: boolean } } | null)?.facts?.clonePathLeft) allClean = false;
  };
  // A part copy of this open can stay at the project path: then the marked scratch copy
  // MUST stay too. It is the only proof on disk that the project is not whole.
  let keepScratch = false;
  openRunning.add(repoPath);
  try {
    try {
      await phase('start');
      await deleteIfPresent(api, scratch);
      // The fixed clone path is shared with the sync (#676): `cloneProject` runs under its
      // one lock (`withClonePath`) and first deletes a clone that a stop left there, so a
      // left clone never blocks the next open of the repository.
      // Door43 content never brings a marker: every file in the reserved folders
      // (`tc4-open/`, `tc4-sync/`) is deleted at the fixed path, before the move, as the
      // sync does there. So the scratch copy holds a marker only after this open writes
      // it (`copyMarked`), and the project holds none of them.
      const clonePath = clonePathOf(request.source);
      await cloneProject(api, request.source, scratch, () => phase('clone', { clonePath }).then(() => true),
        (fixed) => deleteReservedIngredients(api, fixed));
      await phase('check');
      await checkOpenCopy(api, scratch, repoPath);
      // a project made at this path meanwhile refuses with the name code
      if (repoPathInUse(await api.listLocalRepos(), repoPath))
        throw new Refusal('open-door43.name-exists', `a project at ${repoPath} is on this computer already`, { repoPath });
      await phase('move.copy');
      await copyMarked(api, scratch, repoPath, startedAt, cleanup, () => (keepScratch = true));
    } catch (error) {
      if (!keepScratch) await cleanup(() => deleteIfPresent(api, scratch), 'the scratch delete');
      keepIfCloneLeft(error);
      if (allClean && !keepScratch) await record?.close(failedReport('open-door43', startedAt, new Date().toISOString(), error, { repoPath, source }));
      throw error;
    }
    // 4. and 5. A failure here leaves the project whole: the next gate or start finishes it.
    await phase('move.delete-scratch');
    await cleanup(() => deleteIngredientIfPresent(api, repoPath, OPEN_MARKER), 'the project marker delete');
    await cleanup(() => deleteIfPresent(api, scratch), 'the scratch delete');
    if (allClean) await record?.close(okReport('open-door43', startedAt, new Date().toISOString(), { repoPath, source }));
    return { repoPath };
  } finally {
    openRunning.delete(repoPath);
  }
}

/** The `resolve` the core reads: the §5.2 resource record of one (tool, book),
 * resolved over the folded pins and the installed resources (D30). */
export const resolveFromCoverage =
  (coverage: Coverage) =>
  (tool: string, book: string, pins: Record<string, unknown>): Record<string, unknown> => {
    const resources = JSON.parse(projectResources(pins)) as ResourcesFile;
    return resolutionRecord(resolveToolBook(resources, tool as Tool, book, coverage)) as unknown as Record<string, unknown>;
  };

/** The files of one repository by ingredient path (`readIngredientFiles`: never
 * `audio/`), and `metadata.json` when `withMetadata`. */
async function readFiles(api: ServerApi, repoPath: string, filter: (ipath: string) => boolean, withMetadata: boolean): Promise<Map<string, string>> {
  const files = await readIngredientFiles(api, repoPath, filter);
  if (withMetadata) files.set('metadata.json', JSON.stringify(await api.getMetadataRaw(repoPath)));
  return files;
}

/** The events of this actor's journal files in `files` (Door43 main): what the name rule must see. */
async function ownEventsOf(files: Map<string, string>, actor: string): Promise<JournalEvent[]> {
  const events: JournalEvent[] = [];
  for (const [ipath, bytes] of files) {
    if (!ipath.startsWith(`${JOURNAL_PREFIX}${actor}/segments/`)) continue;
    const verdict = await validateSegment(bytes);
    if (verdict.ok) events.push(...verdict.events);
  }
  return events;
}

/** Sync one project with Door43 `main` and return its Report (`op: 'sync'`).
 *
 * Contract for the caller (#678): after an ok sync the caller MUST open the
 * project again. The open `JournalingStore` holds the fold from before the
 * apply, so it takes no edit after it (`sync.project-replaced`). A
 * `sync.apply-pending` Report means the apply did not finish: the project then
 * takes no open and no edit until the next start, or the next sync of the
 * project, finishes it. */
export async function sync(deps: SyncDeps, request: SyncRequest): Promise<Report> {
  const { repoPath, session } = request;
  // Not signed in: refused before any request, the ops-log write included.
  if (!session?.username || !session.token) {
    const at = new Date().toISOString();
    return failedReport('sync', at, at, new Refusal('sync.auth-failed', 'sign in to Door43 first'), { repoPath });
  }
  return inProjectQueue(repoPath, async () => {
    // The Report goes to the ops log (the dev Inspector), so the log must be loaded.
    // Safety does not depend on it: the scratch copy and its marker are the record.
    const ops = deps.ops;
    if (!ops || ops.recovered !== true) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('opslog.not-loaded', 'the ops log did not load at this start; restart the app to sync'), { repoPath });
    }
    // G8 (D101): an apply that the marker says may have begun is finished first
    try {
      await finishPendingApply(deps.api, repoPath);
    } catch (error) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('sync.apply-pending', `the sync of ${repoPath} did not finish; restart the app to finish it`, failureOf(error)), { repoPath });
    }
    // #677: a project whose copy from Door43 is not proved finished never syncs
    // (disk only, opsLog.ts `settleOpenCopy`): the gate finishes it or removes it.
    try {
      await guardOpenCopy(deps.api, repoPath);
    } catch (error) {
      const at = new Date().toISOString();
      // a failure that is no refusal (a server error) also gets a code (`withCode`)
      return withCode(failedReport('sync', at, at, error, { repoPath }));
    }
    const record = await ops.begin('sync', { repoPath });
    const recorded = await syncRecorded(deps, request, record);
    const report = withCode(recorded.report);
    // A clone path left behind keeps its record open, so the next start deletes it.
    if (!recorded.open) await record.close(report);
    return report;
  });
}

/** Every failed sync Report carries a code (tests assert codes, never text): a
 * failure that is no refusal (a server error, a panic answered as HTTP 500)
 * becomes `sync.failed`, and its diagnosis stays in `facts.error`. */
const withCode = (report: Report): Report => {
  if (report.ok || report.code) return report;
  const facts: Record<string, unknown> = { ...report.facts };
  const error = facts.error;
  delete facts.error;
  delete facts.refusal;
  return failedReport('sync', report.startedAt, report.endedAt, new Refusal('sync.failed', String(error ?? 'the sync failed')), facts);
};

/** What the checks find: the Door43 repository and the credentials. Throws a Refusal. */
async function preflight(deps: SyncDeps, request: SyncRequest): Promise<{ source: CloneSource; username: string; token: string }> {
  const { api } = deps;
  const { repoPath, session } = request;
  if (!session?.username || !session.token) throw new Refusal('sync.auth-failed', 'sign in to Door43 first');
  if (!(await api.getNetEnabled())) throw new Refusal('sync.offline', NO_CONSENT);
  const origin = (await api.listRemotes(repoPath)).find((remote) => remote.name === REMOTE);
  const allowFile = deps.allowFileRemote === true;
  const source = origin && remoteAllowed(origin.url, deps.door43Server, allowFile) ? cloneSourceOf(origin.url, allowFile) : null;
  if (!source) throw new Refusal('sync.not-shared', 'the project has no origin on the Door43 server; share it first');
  // a project at the fixed clone path is not a clone that a kill left: never delete it
  if (clonePathOf(source) === repoPath)
    throw new Refusal('sync.clone-path-exists', `the project ${repoPath} is at the fixed clone path`, { clonePath: repoPath });
  return { source, username: session.username, token: session.token };
}

/** This computer's side, read once: the actor, every journal file, the outbox. */
interface Mine {
  journal: JournalStore;
  actor: string;
  files: Map<string, string>;
  outbox: Map<string, string>;
}

/** One try, steps 2 to 6: Door43 main into the scratch copy, the core, write,
 * commit, verify, push. Answers the core's facts, or the core's refused Report;
 * throws any other refusal (a push that is not a fast-forward is one). */
async function syncOnce(
  deps: SyncDeps,
  checked: Awaited<ReturnType<typeof preflight>>,
  mine: Mine,
  scratch: string,
  note: (facts: Record<string, unknown>) => Promise<boolean>,
  tries: number,
): Promise<{ facts: Record<string, unknown> } | { refused: Report }> {
  const { api } = deps;
  // 2. Door43 main into the scratch copy
  await deleteIfPresent(api, scratch);
  // Door43 content never authorizes an apply: every file in the reserved folders
  // (`tc4-open/`, `tc4-sync/`) that came with the clone is deleted at the fixed path,
  // before the move, as the open does (#677). So the scratch copy holds a marker only
  // after this sync wrote it (step 7), the verify finds no extra file there, and the
  // push removes those files from Door43 main. A kill before the move leaves only the
  // clone path, which the next clone deletes.
  await cloneProject(api, checked.source, scratch, (clonePath) => note({ phase: 'clone', clonePath, try: tries }),
    (clonePath) => deleteReservedIngredients(api, clonePath));
  await note({ phase: 'sync' });
  const remote = await readFiles(api, scratch, () => true, true);

  // 3. the name action: once per actor (R-8.5.26), the username only
  const outbox = new Map(mine.outbox);
  try {
    const name = await mine.journal.sealName(checked.username, await ownEventsOf(remote, mine.actor));
    outbox.set(name.ipath, name.bytes);
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'actor.name-already-set') throw error;
  }

  // 4. the core
  const core = await syncCore({
    remote,
    mine: { actor: mine.actor, journal: mine.files, outbox },
    resolve: resolveFromCoverage(deps.coverage),
    files: { validateSegment, validateActorDoc, segmentName },
  });
  if (!core.report.ok) return { refused: core.report };

  // 5. write, delete, commit, verify
  for (const [ipath, bytes] of core.write)
    await api.writeIngredient(scratch, ipath, bytes, { updateIngredients: false, keepBak: false });
  for (const ipath of core.remove) await api.deleteIngredient(scratch, ipath);
  const message = checkpointMessage('sync with Door43', await api.gitStatus(scratch));
  if (message !== null) {
    await api.remakeIngredients(scratch);
    await api.addAndCommit(scratch, message);
  }
  const verified = await verifyProjectAgainstJournal(api, scratch, { skipUnjournaled: true }); // audio/ is never read
  if (!verified.ok)
    throw new Refusal('sync.verify-failed', 'the copy is not the fold of its journal; nothing was pushed', {
      projectionFailure: verified.projectionFailure,
      invalidSegments: verified.invalidSegments.map((s) => s.path),
      mismatches: verified.mismatches.map((m) => m.ipath),
      metadataProblems: verified.metadataProblems,
    });

  // 6. push; never a force push (G4)
  await note({ phase: 'push' });
  try {
    await api.push(scratch, REMOTE, checked.username, checked.token);
  } catch (error) {
    throw refusalForPush(error);
  }
  return { facts: core.report.facts };
}

/** Steps 2 to 6 with the G4 retries: the core's facts, or the result to return. */
async function syncWithRetries(
  deps: SyncDeps,
  checked: Awaited<ReturnType<typeof preflight>>,
  mine: Mine,
  scratch: string,
  note: (facts: Record<string, unknown>) => Promise<boolean>,
  failed: (error: unknown, facts?: Record<string, unknown>) => { report: Report; open: boolean },
): Promise<{ facts: Record<string, unknown> } | { result: { report: Report; open: boolean } }> {
  const { api } = deps;
  for (let tries = 1; ; tries += 1) {
    try {
      const once = await syncOnce(deps, checked, mine, scratch, note, tries);
      if ('refused' in once) {
        await deleteIfPresent(api, scratch);
        return { result: { report: once.refused, open: false } };
      }
      return { facts: { ...once.facts, tries } };
    } catch (error) {
      await deleteIfPresent(api, scratch).catch(() => {});
      if ((error as { code?: string } | null)?.code === 'sync.non-fast-forward' && tries < SYNC_TRIES) continue;
      // a clone path left behind: keep the record (phase clone), so the next start deletes it
      if ((error as { facts?: { clonePathLeft?: boolean } } | null)?.facts?.clonePathLeft) return { result: { ...failed(error, { tries }), open: true } };
      return { result: failed(error, { tries }) };
    }
  }
}

async function syncRecorded(
  deps: SyncDeps,
  request: SyncRequest,
  record: OpsHandle,
): Promise<{ report: Report; open: boolean }> {
  const startedAt = new Date().toISOString();
  const { api } = deps;
  const { repoPath } = request;
  const kv = deps.kv ?? idbKvStore();
  const scratch = scratchPathOf(repoPath);
  const note = (facts: Record<string, unknown>): Promise<boolean> => record.note(facts);
  const failed = (error: unknown, facts: Record<string, unknown> = {}): { report: Report; open: boolean } => ({
    report: failedReport('sync', startedAt, new Date().toISOString(), error, { repoPath, ...facts }),
    open: false,
  });

  // 1. the checks, in this order; nothing is written before them
  let checked: Awaited<ReturnType<typeof preflight>>;
  let mine: Mine;
  try {
    checked = await preflight(deps, request);
  } catch (error) {
    return failed(error);
  }
  try {
    const journal = new JournalStore({ api, repoPath, kv, now: deps.now });
    const actor = (await journal.open()).actorId;
    const files = await readFiles(api, repoPath, (p) => p.startsWith(JOURNAL_PREFIX), false);
    mine = { journal, actor, files, outbox: await journal.readOutbox() };
  } catch (error) {
    return failed(error, { step: 'read' });
  }

  // steps 2 to 6; a push that is not a fast-forward starts again (G4)
  const tried = await syncWithRetries(deps, checked, mine, scratch, note, failed);
  if ('result' in tried) return tried.result;
  const { facts } = tried;

  // 7. the apply (G8, D101): the marker in the scratch copy is the record, and it is
  // there before the first write to the project (opsLog.ts header). The marker
  // comes before the phase `apply` in the ops log: a record at `apply` with no
  // marker is then always an apply that ended (`resolveSync`).
  try {
    await api.writeIngredient(scratch, APPLY_MARKER, JSON.stringify({ actor: mine.actor, at: new Date().toISOString() }), { updateIngredients: false, keepBak: false });
  } catch (error) {
    // Nothing is applied yet. The write may have landed with its answer lost, so
    // the marker goes first, then its scratch copy.
    try {
      await deleteIngredientIfPresent(api, scratch, APPLY_MARKER);
    } catch (again) {
      // The marker may be there, and the next start or sync applies the scratch
      // copy. A store opened before the sync is stale now (G1): an edit in it
      // would go under that apply.
      nextSyncGeneration(repoPath);
      const refusal = new Refusal('sync.apply-pending', 'the apply marker may be there; the next start of the app finishes the sync', failureOf(again));
      return failed(refusal, { tries: facts.tries, phase: 'apply' });
    }
    // no marker: no apply can begin, and a scratch copy left here is only deleted
    await deleteIfPresent(api, scratch).catch(() => {});
    return failed(error, { tries: facts.tries, phase: 'apply' });
  }
  await note({ phase: 'apply' });
  nextSyncGeneration(repoPath); // G1: a store opened before the apply is stale
  try {
    await applyScratch(api, repoPath, scratch);
  } catch {
    // a server failure in this run: run the apply once more (it compares, then writes)
    try {
      await applyScratch(api, repoPath, scratch);
    } catch (again) {
      const refusal = new Refusal('sync.apply-pending', 'the apply did not finish; the next start of the app finishes it', failureOf(again));
      return failed(refusal, { tries: facts.tries, phase: 'apply' });
    }
  }

  // 8. the apply is done: the marker goes first (one file), then the scratch copy
  // A failure from here on is after the apply: the sync is done, and the next
  // start or sync ends the clean-up (a marker left there applies again, which
  // changes nothing).
  try {
    await deleteIngredientIfPresent(api, scratch, APPLY_MARKER);
    await mine.journal.clearCarried(mine.outbox);
    await deleteIfPresent(api, scratch);
  } catch (error) {
    const refusal = new Refusal('sync.cleanup-failed', 'the sync is done; its clean-up did not finish, and the next start or sync ends it', failureOf(error));
    return failed(refusal, { tries: facts.tries, applied: true });
  }
  return { report: okReport('sync', startedAt, new Date().toISOString(), { ...facts, repoPath }), open: false };
}
