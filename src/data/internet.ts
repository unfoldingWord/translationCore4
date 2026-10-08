// D95 (#559, amends D88 points 2–4): the internet is one on/off state for the
// app session. Each launch starts with it off, and nothing about it is stored.
// A step that needs the internet while it is off asks, in place, to turn it on;
// the account menu turns it off. The platform's net gate is an internal
// enforcement step, separate from that state: it is off at start, and the first
// step after "Turn on internet" turns it on and reads it back.

/** The refusal text of a request made while the internet is off. */
export const NO_CONSENT = 'tC4 has no permission to use the internet for this task';

/** The slice of ServerApi this module needs (a fake in the tests). */
export interface NetGate {
  getNetEnabled(): Promise<boolean>;
  enableNet(): Promise<void>;
  disableNet(): Promise<void>;
}

/** The gate as the server reports it, or null when the read is not answered. */
const readGate = async (gate: NetGate): Promise<boolean | null> => {
  try {
    return await gate.getNetEnabled();
  } catch {
    return null;
  }
};

/** At start the gate goes off (pankosmia-web 0.18.10 can start with it on).
 * Nothing waits for it: no request leaves while the internet is off, and the
 * first step after "Turn on internet" verifies the gate itself. */
export async function startGate(gate: NetGate): Promise<void> {
  try {
    await gate.disableNet();
  } catch {
    /* the first step after "Turn on internet" reads the gate again */
  }
}

/** Before a step runs: true only when the server reports the gate on, read
 * back after an enable. A gate that is already on is not changed. */
export async function ensureGate(gate: NetGate): Promise<boolean> {
  if ((await readGate(gate)) === true) return true;
  try {
    await gate.enableNet();
  } catch {
    /* the read below reports what the server holds */
  }
  return (await readGate(gate)) === true;
}

/** The one on/off state of the app session. It is read at the moment each
 * request is made, so turning it off stops the next request at once; a request
 * that was already sent finishes. */
export class InternetSwitch {
  on = false;
}

/** The platform routes that make the server use the internet. */
const OUTBOUND_ROUTES = ['/gitea/', '/git/push/'];

/** Whether a request uses the internet: any other origin, and the platform's
 * own outbound routes. Every other local request is not internet. */
export const needsConsent = (url: URL, origin: string, apiBase = '/api'): boolean =>
  url.origin !== origin || OUTBOUND_ROUTES.some((route) => url.pathname.startsWith(`${apiBase}${route}`));

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** The one boundary for every request the client makes, direct or through
 * the platform: while the internet is off it is refused before it is sent. */
export function guardFetch(fetchFn: typeof fetch, internet: InternetSwitch, origin: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!internet.on && needsConsent(new URL(requestUrl(input), origin), origin))
      return Promise.reject(new TypeError(NO_CONSENT));
    return fetchFn(input, init);
  }) as typeof fetch;
}
