// The share operation (issue #362, D79 point 12, D84): push the project's
// working `main` to a repository under the user's Door43 account or one of the
// user's organizations, created on the first share. A transport action, not
// team sync (D67): no publication branch, no outbox, no integrate, no receive,
// never a force push.
//
// The order, each step a named refusal from the closed table in
// journal/report.mjs, and nothing pushed on a refusal:
//   1. the session has a username and a token       — else `share.auth-failed`
//   2. the platform's network is on                  — else `share.offline`
//   3. the D9 checkpoint, when the project is dirty  — a failure is a failed Report with no code
//   4. no `origin` yet: create the repository on Door43, add it as `origin`
//        409 `share.name-exists` · 401 `share.auth-failed` · else `share.create-rejected`
//   5. push `main` to `origin` with the token in the request BODY
//        401 "offline mode" `share.offline` · NotFastForward `share.non-fast-forward` · else `share.push-failed`
//
// The repository's own `origin` is the record of a share (D84 point 1; the
// "one simplification" of #362): a second share finds it and pushes with no
// create. The installation store holds nothing about remotes.
//
// Reasons [VERIFIED — pankosmia-web 0.18.5 (99fd9be) on the rig, 2026-09-28,
// over a `file://` remote]: offline answers HTTP 401 `{"reason":"offline mode"}`
// before the body is read; a non-fast-forward push answers HTTP 500 with
// `code=NotFastForward (-11)` in the reason and leaves the remote unchanged.
import { checkpointMessage } from '../checkpoint';
import { Refusal, failedReport, okReport, type Report } from '../journal/runtime';
import type { OpsRecorder } from '../journal/opsLog';
import type { ServerApi } from '../serverApi';
import { Door43ApiError, type Door43Api, type Door43Session, type ShareTarget } from './door43Api';

/** The platform calls a share makes; `ServerApi` satisfies it. */
export type ShareTransport = Pick<
  ServerApi,
  'getNetEnabled' | 'listRemotes' | 'addRemote' | 'push'
>;

export interface ShareDeps {
  api: ShareTransport;
  door43: Door43Api;
  /** The store's D9 checkpoint (`BurritoStore.commitPending`). */
  commitPending: (
    messageFor: (changes: Array<{ path: string; change_type: string }>) => string | null,
  ) => Promise<string | null>;
  /** #374: the ops log the share writes its record to. */
  ops?: OpsRecorder;
  /** Accept a `file://` remote (the rig's local remote, the tests' control).
   * Production leaves it unset; the development client sets it (state.jsx). */
  allowFileRemote?: boolean;
  /** The progress line (D84 point 5): called before the create and before the push. */
  onStep?: (step: 'create' | 'push') => void;
}

export interface ShareRequest {
  repoPath: string;
  session: Door43Session;
  /** Where the first share creates the repository; ignored once `origin` exists. */
  target: ShareTarget;
  /** The repository name on Door43; default: the project's folder name. */
  name: string;
}

/** The facts of an ok share Report. */
export interface ShareFacts extends Record<string, unknown> {
  /** `<owner>/<name>` on Door43. */
  repository: string;
  /** The page a person opens. */
  url: string;
  /** True when this share created the repository. */
  created: boolean;
}

const REMOTE = 'origin';

/** `<owner>/<name>` and the page address, read back from a remote url. */
export const repositoryOf = (remoteUrl: string): { repository: string; url: string } => {
  const url = remoteUrl.replace(/\.git$/, '');
  let repository = url;
  try {
    repository = new URL(url).pathname.replace(/^\/+/, '');
  } catch {
    // a remote that is not a URL (the platform's three-part shorthand): the record is the path
  }
  return { repository, url };
};

/** Issue #362 criterion 9: the push remote takes its server from `dcsServer`. A
 * remote is accepted only on the configured Door43 server's origin (scheme, host,
 * port) with no user or password in it; `file://` only when a test allows it.
 * The token goes to no other host, and a refused url is never put in a Report. */
export const remoteAllowed = (raw: string, server: string, allowFileRemote = false): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'file:') return allowFileRemote;
  return url.origin === new URL(server).origin;
};

/** Push the project to Door43 and return its Report (`op: 'share'`). */
export async function share(deps: ShareDeps, request: ShareRequest): Promise<Report> {
  const record = await deps.ops?.begin('share', { repoPath: request.repoPath });
  const report = await shareRecorded(deps, request);
  await record?.close(report);
  return report;
}

async function shareRecorded(deps: ShareDeps, request: ShareRequest): Promise<Report> {
  const startedAt = new Date().toISOString();
  const { repoPath, session, target, name } = request;
  // A failed share names the user's own account with a placeholder and keeps no username (D85, #474).
  const base = {
    repoPath,
    target: target.kind === 'user' ? '<username>' : target.organization,
  };
  const failed = (error: unknown, facts: Record<string, unknown> = {}): Report =>
    failedReport('share', startedAt, new Date().toISOString(), error, { ...base, ...facts });
  try {
    if (!session.username || !session.token)
      throw new Refusal('share.auth-failed', 'sign in to Door43 first');
    if (!(await deps.api.getNetEnabled())) throw new Refusal('share.offline', 'tC4 is set to Local');
  } catch (error) {
    return failed(error);
  }

  try {
    await deps.commitPending((changes) => checkpointMessage('before share', changes));
  } catch (error) {
    return failed(error, { step: 'checkpoint' });
  }

  // On a first share the identity is Door43's answer; on a later share it is
  // read back from the `origin` url.
  let facts: ShareFacts;
  const allowed = (url: string, allowFile = deps.allowFileRemote === true) =>
    remoteAllowed(url, deps.door43.server, allowFile);
  try {
    const origin = (await deps.api.listRemotes(repoPath)).find((remote) => remote.name === REMOTE);
    if (origin) {
      if (!allowed(origin.url)) {
        const refusal = new Refusal(
          'share.push-failed',
          'the origin remote is not on the Door43 server; nothing was pushed',
        );
        return failed(refusal, { step: 'push' });
      }
      facts = { ...repositoryOf(origin.url), created: false };
    } else {
      deps.onStep?.('create');
      const repository = await deps.door43
        .createRepository(session, target, name)
        .catch((error: unknown) => {
          throw refusalForCreate(error, name);
        });
      if (!allowed(repository.cloneUrl) || !allowed(repository.htmlUrl, false))
        throw new Refusal(
          'share.create-rejected',
          'Door43 answered an address that is not on its own server',
        );
      await deps.api.addRemote(repoPath, REMOTE, repository.cloneUrl);
      facts = { repository: repository.fullName, url: repository.htmlUrl, created: true };
    }
  } catch (error) {
    return failed(error, { step: 'create' });
  }

  try {
    deps.onStep?.('push');
    await deps.api.push(repoPath, REMOTE, session.username, session.token);
  } catch (error) {
    return failed(refusalForPush(error), { step: 'push', ...facts });
  }
  return okReport('share', startedAt, new Date().toISOString(), facts);
}

/** The refusal a Door43 create answer maps to. Facts carry the status and
 * Door43's message, never the request. */
const refusalForCreate = (error: unknown, name: string): unknown => {
  if (!(error instanceof Door43ApiError)) return error;
  const facts = { status: error.status, message: error.message };
  if (error.status === 409)
    return new Refusal('share.name-exists', `the name ${name} exists there; pick another`, facts);
  if (error.status === 401)
    return new Refusal('share.auth-failed', 'Door43 did not accept the sign-in', facts);
  // A token minted before #467 lacks the create scopes: a new sign-in mints
  // one that has them, so it is the sign-in that failed, not the create.
  if (error.status === 403 && /required scope/.test(error.message))
    return new Refusal('share.auth-failed', 'the Door43 sign-in cannot create repositories; sign in again', facts);
  return new Refusal(
    'share.create-rejected',
    `Door43 did not create the repository: ${error.message}`,
    facts,
  );
};

/** The refusal a platform push answer maps to. */
const refusalForPush = (error: unknown): unknown => {
  const failure = error as { status?: number; reason?: string; message?: string } | null;
  const reason = failure?.reason ?? failure?.message ?? String(error);
  const facts = { status: failure?.status ?? 0, reason };
  if (failure?.status === 401 && /offline mode/.test(reason))
    return new Refusal('share.offline', 'tC4 is set to Local', facts);
  if (/NotFastForward/.test(reason)) {
    return new Refusal(
      'share.non-fast-forward',
      'another device has pushed this project; team sync is coming and your work is safe',
      facts,
    );
  }
  return new Refusal('share.push-failed', `the push failed: ${reason}`, facts);
};
