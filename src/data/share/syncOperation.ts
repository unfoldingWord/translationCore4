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
// The HTTPS answer for a refused token is recorded: HTTP 500 with
// `code=Auth (-16)` (docs/evidence/sync-transport-spike-2026-10-13.md, owner run
// step 3), matched on the code, not on the text. The answer for no write access
// (403) is [PENDING — the owner's run on the Door43 QA server, #673 step 4];
// until then `refusalForPush` maps it by the HTTP status in the reason text.
import { checkpointMessage } from '../checkpoint';
import { Refusal, failedReport, isUnjournaledIngredient, okReport, projectResources, syncCore, type Report } from '../journal/runtime';
import { JournalStore, readJournalZipOf } from '../journal/journalStore';
import { inProjectQueue } from '../journal/journalingStore';
import { idbKvStore, type KvStore } from '../journal/identity';
import { segmentName, validateActorDoc, validateSegment, type JournalEvent } from '../journal/seal';
import { verifyProjectAgainstJournal } from '../journal/verify';
import {
  deleteIfPresent,
  lastSegmentName,
  previousCopyKey,
  runSwap,
  syncPathsOf,
  type OpsHandle,
  type OpsRecorder,
  type SwapPaths,
  type SwapPhase,
} from '../journal/opsLog';
import type { ServerApi } from '../serverApi';
import { unzipServerZip } from '../serverZip';
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
  // [PENDING — the owner's run on the Door43 QA server, #673 step 4]: the reply for
  // no write access is not recorded yet; libgit2 names the HTTP status in its
  // reason, so the status number is the best-known match.
  if (status === 403 || /\b403\b/.test(reason))
    return new Refusal('sync.no-write-access', 'Door43 did not accept the push: no write access', facts);
  return new Refusal('sync.push-failed', `the push failed: ${reason}`, facts);
};

/** Clone Door43 `main` of `source` into `repoPath`, by the #673 method: a full
 * clone (no `branch`) to the fixed path `<host>/<org>/<repo>`, then a move.
 * `repoPath` must not exist. `beforeClone` runs after the checks and before the
 * first side effect (the sync records its phase there). Throws a Refusal:
 * `sync.clone-path-exists`, `sync.offline`, `sync.clone-failed` or `sync.move-failed`.
 * For #677 (open a project from Door43). */
export async function cloneProject(
  api: Pick<ServerApi, 'listLocalRepos' | 'cloneRepo' | 'copyRepo' | 'deleteRepo' | 'listBranches'>,
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
  // Every file read here is text: BURRITO-SPEC R-8.7.1 makes each shared
  // non-journal file journal-derived (USFM or JSON) or the one tolerated
  // unjournaled class `ingredients/audio/` (R-8.7.3), which can be binary. That
  // class is never read as text: the core never writes or removes it, and
  // `audioNotCarried` compares it byte for byte.
  const paths = (await api.listPaths(repoPath)).filter((p) => filter(p) && !isUnjournaledIngredient(p)).sort();
  const zip = paths.some((p) => p.startsWith(JOURNAL_PREFIX)) ? await readJournalZipOf(api, repoPath) : null;
  const files = new Map<string, string>();
  for (const ipath of paths) files.set(ipath, zip?.get(ipath) ?? (await api.readIngredient(repoPath, ipath)));
  if (withMetadata) files.set('metadata.json', JSON.stringify(await api.getMetadataRaw(repoPath)));
  return files;
}

/** The bytes of a repository's `audio/` files, by ingredient path (one zipped read). */
async function audioBytesOf(api: ServerApi, repoPath: string, paths: string[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (!paths.some((p) => isUnjournaledIngredient(p))) return out;
  for (const [name, bytes] of Object.entries(unzipServerZip(await api.readIngredientZipped(repoPath, 'audio'))))
    if (!name.endsWith('/')) out.set(`audio/${name}`, bytes);
  return out;
}

/** G1 for the one binary class (R-8.7.3): the platform has no route that writes
 * bytes, so an own `audio/` file that Door43 main does not hold byte for byte
 * cannot reach the copy. Such a sync refuses, and nothing changes. */
async function audioNotCarried(api: ServerApi, repoPath: string, scratch: string): Promise<string[]> {
  const own = await audioBytesOf(api, repoPath, await api.listPaths(repoPath));
  if (!own.size) return [];
  const remote = await audioBytesOf(api, scratch, await api.listPaths(scratch));
  const same = (a: Uint8Array, b: Uint8Array | undefined): boolean => !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  return [...own].filter(([p, bytes]) => !same(bytes, remote.get(p))).map(([p]) => p).sort();
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
    if (!ops || ops.recovered !== true) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('opslog.not-loaded', 'the ops log did not load at this start; restart the app to sync'), { repoPath });
    }
    if (ops.isOpen?.('sync', repoPath)) {
      const at = new Date().toISOString();
      return failedReport('sync', at, at,
        new Refusal('sync.swap-pending', `the sync of ${repoPath} did not finish; restart the app to finish it`), { repoPath });
    }
    const record = await ops.begin('sync', { repoPath });
    const recorded = await syncRecorded(deps, request, record);
    const report = withCode(recorded.report);
    // A swap that stopped leaves its record open, so the next start finishes it (G8).
    // A close that is not saved keeps the project locked in this session (isOpen).
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
  const notCarried = await audioNotCarried(api, mine.journal.repoPath, paths.scratch);
  if (notCarried.length)
    throw new Refusal('sync.audio-not-carried', 'the project holds audio files that Door43 main does not hold byte for byte', { paths: notCarried });

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

/** Steps 2 to 6 with the G4 retries: the core's facts, or the result to return. */
async function syncWithRetries(
  deps: SyncDeps,
  checked: Awaited<ReturnType<typeof preflight>>,
  mine: Mine,
  paths: SwapPaths,
  note: (facts: Record<string, unknown>) => Promise<boolean>,
  failed: (error: unknown, facts?: Record<string, unknown>) => { report: Report; open: boolean },
): Promise<{ facts: Record<string, unknown> } | { result: { report: Report; open: boolean } }> {
  const { api } = deps;
  for (let tries = 1; ; tries += 1) {
    try {
      const once = await syncOnce(deps, checked, mine, paths, note, tries);
      if ('refused' in once) {
        await deleteIfPresent(api, paths.scratch);
        return { result: { report: once.refused, open: false } };
      }
      return { facts: { ...once.facts, tries } };
    } catch (error) {
      await deleteIfPresent(api, paths.scratch).catch(() => {});
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
  const tried = await syncWithRetries(deps, checked, mine, paths, note, failed);
  if ('result' in tried) return tried.result;
  const { facts } = tried;

  // 7. the swap (G8): every phase is in the ops log before its step. The first
  // phase also saves the live mark, which recovery reads (opsLog.ts header).
  const liveMark = lastSegmentName(await api.listPaths(repoPath));
  let phase: SwapPhase = 'swap.copy-previous';
  const swapNote = (next: SwapPhase): Promise<boolean> => {
    phase = next;
    return note({ phase: next, liveMark });
  };
  try {
    await runSwap(api, paths, 'swap.copy-previous', swapNote);
  } catch (error) {
    // A server failure (not a kill) in this run. Going forward later is valid only
    // when nothing can change the live project meanwhile (opsLog.ts header).
    if (phase === 'swap.copy-previous') {
      // the live project is still whole at its path: go back now. The go-back
      // phase is saved BEFORE the first delete, so a stop after it finishes the
      // go-back at the next start, never a forward swap without its scratch copy.
      // When it is not saved, nothing is deleted, and the record stays open: the
      // project stays locked until the next start goes forward from the saved phase.
      if (!(await note({ phase: 'swap.go-back', liveMark }))) {
        const pending = new Refusal('sync.swap-pending', 'the swap stopped, and the ops log did not save the go-back; the next start of the app finishes it', failureOf(error));
        return { ...failed(pending, { tries: facts.tries, phase }), open: true };
      }
      await deleteIfPresent(api, paths.previous).catch(() => {});
      await deleteIfPresent(api, paths.scratch).catch(() => {});
      const refusal = new Refusal('sync.move-failed', 'the swap stopped before the project changed; the project is as it was', failureOf(error));
      return failed(refusal, { tries: facts.tries, phase: 'swap.go-back' });
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
