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
import { actorSlugError, ipathError, isTs } from '../../../conformance/journal/grammar.mjs';
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

/** One correctly named, VALID segment of one actor. `ts` is the first event's ts
 * (= the filename, R-8.1.2); `maxTs` is the LAST event's ts, which is the
 * action's maximum because validateAction refuses an action whose events are not
 * strictly ascending in ts (conformance/journal/schema.mjs, 'ts-order'). */
interface ValidSegment {
  name: string;
  ts: string;
  maxTs: string;
  /** The validated action's events — classified once, never re-read (readUnion). */
  events: JournalEvent[];
}

/** One correctly named segment whose BYTES are unusable, with the reason
 * validateSegment (or the actor/filename binding) gave. */
interface InvalidSegment {
  name: string;
  reason: string;
}

/** One actor's segments directory, classified. Nothing is dropped in silence:
 * every listed file is in exactly one of the three arrays (R-8.1.7). */
interface SegmentListing {
  /** Segments that are VALID — the name round-trips the R-8.1.2 encoding, the
   * bytes pass validateSegment, every event carries the directory's actor
   * (R-8.1.12), and the name equals the first event's ts. Filename-sorted
   * (= ts-sorted, R-8.1.2). */
  segments: ValidSegment[];
  /** Files whose name does not round-trip the R-8.1.2 encoding: invisible as
   * segments, reported here (R-8.1.7 posture). */
  misnamed: string[];
  /** Correctly NAMED files whose bytes or bindings fail, with the reason. A
   * torn file under a perfect filename used to be reported as valid history
   * (review finding P2, 2026-08-19). */
  invalid: InvalidSegment[];
}

export type OwnSegmentListing = SegmentListing;

const JOURNAL_PREFIX = 'checking/journal/';

/** Group every `checking/journal/<actorId>/segments/<name>` path of ONE paths
 * listing by actor slug — EVERY actor, not just this store's (R-8.2.4 ratchets
 * past received events, and a merged or imported stream is received).
 *
 * A journal directory whose name is not an §8.1 actor slug (R-8.1.11) stands for
 * no actor, and a path deeper than `segments/` is not a segment; neither is read,
 * exactly as the reference readUnion resolves actor directories through
 * actorDirFor before it reads anything. */
const groupSegmentPaths = (paths: string[]): Map<string, string[]> => {
  const byActor = new Map<string, string[]>();
  for (const path of paths) {
    if (!path.startsWith(JOURNAL_PREFIX)) continue;
    const parts = path.slice(JOURNAL_PREFIX.length).split('/');
    if (parts.length !== 3 || parts[1] !== 'segments') continue;
    const [actor, , name] = parts;
    if (actorSlugError(actor)) continue;
    const names = byActor.get(actor);
    if (names) names.push(name);
    else byActor.set(actor, [name]);
  }
  return byActor;
};

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
      if (!verdict.ok) {
        // Issue #62 repair rule: repair a TORN own actor.json — and ONLY that.
        // This ipath is derived from the actor id THIS installation derives for
        // this project, so a parseable record inside it that names a DIFFERENT
        // actor is somebody's valid-looking record on our path: never overwrite
        // it — that is identity evidence, surfaced for a human. A record that is
        // simply unusable bytes (torn write, wrong shape, malformed createdAt)
        // is repaired by re-provisioning the deterministic document.
        if (verdict.reason.startsWith('actor-mismatch:'))
          throw new Error(
            `refuse to open journal: existing ${this.actorIpath} is a valid-shaped record ` +
              `for a different actor (${verdict.reason}) — never overwritten (R-8.1.13, #62)`,
          );
        const repaired: ActorDoc = {
          schemaVersion: 1,
          actorId,
          createdAt: new Date(this.now()).toISOString(),
          device: DEFAULT_DEVICE_LABEL,
        };
        await this.writeJournalFile(this.actorIpath, JSON.stringify(repaired, null, 2));
        return repaired;
      }
      return verdict.doc;
    });

    // The SHARED clock for this identity (§8.2), then RATCHET it (R-8.2.4) past
    // EVERY ts this store can see.
    this.clock = clockFor(this.repoPath, actorId, this.now);
    await this.ratchetFromJournal(this.clock, actorId);

    return { actorId, actorDoc };
  }

  /** Ratchet the clock past the maximum ts of every event this store can see
   * (R-8.2.4), in three parts: this actor's published segments, EVERY OTHER
   * actor's segments (an imported or merged stream is "received"), and this
   * actor's staged-but-unpublished outbox intents.
   *
   * The ratchet used to read only own segment FILENAMES and outbox KEY suffixes.
   * Both carry an action's FIRST ts, so the second event of a two-event action
   * was never ratcheted past: a restart at the same physical millisecond
   * re-issued a ts an ACCEPTED event already held. Event identity IS the ts and
   * the union de-duplicates by it (R-8.2.5), so one of the two events would
   * silently disappear (review finding P1-1, 2026-08-19).
   *
   * COST: this reads every segment of every actor — O(all segments) per open().
   * The cheaper "read only each actor's highest-sorting segment" rule was
   * REJECTED after checking the encoding and the validator: filename order is
   * FIRST-event order (R-8.1.2) and validateAction only orders events WITHIN one
   * action, so nothing forbids an earlier-named action from carrying a LATER
   * event. A caller that mints `t1`, then `t2`, publishes `[t2]` first and then
   * `[t1, t3]` produces exactly that, and every rule still holds — so the
   * one-segment-per-actor proof fails, and a foreign stream is untrusted anyway. */
  private async ratchetFromJournal(
    clock: ReturnType<typeof makeClock>,
    actorId: string,
  ): Promise<void> {
    const byActor = groupSegmentPaths(await this.api.listPaths(this.repoPath));
    for (const [actor, names] of byActor) {
      const listing = await this.classifySegments(actor, names);
      for (const segment of listing.segments) clock.ratchet(segment.maxTs);
      // An OWN segment whose bytes are invalid still ratchets from its FILENAME
      // ts: this actor minted that ts, and a staged intent may yet republish it,
      // so it must never be re-issued. A foreign actor's invalid segment carries
      // no received event — R-8.2.4 speaks of events, so there is nothing to take.
      if (actor === actorId)
        for (const entry of listing.invalid) clock.ratchet(segmentTs(entry.name));
    }
    for (const key of await this.kv.keys(this.outboxPrefix)) {
      const ts = key.slice(this.outboxPrefix.length);
      if (isTs(ts)) clock.ratchet(ts); // the key suffix — the action's FIRST ts
      const staged = await this.kv.get(key);
      if (staged === undefined) continue; // cleared concurrently
      const verdict = await validateSegment(staged); // validate BEFORE trusting the body
      if (!verdict.ok) continue; // unusable bytes: the key suffix is all there is
      clock.ratchet(verdict.events[verdict.events.length - 1].ts); // ascending: the last IS the max
    }
  }

  /** Read and classify one actor's segment files. A name is accepted only on an
   * exact R-8.1.2 encoding round-trip; the bytes are then validated (R-8.1.6),
   * every event must carry the directory's actor (R-8.1.12), and the filename
   * must equal the first event's ts (R-8.1.2). Every listed file lands in exactly
   * one of the three arrays — nothing is dropped in silence (R-8.1.7). */
  private async classifySegments(actorId: string, names: string[]): Promise<SegmentListing> {
    const dir = `${JOURNAL_PREFIX}${actorId}/segments`;
    const segments: ValidSegment[] = [];
    const misnamed: string[] = [];
    const invalid: InvalidSegment[] = [];
    for (const name of names) {
      const ts = segmentTs(name);
      if (!isTs(ts) || segmentName(ts) !== name) {
        misnamed.push(name);
        continue;
      }
      const raw = await this.readOrNull(`${dir}/${name}`);
      if (raw === null) {
        invalid.push({ name, reason: 'vanished' }); // listed, then gone
        continue;
      }
      const verdict = await validateSegment(raw);
      if (!verdict.ok) {
        invalid.push({ name, reason: verdict.reason });
        continue;
      }
      const foreign = verdict.events.find((event) => event.actor !== actorId);
      if (foreign) {
        invalid.push({ name, reason: `actor-mismatch:${foreign.actor}` });
        continue;
      }
      if (verdict.events[0].ts !== ts) {
        invalid.push({ name, reason: `segment-misnamed:${name}` });
        continue;
      }
      segments.push({
        name,
        ts,
        maxTs: verdict.events[verdict.events.length - 1].ts,
        events: verdict.events,
      });
    }
    segments.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    misnamed.sort();
    invalid.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { segments, misnamed, invalid };
  }

  /** Issue the next §8.2 HLC ts for this actor. */
  issueTs(): string {
    if (this.clock === null) throw new Error('JournalStore: not open — call open() first');
    return this.clock.issue();
  }

  /** List this actor's own published segments over HTTP. The platform's
   * GET /burrito/paths/<repoPath> walks the real ingredients/ tree (not the
   * indexed table), so segments written without update_ingredients appear
   * immediately.
   *
   * A file reaches `segments` only when it is VALID, not merely well named: the
   * name must round-trip the R-8.1.2 encoding, the BYTES must pass
   * validateSegment (R-8.1.6), every event must carry this actor (R-8.1.12), and
   * the name must equal the first event's ts. A misnamed file lands in
   * `misnamed`, a correctly named unusable one in `invalid` with its reason —
   * neither is ever dropped in silence (R-8.1.7 posture). */
  async readOwnSegments(): Promise<OwnSegmentListing> {
    const actorId = this.actorId;
    const byActor = groupSegmentPaths(await this.api.listPaths(this.repoPath));
    return this.classifySegments(actorId, byActor.get(actorId) ?? []);
  }

  /** Read EVERY actor's segments and return the union of accepted events plus a
   * complete account of everything unusable (R-8.1.7: nothing dropped in
   * silence). Issue #62's open() folds this union; its recovery classifier
   * decides what an `invalid` entry means (an own invalid segment may be
   * republished from the outbox; any left over is a diagnosable stop). */
  async readUnion(): Promise<{
    events: JournalEvent[];
    actors: string[];
    misnamed: Array<{ actor: string; name: string }>;
    invalid: Array<{ actor: string; name: string; reason: string }>;
  }> {
    const own = this.actorId; // throws before any read when not open
    const byActor = groupSegmentPaths(await this.api.listPaths(this.repoPath));
    if (!byActor.has(own)) byActor.set(own, []);
    const events: JournalEvent[] = [];
    const misnamed: Array<{ actor: string; name: string }> = [];
    const invalid: Array<{ actor: string; name: string; reason: string }> = [];
    const actors = [...byActor.keys()].sort();
    for (const actor of actors) {
      const listing = await this.classifySegments(actor, byActor.get(actor) ?? []);
      for (const name of listing.misnamed) misnamed.push({ actor, name });
      for (const entry of listing.invalid) invalid.push({ actor, ...entry });
      for (const segment of listing.segments) events.push(...segment.events);
    }
    return { events, actors, misnamed, invalid };
  }

  /** Durably stage one action WITHOUT publishing it — the seed path (issue #62):
   * a multi-part universal seed stages EVERY part before the first publish, so a
   * crash mid-publication leaves nothing half-intended; replayStaged() finishes
   * the set with the exact staged bytes. Same seal, same actor binding, same
   * setIfAbsent duplicate refusal as publish(). Returns the staged ts. */
  async stage(events: JournalEvent[]): Promise<string> {
    const actorId = this.actorId;
    const sealed = await sealAction(events);
    const foreign = events.find((event) => event.actor !== actorId);
    if (foreign)
      throw new Error(
        `refuse to stage: event actor "${foreign.actor}" is not this store's actor "${actorId}" (R-8.1.12)`,
      );
    const stageKey = `${this.outboxPrefix}${events[0].ts}`;
    const staged = await this.kv.setIfAbsent(stageKey, sealed);
    if (staged !== sealed)
      throw new Error(
        `refuse to stage: the outbox already holds a DIFFERENT action at ts ${events[0].ts} — ` +
          'publish it or replay it first (R-8.1.8, D50 staging)',
      );
    return events[0].ts;
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
