// The ops log (issue #374; TEAM-SYNC-PLAN 1.4): every store operation writes
// one record to the installation store BEFORE its first side effect and closes
// it with the operation's Report at the end. A record that is still open at the
// next start of the app belongs to an operation that was killed; `recover`
// resolves it — an interrupted import deletes its partial repository, an
// interrupted export is simply gone, and an interrupted open or checkpoint is
// left to the journal, whose outbox replays at the next open of that project.
//
// The records live in the platform's per-client settings document (the one
// store a client has outside its projects), beside `draftUnits` and `lastUsed`,
// so they never enter a burrito. Every write goes through ONE serialized
// read-modify-write writer, so an ops write and any other settings write can
// never overwrite each other.
import { Refusal, failedReport, type Report } from './runtime';

export type OpsOp = Report['op'];

/** One record. Open while `report` is absent. */
export interface OpsEntry {
  id: string;
  op: OpsOp;
  startedAt: string;
  facts: Record<string, unknown>;
  report?: Report;
}

/** The key of the ops log in the client-settings document, and how many records it keeps. */
export const OPS_KEY = 'opsLog';
export const OPS_LIMIT = 50;

type SettingsDoc = Record<string, unknown>;
/** Apply `mutate` to the latest document and store the result. Rejects when the read or the write fails. */
export type SettingsWriter = (mutate: (doc: SettingsDoc) => SettingsDoc) => Promise<void>;

/** The one writer of the client-settings document: each mutation reads the
 * LATEST document and writes it back, in call order. A failure rejects that
 * call only; the calls after it still run. */
export function serialSettingsWriter(
  read: () => Promise<SettingsDoc>,
  write: (doc: SettingsDoc) => Promise<void>,
): SettingsWriter & { idle(): Promise<unknown>; read(): Promise<SettingsDoc> } {
  let chain: Promise<unknown> = Promise.resolve();
  const update: SettingsWriter = (mutate) => {
    const run = chain.then(async () => {
      const doc = await read();
      await write(mutate(doc));
    });
    chain = run.catch(() => {});
    return run;
  };
  /** A read in the same order as the writes (#412): the platform writes the
   * document in place, so a read that overlaps a write can meet a half-written
   * file and fail to parse. */
  const readInOrder = (): Promise<SettingsDoc> => {
    const run = chain.then(read);
    chain = run.catch(() => {});
    return run;
  };
  /** Settles when every write queued so far has settled. */
  return Object.assign(update, { idle: () => chain, read: readInOrder });
}

export const opsEntriesOf = (doc: SettingsDoc | null | undefined): OpsEntry[] =>
  Array.isArray(doc?.[OPS_KEY]) ? (doc[OPS_KEY] as OpsEntry[]) : [];

/** The document with `entries` stored, oldest first; the oldest CLOSED records
 * go when the log is over its limit (an open record is never dropped). */
const withEntries = (doc: SettingsDoc, entries: OpsEntry[]): SettingsDoc => {
  const list = opsEntriesOf(doc).filter((e) => !entries.some((n) => n.id === e.id));
  list.push(...entries);
  while (list.length > OPS_LIMIT) {
    const i = list.findIndex((e) => e.report);
    if (i < 0) break;
    list.splice(i, 1);
  }
  return { ...doc, [OPS_KEY]: list };
};

/** The handle of one open record. Each call resolves `true` when the record was
 * saved and `false` when the write failed (the failure is reported, never thrown). */
export interface OpsHandle {
  /** Add facts before the next side effect (an import's repository path). */
  note(facts: Record<string, unknown>): Promise<boolean>;
  close(report: Report): Promise<boolean>;
}

/** What an operation needs to write its record. */
export interface OpsRecorder {
  begin(op: OpsOp, facts?: Record<string, unknown>): Promise<OpsHandle>;
}

/** A failed ops write: which record, and why. */
export interface OpsWriteError {
  id: string;
  op: OpsOp;
  error: string;
}

export interface OpsLogInit {
  read: () => Promise<SettingsDoc>;
  update: SettingsWriter;
  now?: () => number;
}

/** What recovery needs from the platform. */
export interface OpsRecoveryApi {
  listLocalRepos(): Promise<string[]>;
  deleteRepo(repoPath: string): Promise<void>;
}

export class OpsLog implements OpsRecorder {
  /** The records this session knows, oldest first — including any whose write failed. */
  entries: OpsEntry[] = [];
  /** Every failed ops write. A failure is kept here and announced, never dropped. */
  errors: OpsWriteError[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly read: OpsLogInit['read'];
  private readonly update: SettingsWriter;
  private readonly now: () => number;
  private seq = 0;

  constructor(init: OpsLogInit) {
    this.read = init.read;
    this.update = init.update;
    this.now = init.now ?? (() => Date.now());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async begin(op: OpsOp, facts: Record<string, unknown> = {}): Promise<OpsHandle> {
    const startedAt = new Date(this.now()).toISOString();
    const entry: OpsEntry = { id: `${startedAt}#${(this.seq += 1)}`, op, startedAt, facts: { ...facts } };
    await this.put(entry);
    return {
      note: (more) => this.put({ ...this.current(entry.id), facts: { ...this.current(entry.id).facts, ...more } }),
      close: (report) => this.put({ ...this.current(entry.id), report }),
    };
  }

  /** Resolve every record a killed operation left open, and load the log.
   * Run once, when the app starts, before any operation begins. */
  async recover(api: OpsRecoveryApi): Promise<OpsEntry[]> {
    const doc = await this.read();
    const resolved: OpsEntry[] = [];
    for (const entry of opsEntriesOf(doc)) {
      // A record this session began is running, not interrupted.
      if (entry.report || this.entries.some((e) => e.id === entry.id)) continue;
      resolved.push({ ...entry, report: await this.resolve(entry, api) });
    }
    if (resolved.length) await this.update((latest) => withEntries(latest, resolved));
    this.entries = withEntries(doc, resolved)[OPS_KEY] as OpsEntry[];
    this.notify();
    return resolved;
  }

  private async resolve(entry: OpsEntry, api: OpsRecoveryApi): Promise<Report> {
    const endedAt = new Date(this.now()).toISOString();
    const facts = { ...entry.facts, interrupted: true };
    if (entry.op === 'import') {
      const repoPath = typeof entry.facts.repoPath === 'string' ? entry.facts.repoPath : null;
      if (repoPath && (await api.listLocalRepos()).includes(repoPath)) {
        await api.deleteRepo(repoPath);
        return failedReport('import', entry.startedAt, endedAt,
          new Refusal('import.write-failed', 'the import was interrupted; the partly written project was removed', { repoPath }),
          { ...facts, rolledBack: true });
      }
      return failedReport('import', entry.startedAt, endedAt, new Error('the import was interrupted before it created a project'), facts);
    }
    if (entry.op === 'export')
      return failedReport('export', entry.startedAt, endedAt, new Error('the export was interrupted; no file was delivered'), facts);
    return failedReport(entry.op, entry.startedAt, endedAt,
      new Error(`the ${entry.op} was interrupted; the journal replays its staged actions at the next open of the project`), facts);
  }

  private current(id: string): OpsEntry {
    return this.entries.find((e) => e.id === id) as OpsEntry;
  }

  /** `true` when the record was saved. */
  private async put(entry: OpsEntry): Promise<boolean> {
    this.entries = withEntries({ [OPS_KEY]: this.entries }, [entry])[OPS_KEY] as OpsEntry[];
    this.notify();
    try {
      await this.update((doc) => withEntries(doc, [entry]));
      return true;
    } catch (error) {
      const failure = { id: entry.id, op: entry.op, error: String((error as Error)?.message ?? error) };
      this.errors = [...this.errors, failure];
      console.error(`ops log: the ${entry.op} record was not saved: ${failure.error}`);
      this.notify();
      return false;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
