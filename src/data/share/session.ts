// The Door43 session (issue #203, D79 point 13, D84 point 6, D85): the token
// lives in this module's memory for the app session, and nowhere else. It is
// never put in React state, the platform client settings, `localStorage`, a
// URL or a log. "Stay signed in" hands the token — the token only — to the
// operating-system keychain through `TokenKeychain` (#366); where no keychain
// is wired the token stays in memory, as D84 point 6 says.
//
// Nothing else is stored (D85): no name, no email, no login. The username is
// Door43's own answer (`GET /api/v1/user`), read at sign-in and again by #366
// when a kept token resumes a session. The commit author is not the app's to
// set: the platform signs every commit with the computer's account name
// (PLATFORM-NOTES #47).
import { Refusal, failedReport, okReport, type Report } from '../journal/runtime';
import { Door43ApiError, type Door43Api, type Door43Session } from './door43Api';

/** The keychain seam (#366): keep the token between app sessions, or forget it. */
export interface TokenKeychain {
  keep(token: string): Promise<void>;
  forget(): Promise<void>;
}

let session: Door43Session | null = null;

/** The session of this app session, or null when nobody is signed in. */
export const currentSession = (): Door43Session | null => session;

/** Sign out: the token leaves memory, and the keychain when one is wired. */
export const signOut = async (keychain?: TokenKeychain): Promise<void> => {
  session = null;
  await keychain?.forget();
};

/** A kept token found at start-up, with the username `GET /api/v1/user`
 * answered for it (#366 reads the keychain, asks Door43, and calls this). */
export const resumeSession = (kept: Door43Session): void => {
  session = kept;
};

export interface SignInDeps {
  door43: Door43Api;
  /** The platform's net gate: sign-in refuses offline before any Door43 call. */
  getNetEnabled: () => Promise<boolean>;
  keychain?: TokenKeychain;
}

export interface SignInRequest {
  login: string;
  password: string;
  /** "Stay signed in on this computer": keep the token in the keychain. */
  stay: boolean;
}

/** The facts of an ok sign-in Report: the login, never the token. */
export interface SignInFacts extends Record<string, unknown> {
  step: 'sign-in';
  username: string;
  /** True when the keychain took the token. */
  kept: boolean;
}

/** Sign in to Door43 and hold the token in memory; the Report (`op: 'share'`)
 * names the refusal: `share.auth-failed` (wrong password), `share.offline` (the
 * net gate is off, or Door43 could not be reached), `share.server-unavailable`
 * (Door43 answered 5xx). Nothing is stored on a refusal. */
export async function signIn(deps: SignInDeps, request: SignInRequest): Promise<Report> {
  const startedAt = new Date().toISOString();
  const base = { step: 'sign-in' };
  const failed = (error: unknown): Report =>
    failedReport('share', startedAt, new Date().toISOString(), error, base);
  try {
    if (!request.login || !request.password)
      throw new Refusal('share.auth-failed', 'enter your Door43 username or email and your password');
    if (!(await deps.getNetEnabled())) throw new Refusal('share.offline', 'the app is offline');
  } catch (error) {
    return failed(error);
  }
  let signed: Door43Session;
  try {
    signed = await deps.door43.signIn(request.login, request.password);
  } catch (error) {
    return failed(refusalForSignIn(error));
  }
  session = signed;
  const facts: SignInFacts = { ...base, step: 'sign-in', username: signed.username, kept: false };
  if (request.stay && deps.keychain) {
    // A keychain that refuses is not a failed sign-in: the token is in memory
    // for this session, and the Report says it was not kept.
    try {
      await deps.keychain.keep(signed.token);
      facts.kept = true;
    } catch (error) {
      facts.keepError = String((error as Error)?.message ?? error);
    }
  }
  return okReport('share', startedAt, new Date().toISOString(), facts);
}

/** The refusal a Door43 sign-in answer maps to. Facts carry the status and
 * Door43's message, never the credentials. */
const refusalForSignIn = (error: unknown): unknown => {
  if (!(error instanceof Door43ApiError)) return error;
  const facts = { status: error.status, message: error.message };
  if (error.status === 0)
    return new Refusal('share.offline', 'Door43 could not be reached; check the connection', facts);
  if (error.status === 401 || error.status === 403)
    return new Refusal('share.auth-failed', 'Door43 did not accept the username or the password', facts);
  if (error.status >= 500)
    return new Refusal('share.server-unavailable', 'Door43 is not available now; try again later', facts);
  return new Refusal('share.auth-failed', `Door43 refused the sign-in: ${error.message}`, facts);
};
