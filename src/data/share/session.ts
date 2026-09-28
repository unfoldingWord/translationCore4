// The Door43 session (issue #203, D79 point 13, D84 points 6 and 7): the token
// lives in this module's memory for the app session, and nowhere else. It is
// never put in React state, the platform client settings, `localStorage`, a
// URL or a log. "Stay signed in" hands it to the operating-system keychain
// through `TokenKeychain` (#366); where no keychain is wired the token stays
// in memory, as D84 point 6 says.
//
// The identity for git (D7: name and email, the user's own choice, a pseudonym
// allowed) is stored once per installation in the platform client settings,
// beside the install records — the "belongs to this machine, not to the
// project" store. The Door43 login rides with it, so a later session asks for
// the password only. The record never holds the token or the password.
import { Refusal, failedReport, okReport, type Report } from '../journal/runtime';
import type { SettingsWriter } from '../journal/opsLog';
import { Door43ApiError, type Door43Api, type Door43Session } from './door43Api';

/** Key under which the identity record lives in client settings. */
export const IDENTITY_KEY = 'shareIdentity';

export interface ShareIdentity {
  name: string;
  email: string;
  /** The Door43 username or email last signed in with; asked once, then prefilled. */
  login: string;
}

/** The keychain seam (#366): keep a session between app sessions, or forget it. */
export interface TokenKeychain {
  keep(session: Door43Session): Promise<void>;
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

/** A kept session found at start-up (#366 reads the keychain and calls this). */
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
  let kept = false;
  if (request.stay && deps.keychain) {
    await deps.keychain.keep(signed);
    kept = true;
  }
  const facts: SignInFacts = { ...base, step: 'sign-in', username: signed.username, kept };
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

// ---- the identity for git (D7, D84 point 7) ----------------------------------

/** The identity record in a client-settings document, or null when the
 * installation has none (or holds a damaged one: a record without a name and
 * an email is asked again, never used). */
export const identityOf = (doc: Record<string, unknown> | null | undefined): ShareIdentity | null => {
  const raw = doc?.[IDENTITY_KEY] as Partial<ShareIdentity> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const { name, email, login } = raw;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim()) return null;
  return { name: name.trim(), email: email.trim(), login: typeof login === 'string' ? login : '' };
};

/** Store the identity for this installation, through the app's one settings writer. */
export const writeIdentity = (update: SettingsWriter, identity: ShareIdentity): Promise<void> =>
  update((doc) => ({ ...doc, [IDENTITY_KEY]: { name: identity.name, email: identity.email, login: identity.login } }));
