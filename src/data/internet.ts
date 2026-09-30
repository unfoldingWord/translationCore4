// D86 (#486): the Internet / Local choice. The platform's net gate is the one
// switch; this module decides where it starts and how it changes. The stored
// choice is one flag in the per-client settings — `internet: true` — and its
// absence is Local, so a new installation, a missing document and a document
// that cannot be read all start as Local (D86 point 3).

export const INTERNET_KEY = 'internet';

/** The slice of ServerApi this module needs (a fake in the tests). */
export interface NetGate {
  getNetEnabled(): Promise<boolean>;
  enableNet(): Promise<void>;
  disableNet(): Promise<void>;
}

/** The stored choice in a per-client settings document: Internet only when it says so. */
export const storedInternet = (settings: Record<string, unknown> | null | undefined): boolean =>
  settings?.[INTERNET_KEY] === true;

/** The settings document with the choice written in: Internet adds the flag, Local removes it. */
export const withInternet = (settings: Record<string, unknown>, allowed: boolean): Record<string, unknown> => {
  const rest = { ...settings };
  delete rest[INTERNET_KEY];
  return allowed ? { ...rest, [INTERNET_KEY]: true } : rest;
};

/** The gate as the server reports it, or null when the read is not answered. */
const readGate = async (gate: NetGate): Promise<boolean | null> => {
  try {
    return await gate.getNetEnabled();
  } catch {
    return null;
  }
};

/** What tC4 may do now, and the i18n key of a gate that did not follow. */
export interface InternetState {
  allowed: boolean;
  error: 'net.allowFailed' | 'net.localFailed' | null;
}

/** D86 point 3, the barrier: tC4 may use the internet only when the choice is
 * Internet and the server reports the gate on. A Local choice is Local even
 * when the gate still reads on; that is said, never shown as Internet. */
const barrier = (wanted: boolean, read: boolean | null): InternetState => {
  if (wanted) return { allowed: read === true, error: read === true ? null : 'net.allowFailed' };
  return { allowed: false, error: read === false ? null : 'net.localFailed' };
};

/** At start: a stored Internet turns the gate on; anything else turns it off
 * (pankosmia-web 0.18.10 can start with it on). A stored Internet whose gate
 * stays off keeps its stored choice, so the next start tries again. */
export async function startInternet(gate: NetGate, readSettings: () => Promise<Record<string, unknown>>): Promise<InternetState> {
  let wanted = false;
  try {
    wanted = storedInternet(await readSettings());
  } catch {
    wanted = false;
  }
  try {
    await (wanted ? gate.enableNet() : gate.disableNet());
  } catch {
    /* the read below reports what the server holds */
  }
  return barrier(wanted, await readGate(gate));
}

/** A change the user asked for. Internet is stored only when the server
 * reports the gate on. Local is stored at once: the user's choice to stop
 * holds even when the gate does not turn off. A store failure keeps the
 * change for this session. */
export async function changeInternet(
  gate: NetGate,
  wanted: boolean,
  store: (allowed: boolean) => Promise<unknown>,
): Promise<InternetState> {
  if (!wanted) await store(false).catch(() => {});
  try {
    await (wanted ? gate.enableNet() : gate.disableNet());
  } catch {
    /* the read below reports what the server holds */
  }
  const result = barrier(wanted, await readGate(gate));
  if (wanted && result.allowed) await store(true).catch(() => {});
  return result;
}

/** The app state fields that show an internet action running (state.jsx). */
interface BusyState {
  shareCard?: Record<string, { busy?: boolean } | undefined>;
  sh?: { busy?: boolean } | null;
  src?: { dl?: string | null };
  fix?: { busy?: unknown } | null;
  upgrade?: { checking?: boolean; installing?: unknown };
  im?: { versions?: { looking?: boolean } | null } | null;
}

/** D86 point 2: an action that uses the internet is running — a share or an
 * upload, a download, an update check or the import version lookup — so the
 * change to Local waits for it. */
export const internetBusy = (st: BusyState): boolean =>
  Object.values(st.shareCard ?? {}).some((card) => !!card?.busy) || !!st.sh?.busy
  || st.src?.dl === 'run' || !!st.fix?.busy || !!st.upgrade?.checking || !!st.upgrade?.installing
  || !!st.im?.versions?.looking;
