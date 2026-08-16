// Journal file I/O — BURRITO-SPEC §8.1 reference implementation (spec 1.8, D50 write model).
// ONE stream form (round-5 simplification — the pre-ratification legacy NDJSON
// read-compat form is deleted; no released project ever contained it): every mutation
// publishes as ONE immutable sealed action segment
// (journal/<actorId>/segments/<encoded-ts>.action.json, container + body-string sha256,
// 4 MiB cap), and readers read nothing else.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateAction } from './schema.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const SEGMENT_LIMIT = 4 * 1024 * 1024; // 4 MiB (§8.1)

// Filename: the action's first event ts with ':' → '_' and '|' → ','  (§8.1). ':' and '|'
// are the two ts characters reserved in Windows filenames ('|' is also §2-forbidden);
// '_' and ',' never occur in a raw ts, so the escape is injective and reversible. The
// escaped characters sit at fixed positions (§8.2), so filename sort = ts sort within an
// actor directory.
export const segmentName = (ts) => `${String(ts).replaceAll(':', '_').replaceAll('|', ',')}.action.json`;
export const segmentTs = (name) =>
  String(name).replace(/\.action\.json$/, '').replaceAll(',', '|').replaceAll('_', ':');

// Defense in depth (§8.1, round 6): the final segment path MUST resolve strictly inside
// the actor's segments directory — independent of the schema's §8.2 ts grammar, a
// ts-shaped value can never smuggle a filesystem path past the writer.
export const segmentPathFor = (actorDir, ts) => {
  const dir = path.resolve(actorDir, 'segments');
  const file = path.resolve(dir, segmentName(ts));
  if (path.dirname(file) !== dir)
    throw new Error(`segment path for ts "${ts}" escapes the actor segments directory — refuse to write (§8.1)`);
  return file;
};

// Seal one action (all events of ONE store mutation, ts order, one actor; multi-scope
// allowed). The writer applies the SAME schema the reader/intake applies (§8.1) —
// writer-symmetric by construction.
export const sealAction = (events) => {
  const err = validateAction(events);
  if (err) throw new Error(`refuse to seal a malformed action (${err}) — §8.1/§8.5 schema`);
  const body = JSON.stringify({ events });
  const seg = JSON.stringify({ container: 1, body, sha256: sha256(body) });
  if (Buffer.byteLength(seg, 'utf8') > SEGMENT_LIMIT)
    throw new Error(`action segment exceeds the 4 MiB limit (§8.1)`);
  return seg;
};

// Accepted segments are IMMUTABLE (§8.1). Write branches:
//   1. path free → write;
//   2. existing bytes identical → idempotent accept (retry after a lost ack);
//   3. existing VALID but different → REJECT (accepted history is never overwritten);
//   4. existing INVALID → REJECT here too — recovery goes through republishSegment,
//      which verifies the staged intent before it may overwrite.
export const writeActionSegment = (actorDir, events) => {
  // order of operations (round 6): validate FIRST (seal = the schema), derive the
  // guarded path SECOND, touch the filesystem LAST — a malformed action creates nothing.
  const sealed = sealAction(events);
  const file = segmentPathFor(actorDir, events[0].ts);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing === sealed) return file; // idempotent accept
    if (validateSegment(existing).ok)
      throw new Error(`segment ${path.basename(file)} already accepted with different bytes — refuse to overwrite (§8.1)`);
    throw new Error(`segment ${path.basename(file)} exists but is invalid — recover via republishSegment with staged intent (§8.1)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sealed);
  return file;
};

// §8.1 asymmetric rule, local side: an INVALID (or absent) segment may be replaced by
// the EXACT staged bytes from the durable outbox — after verifying the staged action
// itself. A VALID existing segment is never overwritten.
export const republishSegment = (actorDir, stagedBytes) => {
  const r = validateSegment(stagedBytes);
  if (!r.ok) throw new Error(`staged intent is itself invalid (${r.reason}) — refuse to republish`);
  const file = segmentPathFor(actorDir, r.events[0].ts);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing === stagedBytes) return file; // already published
    if (validateSegment(existing).ok)
      throw new Error(`segment ${path.basename(file)} is valid and differs from the staged intent — refuse to overwrite (§8.1)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stagedBytes);
  return file;
};

// Validate one actor.json's bytes against §8.1/§8.7 — ONE validator (round 7), shared by
// the in-process intake (J20) and the live transport intake: the shape MUST validate
// ({schemaVersion: 1, actorId, …}) and actorId MUST match the actor directory.
export const validateActorDoc = (raw, actorId) => {
  let doc;
  try { doc = JSON.parse(String(raw)); } catch { return { ok: false, reason: 'parse' }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, reason: 'shape' };
  if (doc.schemaVersion !== 1) return { ok: false, reason: 'schema-version' };
  if (doc.actorId !== actorId) return { ok: false, reason: `actor-mismatch:${doc.actorId}` };
  return { ok: true, doc };
};

// Validate one segment's bytes. Parse outer → container:1 → sha256 over the exact body
// string's UTF-8 bytes → parse body → events array. Any failure = the WHOLE segment is
// unpublished (§8.1: parse/checksum validity IS the commit marker).
export const validateSegment = (raw) => {
  if (Buffer.byteLength(raw, 'utf8') > SEGMENT_LIMIT) return { ok: false, reason: 'oversize' };
  let outer;
  try { outer = JSON.parse(raw); } catch { return { ok: false, reason: 'outer-parse' }; }
  if (!outer || outer.container !== 1 || typeof outer.body !== 'string' || typeof outer.sha256 !== 'string')
    return { ok: false, reason: 'container-shape' };
  if (sha256(outer.body) !== outer.sha256) return { ok: false, reason: 'checksum' };
  let body;
  try { body = JSON.parse(outer.body); } catch { return { ok: false, reason: 'body-parse' }; }
  if (!body || !Array.isArray(body.events)) return { ok: false, reason: 'no-events' };
  // The ONE declarative schema (§8.1/§8.3/§8.5): action shape + every event's envelope
  // and per-op payload — the same validator the writer sealed with.
  const err = validateAction(body.events);
  if (err) return { ok: false, reason: err };
  return { ok: true, events: body.events };
};

// Read one actor's sealed segments in filename (= ts) order. Invalid segments are
// invisible as a whole; they are reported to `onInvalid` so the caller can apply the
// §8.1 asymmetric rule (local: republish-from-staged-intent or report; intake: reject).
// There is NO silent default: a caller that passes no handler gets a throw — invalidity
// must always surface.
const surfaceInvalid = (file, reason) => {
  throw new Error(`invalid segment ${file} (${reason}) — pass onInvalid to apply the §8.1 recovery/rejection rule`);
};
export const readSegments = (actorDir, onInvalid = surfaceInvalid) => {
  const dir = path.join(actorDir, 'segments');
  if (!fs.existsSync(dir)) return [];
  const actor = path.basename(actorDir);
  const events = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).sort()) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const r = validateSegment(raw);
    if (!r.ok) { onInvalid(path.join(dir, f), r.reason); continue; }
    const foreign = r.events.find((e) => e.actor !== actor);
    if (foreign) { onInvalid(path.join(dir, f), `actor-mismatch:${foreign.actor}`); continue; }
    events.push(...r.events);
  }
  return events;
};

// Union across every actor under journal/: sealed segments — the only stream form.
// The invalid-segment default surfaces (throws) — reading with tolerance requires an
// explicit onInvalid handler, which is also how incompleteness is reported.
export const readUnion = (journalDir, onInvalid = surfaceInvalid) => {
  if (!fs.existsSync(journalDir)) return [];
  const events = [];
  for (const actor of fs.readdirSync(journalDir)) {
    const dir = path.join(journalDir, actor);
    if (!fs.statSync(dir).isDirectory()) continue;
    events.push(...readSegments(dir, onInvalid));
  }
  return events;
};
