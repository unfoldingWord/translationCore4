// D88 (#514): "Ask before using the internet". Consent is given to one user
// task, never read from the platform's net gate. The gate is an internal
// enforcement step: it is off at start, and the first permitted task turns it
// on for the rest of the app session (owner ruling, 2026-10-02). The stored
// preference is one flag in the per-client settings — `askInternet: false` —
// and its absence is "ask", so a new installation, a missing document, a
// document that cannot be read and an old Internet / Local choice all ask.

export const ASK_KEY = 'askInternet';

/** The refusal text of a request made outside a permitted task. */
export const NO_CONSENT = 'tC4 has no permission to use the internet for this task';

/** The slice of ServerApi this module needs (a fake in the tests). */
export interface NetGate {
  getNetEnabled(): Promise<boolean>;
  enableNet(): Promise<void>;
  disableNet(): Promise<void>;
}

/** The stored preference: ask, unless the document says `askInternet: false`. */
export const storedAsk = (settings: Record<string, unknown> | null | undefined): boolean =>
  settings?.[ASK_KEY] !== false;

/** The settings document with the preference written in: "ask" removes the flag. */
export const withAsk = (settings: Record<string, unknown>, ask: boolean): Record<string, unknown> => {
  const rest = { ...settings };
  delete rest[ASK_KEY];
  return ask ? rest : { ...rest, [ASK_KEY]: false };
};

/** The gate as the server reports it, or null when the read is not answered. */
const readGate = async (gate: NetGate): Promise<boolean | null> => {
  try {
    return await gate.getNetEnabled();
  } catch {
    return null;
  }
};

/** At start the gate goes off (pankosmia-web 0.18.10 can start with it on).
 * Nothing waits for it: no request leaves before a permitted task, and that
 * task verifies the gate itself. */
export async function startGate(gate: NetGate): Promise<void> {
  try {
    await gate.disableNet();
  } catch {
    /* the first permitted task reads the gate again */
  }
}

/** Before a permitted task: true only when the server reports the gate on,
 * read back after an enable. A gate that is already on is not changed. */
export async function ensureGate(gate: NetGate): Promise<boolean> {
  if ((await readGate(gate)) === true) return true;
  try {
    await gate.enableNet();
  } catch {
    /* the read below reports what the server holds */
  }
  return (await readGate(gate)) === true;
}

/** The permitted tasks that are open now. A request may leave the computer
 * only while one is open. */
export class Consent {
  private holds = 0;

  active(): boolean {
    return this.holds > 0;
  }

  /** Open a permitted task; the returned function closes it, once. */
  hold(): () => void {
    this.holds += 1;
    let open = true;
    return () => {
      if (open) {
        open = false;
        this.holds -= 1;
      }
    };
  }
}

/** The platform routes that make the server use the internet. */
const OUTBOUND_ROUTES = ['/gitea/', '/git/push/'];

/** Whether a request needs a permitted task: any other origin, and the
 * platform's own outbound routes. Every other local request is not internet. */
export const needsConsent = (url: URL, origin: string, apiBase = '/api'): boolean =>
  url.origin !== origin || OUTBOUND_ROUTES.some((route) => url.pathname.startsWith(`${apiBase}${route}`));

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** The one boundary for every request the client makes, direct or through
 * the platform: outside a permitted task it is refused before it is sent. */
export function guardFetch(fetchFn: typeof fetch, consent: Consent, origin: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (needsConsent(new URL(requestUrl(input), origin), origin) && !consent.active())
      return Promise.reject(new TypeError(NO_CONSENT));
    return fetchFn(input, init);
  }) as typeof fetch;
}
