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

/** The gate as the server reports it; an unanswered read is Local. */
const reportedGate = async (gate: NetGate): Promise<boolean> => (await readGate(gate)) ?? false;

/** At start: a stored Internet turns the gate on; anything else turns it off
 * (pankosmia-web 0.18.10 can start with it on). Resolves to the gate the
 * server reports afterwards. */
export async function startInternet(gate: NetGate, readSettings: () => Promise<Record<string, unknown>>): Promise<boolean> {
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
  return reportedGate(gate);
}

/** A change the user asked for. The choice is stored only when the server
 * reports the gate the user asked for; a store failure keeps the change for
 * this session. */
export async function changeInternet(
  gate: NetGate,
  wanted: boolean,
  store: (allowed: boolean) => Promise<unknown>,
): Promise<{ allowed: boolean; changed: boolean }> {
  try {
    await (wanted ? gate.enableNet() : gate.disableNet());
  } catch {
    /* the read below reports what the server holds */
  }
  // An unanswered read is shown as Local, but it is not a report: the change
  // is not confirmed and nothing is stored.
  const read = await readGate(gate);
  const allowed = read ?? false;
  const changed = read === wanted;
  if (changed) await store(allowed).catch(() => {});
  return { allowed, changed };
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
