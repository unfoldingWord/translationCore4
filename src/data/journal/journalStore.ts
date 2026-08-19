// JournalStore — the §8.1 write model (D50) over the pankosmia-web HTTP surface.
// Issue #61: the store publishes immutable sealed action segments under this
// installation's per-project actor directory, provisions actor.json, and keeps
// the §8.2 HLC honest across restarts. Issue #62 wraps one JournalStore per open
// project and owns the four-way recovery classifier; this store guarantees only
// staged-intent-then-publish and exposes replayStaged() (the D50 split).
//
// The reference implementation of these semantics is conformance/journal/ — the
// pure modules (grammar, schema, hlc) are imported directly; the fs branches of
// files.mjs are replaced by HTTP branches here (R-8.1.4/5 over readIngredient +
// writeIngredient).
import { makeClock } from '../../../conformance/journal/hlc.mjs';
import { ipathError, isTs } from '../../../conformance/journal/grammar.mjs';
import { ServerApi, ServerApiError } from '../serverApi';
import { withPathLock } from '../httpStore';
import { actorIdFor, type KvStore } from './identity';
import {
  sealAction,
  segmentName,
  segmentTs,
  validateActorDoc,
  validateSegment,
  type ActorDoc,
  type JournalEvent,
} from './seal';

export interface JournalStoreInit {
  api: ServerApi;
  repoPath: string;
  kv: KvStore;
  /** Injectable physical clock for tests; defaults to Date.now. */
  now?: () => number;
}

export interface OwnSegmentListing {
  /** Valid own segments, filename-sorted (= ts-sorted, R-8.1.2). */
  segments: { name: string; ts: string }[];
  /** Files under the segments directory whose name does not round-trip the
   * R-8.1.2 encoding: invisible as segments, reported here (R-8.1.7 posture). */
  misnamed: string[];
}

export type ReplayOutcome =
  | 'republished' // path free or invalid — the EXACT staged bytes were written
  | 'already-published' // byte-identical segment on the path — stage cleared
  | 'conflict' // a DIFFERENT valid segment holds the path — refused, stage kept
  | 'staged-invalid'; // the staged bytes themselves fail validateSegment — kept, surfaced

export interface ReplayResult {
  ts: string;
  outcome: ReplayOutcome;
  reason?: string;
}

interface PublishResult {
  ipath: string;
  /** True when the path already held byte-identical bytes (R-8.1.5 idempotent accept). */
  idempotent: boolean;
}

/** The non-identifying default device label (PRD FR-33, D7): NEVER an OS
 * username, hostname or real name — user-editable later. */
const DEFAULT_DEVICE_LABEL = 'translation device';

/** ONE §8.2 clock per (repoPath, actorId) in this process, shared across every
 * JournalStore instance for that identity — exactly as httpStore's lock map is
 * shared, and for the same reason (D39: one app instance per machine).
 *
 * The clock was per INSTANCE while the lock map was module-shared, so two stores
 * on one repoPath issued the SAME ts at the same physical millisecond (review
 * finding F2, 2026-08-19). A shared clock makes a same-process duplicate ts
 * impossible: `issue()` increments the counter for the second caller. */
const clocks = new Map<string, ReturnType<typeof makeClock>>();

const clockFor = (
  repoPath: string,
  actorId: string,
  now: () => number,
): ReturnType<typeof makeClock> => {
  const key = `${repoPath}\n${actorId}`;
  const shared = clocks.get(key) ?? makeClock(actorId, now);
  clocks.set(key, shared);
  return shared;
};

/** Drop every shared clock. A process RESTART is a fresh module state, so a test
 * that models a restart must call this — nothing in the app calls it. */
export const forgetSharedClocks = (): void => {
  clocks.clear();
};

export class JournalStore {
  readonly api: ServerApi;
  readonly repoPath: string;
  private readonly kv: KvStore;
  private readonly now: () => number;
  private boundActorId: string | null = null;
  private clock: ReturnType<typeof makeClock> | null = null;

  constructor(init: JournalStoreInit) {
    this.api = init.api;
    this.repoPath = init.repoPath;
    this.kv = init.kv;
    this.now = init.now ?? (() => Date.now());
  }

  /** The derived actor id, after open(). */
  get actorId(): string {
    if (this.boundActorId === null) throw new Error('JournalStore: not open — call open() first');
    return this.boundActorId;
  }

  private get actorIpath(): string {
    return `checking/journal/${this.actorId}/actor.json`;
  }

  private get segmentsDir(): string {
    return `checking/journal/${this.actorId}/segments`;
  }

  private get outboxPrefix(): string {
    return `outbox:${this.repoPath}:${this.actorId}:`;
  }

  /** Read one ingredient's text, or null when the file does not exist. */
  private async readOrNull(ipath: string): Promise<string | null> {
    try {
      return await this.api.readIngredient(this.repoPath, ipath);
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) return null;
      throw error;
    }
  }

  /** Write one journal file. Segments and actor.json are write-once, so the
   * .bak is pure waste (keepBak: false). update_ingredients is NEVER passed: a
   * rescan wipes every x-role repo-wide (PLATFORM-NOTES #5, D28/W-2) — paths are
   * authoritative and the commit-time rescan registers journal files as
   * ordinary ingredients (§8.1). */
  private async writeJournalFile(ipath: string, payload: string): Promise<void> {
    await this.api.writeIngredient(this.repoPath, ipath, payload, {
      updateIngredients: false,
      keepBak: false,
    });
  }

  /** Derive the actor id (D53c), provision-or-validate actor.json (R-8.1.13),
   * and ratchet the HLC past everything this actor has already published
   * (R-8.2.4) — after a restart the store never re-mints a ts. */
  async open(): Promise<{ actorId: string; actorDoc: ActorDoc }> {
    this.boundActorId = await actorIdFor(this.kv, this.repoPath);
    const actorId = this.boundActorId;

    // Provision-or-validate actor.json, serialized per path like every other
    // read-check-write in this process (B7 posture; in-process is enough — D39).
    const actorDoc = await withPathLock(`${this.repoPath} ${this.actorIpath}`, async () => {
      const existing = await this.readOrNull(this.actorIpath);
      if (existing === null) {
        // PROVISION. No displayName; the device label is deliberately
        // non-identifying and user-editable later (PRD FR-33, D7: never
        // auto-fill an OS username, hostname or real name).
        const doc: ActorDoc = {
          schemaVersion: 1,
          actorId,
          createdAt: new Date(this.now()).toISOString(), // fixed-width ISO (§8.2)
          device: DEFAULT_DEVICE_LABEL,
        };
        await this.writeJournalFile(this.actorIpath, JSON.stringify(doc, null, 2));
        return doc;
      }
      const verdict = validateActorDoc(existing, actorId);
      if (!verdict.ok)
        throw new Error(
          `refuse to open journal: existing ${this.actorIpath} is invalid (${verdict.reason}) — R-8.1.13`,
        );
      return verdict.doc;
    });

    // The SHARED clock for this identity (§8.2), then RATCHET it (R-8.2.4) past every
    // ts this actor has already published — listed segments AND staged outbox
    // intents (a crash between stage and publish must not re-mint that ts).
    this.clock = clockFor(this.repoPath, actorId, this.now);
    const { segments } = await this.readOwnSegments();
    for (const segment of segments) this.clock.ratchet(segment.ts);
    for (const key of await this.kv.keys(this.outboxPrefix)) {
      const ts = key.slice(this.outboxPrefix.length);
      if (isTs(ts)) this.clock.ratchet(ts);
    }

    return { actorId, actorDoc };
  }

  /** Issue the next §8.2 HLC ts for this actor. */
  issueTs(): string {
    if (this.clock === null) throw new Error('JournalStore: not open — call open() first');
    return this.clock.issue();
  }

  /** List this actor's own published segments over HTTP. The platform's
   * GET /burrito/paths/<repoPath> walks the real ingredients/ tree (not the
   * indexed table), so segments written without update_ingredients appear
   * immediately. Filenames are accepted ONLY on an exact R-8.1.2 encoding
   * round-trip — a misnamed file is invisible as a segment and reported
   * (R-8.1.7 posture), never silently read. */
  async readOwnSegments(): Promise<OwnSegmentListing> {
    const prefix = `${this.segmentsDir}/`;
    const paths = await this.api.listPaths(this.repoPath);
    const segments: { name: string; ts: string }[] = [];
    const misnamed: string[] = [];
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length);
      if (name.includes('/')) continue; // deeper than the segments dir — not a segment
      const ts = segmentTs(name);
      if (isTs(ts) && segmentName(ts) === name) segments.push({ name, ts });
      else misnamed.push(name);
    }
    segments.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { segments, misnamed };
  }

  /** Publish one action: seal → stage → write, per the reference semantics over
   * HTTP. The sealed bytes are byte-identical to the reference sealAction's for
   * the same events (asserted by the group-A conformance test). Immutability
   * branches (R-8.1.4/5): path free → write; identical bytes → idempotent
   * accept; different VALID bytes → refuse with the accepted bytes untouched;
   * existing INVALID bytes → refuse (recovery only via replayStaged). */
  async publish(events: JournalEvent[]): Promise<PublishResult> {
    const actorId = this.actorId; // throws before any work when not open
    // Seal first (validate → normalize → re-validate → size cap R-8.1.9): a
    // malformed or oversize action creates nothing — not even a staged intent.
    const sealed = await sealAction(events);
    // Actor binding, writer side (R-8.1.12): every event must carry THIS
    // store's derived actor — refuse before any write.
    const foreign = events.find((event) => event.actor !== actorId);
    if (foreign)
      throw new Error(
        `refuse to publish: event actor "${foreign.actor}" is not this store's actor "${actorId}" (R-8.1.12)`,
      );
    const name = segmentName(events[0].ts);
    const ipath = `${this.segmentsDir}/${name}`;
    const pathErr = ipathError(ipath);
    if (pathErr) throw new Error(`segment ipath ${pathErr} — refuse to write (§2/§8.1)`);

    // STAGE the exact sealed bytes BEFORE the HTTP write (durable intent,
    // R-8.1.8): a crash between here and the accept replays the same bytes via
    // replayStaged(). The four-way recovery CLASSIFIER is issue #62's; this
    // store guarantees only staged-intent-then-publish (the D50 split).
    // Defense in depth (review finding F2): stage with setIfAbsent, so a
    // DIFFERENT staged action at this key is REFUSED, never silently replaced.
    // The shared clock already makes a same-process duplicate ts impossible;
    // this catches a duplicate that arrives any other way (a crash-era intent, a
    // second process). Byte-identical re-staging stays idempotent — that is a
    // retry of the same publish.
    const stageKey = `${this.outboxPrefix}${events[0].ts}`;
    const staged = await this.kv.setIfAbsent(stageKey, sealed);
    if (staged !== sealed)
      throw new Error(
        `refuse to stage: the outbox already holds a DIFFERENT action at ts ${events[0].ts} — ` +
          'publish it or replay it first (R-8.1.8, D50 staging)',
      );

    const result = await withPathLock(
      `${this.repoPath} ${ipath}`,
      async (): Promise<PublishResult> => {
        const existing = await this.readOrNull(ipath);
        if (existing !== null) {
          if (existing === sealed) return { ipath, idempotent: true }; // R-8.1.5 idempotent accept
          if ((await validateSegment(existing)).ok)
            throw new Error(
              `segment ${name} already accepted with different bytes — refuse to overwrite (R-8.1.5)`,
            );
          throw new Error(
            `segment ${name} exists but is invalid — recover via replayStaged() with the staged intent (R-8.1.8)`,
          );
        }
        await this.writeJournalFile(ipath, sealed);
        return { ipath, idempotent: false };
      },
    );
    // Confirmed accept (fresh write or idempotent): the staged intent is done.
    await this.kv.delete(stageKey);
    return result;
  }

  /** Replay every staged outbox intent for this repoPath+actorId (the §8.1
   * asymmetric recovery rule, R-8.1.8): an absent or INVALID segment is
   * replaced by the EXACT staged bytes; a byte-identical segment clears the
   * stage; a DIFFERENT valid segment refuses. Events are never regenerated — a
   * re-minted event would get a new ts and duplicate the action (D50 v2 §3:
   * retries replay exact bytes). */
  async replayStaged(): Promise<ReplayResult[]> {
    const actorId = this.actorId;
    const results: ReplayResult[] = [];
    for (const key of (await this.kv.keys(this.outboxPrefix)).sort()) {
      const ts = key.slice(this.outboxPrefix.length);
      const staged = await this.kv.get(key);
      if (staged === undefined) continue; // cleared concurrently
      const verdict = await validateSegment(staged);
      if (!verdict.ok) {
        // The staged intent itself is invalid: never write it, never delete it
        // silently — surface it for #62's classifier.
        results.push({ ts, outcome: 'staged-invalid', reason: verdict.reason });
        continue;
      }
      const stagedForeign = verdict.events.find((event) => event.actor !== actorId);
      if (stagedForeign) {
        results.push({
          ts,
          outcome: 'staged-invalid',
          reason: `actor-mismatch:${stagedForeign.actor}`,
        });
        continue;
      }
      const name = segmentName(verdict.events[0].ts);
      const ipath = `${this.segmentsDir}/${name}`;
      const result = await withPathLock(
        `${this.repoPath} ${ipath}`,
        async (): Promise<ReplayResult> => {
          const existing = await this.readOrNull(ipath);
          if (existing !== null) {
            if (existing === staged) return { ts, outcome: 'already-published' };
            if ((await validateSegment(existing)).ok)
              return {
                ts,
                outcome: 'conflict',
                reason: 'a different valid segment holds the path',
              };
          }
          await this.writeJournalFile(ipath, staged);
          return { ts, outcome: 'republished' };
        },
      );
      if (result.outcome === 'republished' || result.outcome === 'already-published')
        await this.kv.delete(key);
      results.push(result);
    }
    return results;
  }
}
