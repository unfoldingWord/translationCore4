// The sync shell (issue #676; layer 3 of epic #24, D98). The thin part that
// touches the server, beside the share operation. One sync of one project:
//
//   1. checks: a Door43 username and token (`sync.auth-failed`, before any
//      request), the internet gate (`sync.offline`, D95), and an `origin` on the
//      Door43 server (`sync.not-shared`).
//   2. get a full copy of Door43 `main` into the scratch copy: a clone to the
//      fixed path, then a move (#673, `cloneProject`).
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
//   7. the swap (G8): four server calls put the scratch copy at the project's
//      path; the ops log records each phase (src/data/journal/opsLog.ts names
//      each phase and its recovery rule). The project keeps its path, so it
//      keeps its actor id (G5: the id is HMAC(secret, repoPath), identity.ts).
//   8. live: clear the outbox entries the sync carried, record the previous
//      copy (the next successful checkpoint deletes it), and close the ops
//      record with the Report (`op: 'sync'`).
//
// The sync holds the project's mutation queue for its whole run, so no save of
// the open store lands between the read of the journal and the swap. After an ok
// sync the caller MUST open the project again: the open store's fold and
// `.git` are the old ones (#678).
//
// The HTTPS answers for a refused token (401) and for no write access (403)
// are [PENDING — owner run, #673 steps 3 and 4]. `refusalForPush` maps them by
// the HTTP status in the reason text, as best known.
import { checkpointMessage } from '../checkpoint';
import { Refusal, checkJournalFile, failedReport, isObsMetadata, okReport, projectResources, syncCore, type Report } from '../journal/runtime';
import { JournalStore, readJournalZipOf } from '../journal/journalStore';
import { inProjectQueue } from '../journal/journalingStore';
import { idbKvStore, type KvStore } from '../journal/identity';
import { segmentName, validateActorDoc, validateSegment, type JournalEvent } from '../journal/seal';
import { verifyProjectAgainstJournal } from '../journal/verify';
import {
  deleteIfPresent,
  openPathsOf,
  type OpenPhase,
  lastSegmentName,
  previousCopyKey,
  runSwap,
  syncPathsOf,
  type OpsHandle,
  type OpsRecorder,
  type SwapPaths,
  type SwapPhase,
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
  // [PENDING — owner run, #673 steps 3 and 4]: the HTTPS replies for a refused
  // token and for no write access are not recorded yet. libgit2 names the HTTP
  // status in its reason, so the status number is the best-known match.
  if (status === 403 || /\b403\b/.test(reason))
    return new Refusal('sync.no-write-access', 'Door43 did not accept the push: no write access', facts);
  if (status === 401 || /\b401\b|authentication/i.test(reason))
    return new Refusal('sync.auth-failed', 'Door43 did not accept the sign-in', facts);
  return new Refusal('sync.push-failed', `the push failed: ${reason}`, facts);
};

/** Clone Door43 `main` of `source` into `repoPath`, by the #673 method: a full
 * clone (no `branch`) to the fixed path `<host>/<org>/<repo>`, then a move.
 * `repoPath` must not exist. `beforeClone` runs after the checks and before the
 * first side effect (the sync records its phase there). Throws a Refusal:
 * `sync.clone-path-exists`, `sync.offline`, `sync.clone-failed` or `sync.move-failed`.
 * For #677 (open a project from Door43). */
export async function cloneProject(
  api: Pick<ServerApi, 'listLocalRepos' | 'cloneRepo' | 'copyRepo' | 'deleteRepo'>,
  source: CloneSource,
  repoPath: string,
  beforeClone?: (clonePath: string) => Promise<unknown>,
): Promise<void> {
  const clonePath = `${source.host}/${source.org}/${source.repo}`;
  // The fixed path is never deleted unless this clone made it: it can be an
  // installed resource. A path that is there already refuses.
  if ((await api.listLocalRepos()).includes(clonePath))
    throw new Refusal('sync.clone-path-exists', `the clone path ${clonePath} already holds a folder`, { clonePath });
  if ((await beforeClone?.(clonePath)) === false)
    throw new Error('the ops log did not save the clone phase; nothing was cloned');
  try {
    await api.cloneRepo(source.host, source.org, source.repo);
  } catch (error) {
    throw refusalForClone(error);
  }
  try {
    await api.copyRepo(clonePath, repoPath, true);
  } catch (error) {
    await deleteIfPresent(api, clonePath).catch(() => {});
    throw new Refusal('sync.move-failed', `the clone did not move to ${repoPath}`, { clonePath, ...failureOf(error) });
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
// The open writes an ops record (`op: 'open-door43'`) and saves each phase before
// its step, so the next start can clean up after a kill. The phases and their
// recovery rules are in opsLog.ts (`resolveOpen`). No open starts until the ops
// log loads at this start (`opslog.not-loaded`).
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
  const { scratch } = openPathsOf(repoPath);
  const startedAt = new Date().toISOString();
  const source = `${request.source.host}/${request.source.org}/${request.source.repo}`;
  const record = await deps.ops?.begin('open-door43', { repoPath, scratch, source });
  /** Save `phase` before its step; a phase that is not saved stops the open before the step. */
  const phase = async (name: OpenPhase, facts: Record<string, unknown> = {}): Promise<void> => {
    if ((await (record?.note({ phase: name, ...facts }) ?? true)) === false)
      throw new Error(`the ops log did not save the phase ${name}; the open stopped before it`);
  };
  // A cleanup that fails leaves the record open, so the next start runs it again.
  let cleanupFailed = false;
  const cleanup = async (path: string): Promise<void> => {
    try {
      await deleteIfPresent(api, path);
    } catch (error) {
      cleanupFailed = true;
      console.error(`open from Door43: ${path} was not deleted; the next start deletes it: ${failureOf(error).reason}`);
    }
  };
  // The clone path while it is this open's: from its saved phase until cloneProject returns.
  // cloneProject can swallow a failed delete of it, so the open deletes it again on a failure.
  let ownedClone = null as string | null;
  // A part copy or a clone that stays: the scratch copy stays too, because recovery
  // reads a missing scratch copy at `move.copy` as "the copy finished" (opsLog.ts).
  const cleanupAfterFailure = async (): Promise<void> => {
    if (ownedClone) await cleanup(ownedClone);
    if (!cleanupFailed) await cleanup(scratch);
  };
  try {
    await phase('start');
    await deleteIfPresent(api, scratch);
    await cloneProject(api, request.source, scratch, (clonePath) =>
      phase('clone', { clonePath }).then(() => ((ownedClone = clonePath), true), () => false));
    ownedClone = null;
    await phase('check');
    await checkOpenCopy(api, scratch, repoPath);
    // a project made at this path meanwhile refuses with the name code
    if (repoPathInUse(await api.listLocalRepos(), repoPath))
      throw new Refusal('open-door43.name-exists', `a project at ${repoPath} is on this computer already`, { repoPath });
    // the path is free (checked just now), and recovery reads the copy's last segment
    await phase('move.copy', { targetAbsent: true, liveMark: lastSegmentName(await api.listPaths(scratch)) });
    try {
      await api.copyRepo(scratch, repoPath);
    } catch (error) {
      const facts = failureOf(error);
      // A target that is there already belongs to someone else: it stays, and recovery must not touch it.
      if (/already exists/i.test(facts.reason)) await record?.note({ targetAbsent: false });
      else await cleanup(repoPath); // a part copy at the free path is this open's
      throw new Refusal('sync.move-failed', `the copy did not move to ${repoPath}`, { repoPath, ...facts });
    }
  } catch (error) {
    await cleanupAfterFailure();
    if (!cleanupFailed) await record?.close(failedReport('open-door43', startedAt, new Date().toISOString(), error, { repoPath, source }));
    throw error;
  }
  // The copy finished, so the project is whole and the open succeeded. Then the
  // scratch copy goes. When this phase does not save, the saved phase stays
  // `move.copy`, and recovery keeps the project because the scratch copy is gone.
  await record?.note({ phase: 'move.delete-scratch' });
  await cleanup(scratch);
  if (!cleanupFailed) await record?.close(okReport('open-door43', startedAt, new Date().toISOString(), { repoPath, source }));
  return { repoPath };
}


/** The `resolve` the core reads: the §5.2 resource record of one (tool, book),
 * resolved over the folded pins and the installed resources (D30). */
export const resolveFromCoverage =
  (coverage: Coverage) =>
  (tool: string, book: string, pins: Record<string, unknown>): Record<string, unknown> => {
    const resources = JSON.parse(projectResources(pins)) as ResourcesFile;
    return resolutionRecord(resolveToolBook(resources, tool as Tool, book, coverage)) as unknown as Record<string, unknown>;
  };

/** The files of one repository by ingredient path: the journal in one zipped
 * read (else one read per file), the rest one read per file. `metadata.json`
 * is added when `withMetadata`. */
async function readFiles(api: ServerApi, repoPath: string, filter: (ipath: string) => boolean, withMetadata: boolean): Promise<Map<string, string>> {
  const paths = (await api.listPaths(repoPath)).filter(filter).sort();
  const zip = paths.some((p) => p.startsWith(JOURNAL_PREFIX)) ? await readJournalZipOf(api, repoPath) : null;
  const files = new Map<string, string>();
  for (const ipath of paths) files.set(ipath, zip?.get(ipath) ?? (await api.readIngredient(repoPath, ipath)));
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
 * project again. The open `JournalingStore` holds the fold and `.git` of the
 * old folder, and saves that it queued during the sync run on that stale
 * store. A `sync.swap-pending` Report means the swap did not finish: the
 * project then takes no open, no edit and no sync until the next start of the
 * app finishes it. */
export async function sync(deps: SyncDeps, request: SyncRequest): Promise<Report> {
  const { repoPath, session } = request;
  // Not signed in: refused before any request, the ops-log write included.
  if (!session?.username || !session.token) {
    const at = new Date().toISOString();
    return failedReport('sync', at, at, new Refusal('sync.auth-failed', 'sign in to Door43 first'), { repoPath });
  }
  return inProjectQueue(repoPath, async () => {
    // G8: one sync record per project. An open one is a swap that did not finish,
    // and a log that did not load at this start can hide one. With no ops log at
    // all, no phase is saved and a stopped swap cannot be recovered: refuse too.
    const ops = deps.ops;
    if (!ops || ops.recovered === false) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('opslog.not-loaded', 'the ops log did not load at this start; restart the app to sync'), { repoPath });
    }
    if (ops.isOpen?.('sync', repoPath)) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('sync.swap-pending', `the sync of ${repoPath} did not finish; restart the app to finish it`), { repoPath });
    }
    // An open from Door43 that stopped at move.copy can leave a part copy here,
    // which the next start may delete: no sync until that start finishes it.
    if (ops.isOpen?.('open-door43', repoPath, 'move.copy')) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('open-door43.pending', `the open from Door43 of ${repoPath} did not finish; restart the app to finish it`), { repoPath });
    }
    const record = await ops.begin('sync', { repoPath });
    const recorded = await syncRecorded(deps, request, record);
    const report = withCode(recorded.report);
    const { open, closed } = recorded;
    // A swap that stopped leaves its record open, so the next start finishes it (G8).
    // A go-back at swap.copy-previous closed its record itself, before its deletes.
    if (!open && !closed) await record.close(report);
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
  paths: SwapPaths,
  note: (facts: Record<string, unknown>) => Promise<boolean>,
  tries: number,
): Promise<{ facts: Record<string, unknown> } | { refused: Report }> {
  const { api } = deps;
  // 2. Door43 main into the scratch copy
  await deleteIfPresent(api, paths.scratch);
  await cloneProject(api, checked.source, paths.scratch, (clonePath) => note({ phase: 'clone', clonePath, try: tries }));
  await note({ phase: 'sync' });
  const remote = await readFiles(api, paths.scratch, () => true, true);

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
    await api.writeIngredient(paths.scratch, ipath, bytes, { updateIngredients: false, keepBak: false });
  for (const ipath of core.remove) await api.deleteIngredient(paths.scratch, ipath);
  const message = checkpointMessage('sync with Door43', await api.gitStatus(paths.scratch));
  if (message !== null) {
    await api.remakeIngredients(paths.scratch);
    await api.addAndCommit(paths.scratch, message);
  }
  const verified = await verifyProjectAgainstJournal(api, paths.scratch);
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
    await api.push(paths.scratch, REMOTE, checked.username, checked.token);
  } catch (error) {
    throw refusalForPush(error);
  }
  return { facts: core.report.facts };
}

async function syncRecorded(
  deps: SyncDeps,
  request: SyncRequest,
  record: OpsHandle,
): Promise<{ report: Report; open: boolean; closed?: boolean }> {
  const startedAt = new Date().toISOString();
  const { api } = deps;
  const { repoPath } = request;
  const kv = deps.kv ?? idbKvStore();
  const paths = syncPathsOf(repoPath);
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
  let facts: Record<string, unknown> = {};
  for (let tries = 1; ; tries += 1) {
    try {
      const once = await syncOnce(deps, checked, mine, paths, note, tries);
      if ('refused' in once) {
        await deleteIfPresent(api, paths.scratch);
        return { report: once.refused, open: false };
      }
      facts = { ...once.facts, tries };
      break;
    } catch (error) {
      await deleteIfPresent(api, paths.scratch).catch(() => {});
      if ((error as { code?: string } | null)?.code === 'sync.non-fast-forward' && tries < SYNC_TRIES) continue;
      return failed(error, { tries });
    }
  }

  // 7. the swap (G8): every phase is in the ops log before its step. The first
  // phase also saves the live mark, which recovery reads (opsLog.ts header).
  const liveMark = lastSegmentName(await api.listPaths(repoPath));
  let phase: SwapPhase = 'swap.copy-previous';
  const swapNote = (next: SwapPhase): Promise<boolean> => {
    phase = next;
    return note(next === 'swap.copy-previous' ? { phase: next, liveMark } : { phase: next });
  };
  try {
    await runSwap(api, paths, 'swap.copy-previous', swapNote);
  } catch (error) {
    // A server failure (not a kill) in this run. Going forward later is valid only
    // when nothing can change the live project meanwhile (opsLog.ts header).
    if (phase === 'swap.copy-previous') {
      // the live project is still whole at its path: go back now. The record is
      // closed BEFORE the copies are deleted: a record still saved at
      // swap.copy-previous makes the next start go forward with the scratch copy,
      // so the scratch copy must outlive it (G8). If the close is not saved, both
      // copies stay, and the next start goes forward, or back when the live
      // project changes before it (the live mark).
      const refusal = new Refusal('sync.move-failed', 'the swap stopped before the project changed; the project is as it was', failureOf(error));
      const back = { ...failed(refusal, { tries: facts.tries, phase }), closed: true };
      if (!(await record.close(back.report))) return back;
      await deleteIfPresent(api, paths.previous).catch(() => {});
      await deleteIfPresent(api, paths.scratch).catch(() => {});
      return back;
    }
    // the live path was touched: run the rest of the swap once more
    try {
      await runSwap(api, paths, phase, swapNote);
    } catch (again) {
      const refusal = new Refusal('sync.swap-pending', 'the swap did not finish; the next start of the app finishes it', failureOf(again));
      return { ...failed(refusal, { tries: facts.tries, phase }), open: true };
    }
  }

  // 8. live
  await note({ phase: 'live' });
  await mine.journal.clearCarried(mine.outbox);
  await kv.set(previousCopyKey(repoPath), paths.previous);
  return { report: okReport('sync', startedAt, new Date().toISOString(), { ...facts, repoPath }), open: false };
}
