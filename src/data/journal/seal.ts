// Sealing and validation of journal segments over Web Crypto — BURRITO-SPEC §8.1.
//
// The PURE reference modules (journal/{grammar,schema,hlc}.mjs) are
// imported DIRECTLY — one validator, never a port that can drift. Only the pieces
// of journal/files.mjs that are welded to Node (fs paths, Buffer,
// node:crypto's synchronous sha256) are restated here over TextEncoder +
// crypto.subtle, and a conformance test asserts BYTE-equality of this seal with
// the reference sealAction for the same events (test/journalStore.test.ts, group
// A), so the two cannot drift silently.
import { validateAction, normalizeEvent } from '../../../journal/schema.mjs';
import {
  tsError,
  actorSlugError,
  isoInstantError,
  isObj,
  isStr,
} from '../../../journal/grammar.mjs';

/** One journal event as the store handles it. Shape/grammar validation is the
 * reference schema's job (validateAction/validateEvent) — this type only states
 * the envelope fields the store itself dereferences. */
export interface JournalEvent {
  v: number;
  op: string;
  actor: string;
  ts: string;
  base?: string | null;
  [field: string]: unknown;
}

export const SEGMENT_LIMIT = 4 * 1024 * 1024; // 4 MiB (§8.1, R-8.1.9)
/** The container frame allowance — MUST match the reference files.mjs value, so
 * the store and the reference refuse the same oversize actions. EXPORTED for the
 * boundary-parity test, which computes the exact accept/refuse boundary from
 * this constant instead of a hardcoded byte count (review finding F6,
 * 2026-08-19: a divergence here used to survive the whole suite). */
export const CONTAINER_FRAME = 128;

const utf8ByteLength = (text: string): number => new TextEncoder().encode(text).length;

/** sha256 of the UTF-8 bytes of `text`, lowercase hex — crypto.subtle (async)
 * where the reference uses node:crypto (sync). Same bytes, same hex. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Seal one action — the reference files.mjs sealAction, byte-for-byte, over Web
 * Crypto: validate the caller's raw action FIRST (a non-NFC identity value and a
 * `__proto__` own key are REFUSED, never quietly rewritten), then normalize (I-4:
 * content NFC'd), re-validate the normalized copy, then build the R-8.1.1
 * container over the exact body string. */
export const sealAction = async (eventsIn: JournalEvent[]): Promise<string> => {
  const rawErr = validateAction(eventsIn);
  if (rawErr) throw new Error(`refuse to seal a malformed action (${rawErr}) — §8.1/§8.5 schema`);
  const events = eventsIn.map(normalizeEvent);
  const err = validateAction(events);
  if (err) throw new Error(`I-4 normalization produced a malformed action (${err}) — §8.5`);
  const body = JSON.stringify({ events });
  // cheap first: the body alone already exceeds the cap, so never pay for the container
  if (utf8ByteLength(body) > SEGMENT_LIMIT - CONTAINER_FRAME)
    throw new Error(`action segment exceeds the 4 MiB limit (§8.1)`);
  const seg = JSON.stringify({ container: 1, body, sha256: await sha256Hex(body) });
  if (utf8ByteLength(seg) > SEGMENT_LIMIT)
    throw new Error(`action segment exceeds the 4 MiB limit (§8.1)`);
  return seg;
};

export type SegmentVerdict = { ok: true; events: JournalEvent[] } | { ok: false; reason: string };

/** Validate one segment's bytes — the reference files.mjs validateSegment over
 * Web Crypto. Parse outer → container:1 → sha256 over the exact body string →
 * parse body → events → the ONE action schema. Any failure = the WHOLE segment
 * is unpublished (R-8.1.6). */
export const validateSegment = async (raw: string): Promise<SegmentVerdict> => {
  if (utf8ByteLength(raw) > SEGMENT_LIMIT) return { ok: false, reason: 'oversize' };
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'outer-parse' };
  }
  const container = outer as { container?: unknown; body?: unknown; sha256?: unknown } | null;
  if (
    !container ||
    container.container !== 1 ||
    typeof container.body !== 'string' ||
    typeof container.sha256 !== 'string'
  )
    return { ok: false, reason: 'container-shape' };
  if ((await sha256Hex(container.body)) !== container.sha256)
    return { ok: false, reason: 'checksum' };
  let body: { events?: unknown } | null;
  try {
    body = JSON.parse(container.body) as { events?: unknown } | null;
  } catch {
    return { ok: false, reason: 'body-parse' };
  }
  if (!body || !Array.isArray(body.events)) return { ok: false, reason: 'no-events' };
  const err = validateAction(body.events);
  if (err) return { ok: false, reason: err };
  return { ok: true, events: body.events as JournalEvent[] };
};

export interface ActorDoc {
  schemaVersion: 1;
  actorId: string;
  createdAt: string;
  displayName?: string;
  device?: string;
}

export type ActorDocVerdict = { ok: true; doc: ActorDoc } | { ok: false; reason: string };

/** Validate one actor.json's bytes — the reference files.mjs validateActorDoc,
 * restated over the SAME imported grammar validators (actorSlugError,
 * isoInstantError), so the rules cannot drift; group-A tests additionally assert
 * agreement with the reference on the store's own writes. R-8.1.13:
 * {schemaVersion: 1, actorId, displayName?, device?, createdAt} — actorId MUST
 * match the directory, createdAt is a fixed-width ISO-8601 UTC instant. */
export const validateActorDoc = (raw: string, actorId: string): ActorDocVerdict => {
  let doc: unknown;
  try {
    doc = JSON.parse(String(raw));
  } catch {
    return { ok: false, reason: 'parse' };
  }
  if (!isObj(doc)) return { ok: false, reason: 'shape' };
  const candidate = doc as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return { ok: false, reason: 'schema-version' };
  const slugErr = actorSlugError(candidate.actorId);
  if (slugErr) return { ok: false, reason: `actor-slug:${slugErr}` };
  if (candidate.actorId !== actorId)
    return { ok: false, reason: `actor-mismatch:${String(candidate.actorId)}` };
  const createdErr = isoInstantError(candidate.createdAt);
  if (createdErr) return { ok: false, reason: `created-at:${createdErr}` };
  for (const field of ['displayName', 'device'])
    if (candidate[field] !== undefined && !isStr(candidate[field]))
      return { ok: false, reason: `${field}-type` };
  return { ok: true, doc: candidate as unknown as ActorDoc };
};

/** Filename per R-8.1.2: the action's first event ts with ':' → '_' and
 * '|' → ',', suffixed '.action.json'. The escape is injective only over the ts
 * GRAMMAR, so the encoder REFUSES a non-ts (reference files.mjs segmentName). */
export const segmentName = (ts: string): string => {
  const err = tsError(ts);
  if (err) throw new Error(`segment name requires an §8.2 ts — ${err}`);
  return `${ts.replaceAll(':', '_').replaceAll('|', ',')}.action.json`;
};

/** The inverse of segmentName. Round-trip discipline (R-8.1.7 posture): accept a
 * file ONLY when segmentName(segmentTs(name)) === name — anything else is
 * misnamed and therefore invisible-and-reported, never silently read. */
export const segmentTs = (name: string): string =>
  String(name)
    .replace(/\.action\.json$/, '')
    .replaceAll(',', '|')
    .replaceAll('_', ':');
