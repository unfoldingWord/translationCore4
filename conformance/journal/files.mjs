// Journal file I/O — BURRITO-SPEC §8.1 reference implementation (spec 1.8, D50 write model).
// ONE stream form (round-5 simplification — the pre-ratification legacy NDJSON
// read-compat form is deleted; no released project ever contained it): every mutation
// publishes as ONE immutable sealed action segment
// (journal/<actorId>/segments/<encoded-ts>.action.json, container + body-string sha256,
// 4 MiB cap), and readers read nothing else.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateAction, normalizeEvent } from './schema.mjs';
import { actorSlugError, isoInstantError, ipathError, tsError, isStr, isObj } from './grammar.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const SEGMENT_LIMIT = 4 * 1024 * 1024; // 4 MiB (§8.1)
// The container adds `{"container":1,"body":…,"sha256":"<64 hex>"}` plus the JSON escaping
// of the body string. The body can therefore never be larger than the cap minus this
// frame — which is what lets the writer refuse an oversize action BEFORE it pays for the
// second serialization (a raw RangeError used to come out of the seal on huge input).
const CONTAINER_FRAME = 128;

// ---------- §8.1 containment is a FILESYSTEM guarantee, not a lexical one ----------
// A lexical check reads a DANGLING SYMLINK as "path free", so the immutability branch is
// skipped and the write lands OUTSIDE the project; it reads a SYMLINKED `segments`
// directory as contained, so the whole stream relocates; and the reader follows both.
// lstat + realpath + O_NOFOLLOW close all three at the syscall, where the guarantee lives.
// SCOPE (measured): the remote vector does not exist — git carries a symlink as a blob
// whose content fails validateSegment — so this guards LOCAL media and backup restore,
// and intake needs nothing added.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const READ_NOFOLLOW = fs.constants.O_RDONLY | O_NOFOLLOW;
const WRITE_NOFOLLOW = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW;
const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };

// §8.1: an actor directory is named by the actor SLUG, and the slug IS the actor
// identity. `readSegments(journalDir + "actor-a/../actor-b")` used to return actor-b's
// stream while the caller believed it held actor-a's — the reader derived the identity by
// basename AFTER path normalization had erased the traversal. ONE constructor applies the
// slug grammar; every reader and writer resolves through it.
export const actorDirFor = (journalDir, actorId) => {
  const err = actorSlugError(actorId);
  if (err) throw new Error(`actor directory ${err} — refuse (§8.1)`);
  const root = path.resolve(journalDir);
  const dir = path.resolve(root, actorId);
  if (path.dirname(dir) !== root)
    throw new Error(`actor directory "${actorId}" escapes the journal root — refuse (§8.1)`);
  return dir;
};

// The actor a directory stands for. A supplied path that carries a traversal segment
// names one directory and resolves to another — never a typo, always a bypass.
export const actorOf = (actorDir) => {
  if (String(actorDir).split(/[\\/]/).some((s) => s === '..' || s === '.'))
    throw new Error(`actor directory "${actorDir}" carries a traversal segment — resolve it with actorDirFor(journalDir, actorId) (§8.1)`);
  const name = path.basename(path.resolve(actorDir));
  const err = actorSlugError(name);
  if (err) throw new Error(`actor directory name ${err} — refuse (§8.1)`);
  return name;
};

// The actor's segments directory, proven to be a real directory inside the actor
// directory — not a symlink pointing anywhere else.
const segmentsDirOf = (actorDir) => {
  const dir = path.resolve(actorDir, 'segments');
  const st = lstatOrNull(dir);
  if (st === null) return dir; // absent: mkdirSync creates a real directory below
  if (!st.isDirectory())
    throw new Error(`the actor segments path is a ${st.isSymbolicLink() ? 'symlink' : 'non-directory'} — refuse (§8.1 containment)`);
  if (path.dirname(fs.realpathSync(dir)) !== fs.realpathSync(actorDir))
    throw new Error(`the actor segments directory resolves outside its actor directory — refuse (§8.1 containment)`);
  return dir;
};

// Filename: the action's first event ts with ':' → '_' and '|' → ','  (§8.1). ':' and '|'
// are the two ts characters reserved in Windows filenames ('|' is also §2-forbidden);
// '_' and ',' never occur in a raw ts, so the escape is injective and reversible. The
// escaped characters sit at fixed positions (§8.2), so filename sort = ts sort within an
// actor directory. Injectivity holds only over the ts GRAMMAR — `a:b` and `a_b` encode to
// the same name — so the encoder REFUSES a non-ts, rather than depending on a caller to
// have checked (layer-2 independence, §8.1).
export const segmentName = (ts) => {
  const err = tsError(ts);
  if (err) throw new Error(`segment name requires an §8.2 ts — ${err}`);
  return `${ts.replaceAll(':', '_').replaceAll('|', ',')}.action.json`;
};
export const segmentTs = (name) =>
  String(name).replace(/\.action\.json$/, '').replaceAll(',', '|').replaceAll('_', ':');

// Defense in depth (§8.1, round 6; extended rounds 8–9): the final segment path MUST
// resolve strictly inside the actor's REAL segments directory AND the encoded filename
// MUST satisfy the §2 ingredient-path segment grammar — independent of the schema's §8.2
// ts grammar, a ts-shaped value can never smuggle a filesystem path past the writer.
export const segmentPathFor = (actorDir, ts) => {
  const name = segmentName(ts);
  const nameErr = ipathError(name);
  if (nameErr) throw new Error(`segment name for ts "${ts}" ${nameErr} — refuse to write (§2/§8.1)`);
  const dir = segmentsDirOf(actorDir);
  const file = path.resolve(dir, name);
  if (path.dirname(file) !== dir)
    throw new Error(`segment path for ts "${ts}" escapes the actor segments directory — refuse to write (§8.1)`);
  return file;
};

// Seal one action (all events of ONE store mutation, ts order, one actor; multi-scope
// allowed). The writer applies the SAME schema the reader/intake applies (§8.1) —
// writer-symmetric by construction.
//
// This is also the ONE I-4 chokepoint (§8.5): every text a writer journals is normalized
// to Unicode NFC here, once, before the bytes exist. The order matters — validate the
// caller's action FIRST (so a non-NFC IDENTITY value and a `__proto__` own key are
// REFUSED, never quietly rewritten or swallowed), then normalize, then re-validate the
// normalized copy, so what is sealed is exactly what a reader will validate.
export const sealAction = (eventsIn) => {
  const rawErr = validateAction(eventsIn);
  if (rawErr) throw new Error(`refuse to seal a malformed action (${rawErr}) — §8.1/§8.5 schema`);
  const events = Array.isArray(eventsIn) ? eventsIn.map(normalizeEvent) : eventsIn;
  const err = validateAction(events);
  if (err) throw new Error(`I-4 normalization produced a malformed action (${err}) — §8.5`);
  const body = JSON.stringify({ events });
  // cheap first: the body alone already exceeds the cap, so never pay for the container
  if (Buffer.byteLength(body, 'utf8') > SEGMENT_LIMIT - CONTAINER_FRAME)
    throw new Error(`action segment exceeds the 4 MiB limit (§8.1)`);
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
  // §8.1 actor binding, WRITER side. Both intakes check that a segment's events name the
  // directory that carries them; the writer did not, so a device could publish another
  // actor's events into its own stream and only be caught downstream.
  const actor = actorOf(actorDir);
  const foreign = JSON.parse(JSON.parse(sealed).body).events.find((e) => e.actor !== actor);
  if (foreign)
    throw new Error(`refuse to write: event actor "${foreign.actor}" is not the actor directory "${actor}" (§8.1/§8.3 actor binding)`);
  const file = segmentPathFor(actorDir, events[0].ts);
  const existing = readSegmentFile(file); // lstat-guarded: a symlink REFUSES, it never reads through
  if (existing !== null) {
    if (existing === sealed) return file; // idempotent accept
    if (validateSegment(existing).ok)
      throw new Error(`segment ${path.basename(file)} already accepted with different bytes — refuse to overwrite (§8.1)`);
    throw new Error(`segment ${path.basename(file)} exists but is invalid — recover via republishSegment with staged intent (§8.1)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sealed, { flag: WRITE_NOFOLLOW });
  return file;
};

// Read one segment file, or null when the path is free. A symlink or any other
// non-regular file at a segment path is a containment violation, never data: `existsSync`
// reported a DANGLING symlink as free and the following write escaped the project.
const readSegmentFile = (file) => {
  const st = lstatOrNull(file);
  if (st === null) return null;
  if (!st.isFile())
    throw new Error(`segment path ${path.basename(file)} is a ${st.isSymbolicLink() ? 'symlink' : 'non-regular file'} — refuse to read or write through it (§8.1 containment)`);
  if (st.size > SEGMENT_LIMIT)
    return ''; // oversize: invalid by §8.1, and never read into memory
  return fs.readFileSync(file, { flag: READ_NOFOLLOW, encoding: 'utf8' });
};

// §8.1 asymmetric rule, local side: an INVALID (or absent) segment may be replaced by
// the EXACT staged bytes from the durable outbox — after verifying the staged action
// itself. A VALID existing segment is never overwritten.
export const republishSegment = (actorDir, stagedBytes) => {
  const r = validateSegment(stagedBytes);
  if (!r.ok) throw new Error(`staged intent is itself invalid (${r.reason}) — refuse to republish`);
  const actor = actorOf(actorDir);
  const foreign = r.events.find((e) => e.actor !== actor);
  if (foreign)
    throw new Error(`refuse to republish: event actor "${foreign.actor}" is not the actor directory "${actor}" (§8.1/§8.3 actor binding)`);
  const file = segmentPathFor(actorDir, r.events[0].ts);
  const existing = readSegmentFile(file);
  if (existing !== null) {
    if (existing === stagedBytes) return file; // already published
    if (validateSegment(existing).ok)
      throw new Error(`segment ${path.basename(file)} is valid and differs from the staged intent — refuse to overwrite (§8.1)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stagedBytes, { flag: WRITE_NOFOLLOW });
  return file;
};

// Validate one actor.json's bytes against §8.1/§8.7 — ONE validator (round 7), shared by
// the in-process intake (J20) and the live transport intake. §8.1 records
// `{schemaVersion: 1, actorId, displayName, device, createdAt}`, `displayName`/`device`
// OPTIONAL. Round 8: the actorId carries the §8.1 SLUG GRAMMAR (it is a directory name —
// a structural position), `createdAt` is REQUIRED and is a fixed-width ISO-8601 UTC
// instant (§8.2), and each optional metadata field is type-checked when present.
export const validateActorDoc = (raw, actorId) => {
  let doc;
  try { doc = JSON.parse(String(raw)); } catch { return { ok: false, reason: 'parse' }; }
  if (!isObj(doc)) return { ok: false, reason: 'shape' };
  if (doc.schemaVersion !== 1) return { ok: false, reason: 'schema-version' };
  const slugErr = actorSlugError(doc.actorId);
  if (slugErr) return { ok: false, reason: `actor-slug:${slugErr}` };
  if (doc.actorId !== actorId) return { ok: false, reason: `actor-mismatch:${doc.actorId}` };
  const createdErr = isoInstantError(doc.createdAt);
  if (createdErr) return { ok: false, reason: `created-at:${createdErr}` };
  for (const f of ['displayName', 'device'])
    if (doc[f] !== undefined && !isStr(doc[f])) return { ok: false, reason: `${f}-type` };
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
  const actor = actorOf(actorDir); // slug-validated, traversal-refused
  const dir = segmentsDirOf(actorDir); // proven a real directory inside the actor directory
  if (lstatOrNull(dir) === null) return [];
  const events = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).sort()) {
    const file = path.join(dir, f);
    const st = lstatOrNull(file);
    if (st === null) continue; // vanished between readdir and lstat
    if (!st.isFile()) { onInvalid(file, st.isSymbolicLink() ? 'containment:symlink' : 'containment:not-a-regular-file'); continue; }
    // the cap applies BEFORE the read, not after it: reading a 4 GiB file into a string
    // and then declaring it oversize costs ~3x its size in RSS to reach the same verdict
    if (st.size > SEGMENT_LIMIT) { onInvalid(file, 'oversize'); continue; }
    const raw = fs.readFileSync(file, { flag: READ_NOFOLLOW, encoding: 'utf8' });
    const r = validateSegment(raw);
    if (!r.ok) { onInvalid(file, r.reason); continue; }
    const foreign = r.events.find((e) => e.actor !== actor);
    if (foreign) { onInvalid(file, `actor-mismatch:${foreign.actor}`); continue; }
    // §8.1: the filename IS the first event's ts. BOTH intakes already check this; the
    // local reader did not — so one stray `.action.json` let a SECOND body publish at the
    // same ts, and the union then refused to fold at all ("two different events share
    // ts — corrupt union"): the project became PERMANENTLY unfoldable from one stray file.
    if (f !== segmentName(r.events[0].ts)) { onInvalid(file, `segment-misnamed:${f}`); continue; }
    events.push(...r.events);
  }
  return events;
};

// Union across every actor under journal/: sealed segments — the only stream form.
// The invalid-segment default surfaces (throws) — reading with tolerance requires an
// explicit onInvalid handler, which is also how incompleteness is reported. Actor
// directories are resolved through actorDirFor, so a non-slug or symlinked entry is
// reported, never silently read.
export const readUnion = (journalDir, onInvalid = surfaceInvalid) => {
  if (!fs.existsSync(journalDir)) return [];
  const events = [];
  for (const actor of fs.readdirSync(journalDir).sort()) {
    const st = lstatOrNull(path.join(journalDir, actor));
    if (st === null || !st.isDirectory()) {
      if (st && st.isSymbolicLink()) onInvalid(path.join(journalDir, actor), 'actor-dir:symlink');
      continue;
    }
    let dir;
    try { dir = actorDirFor(journalDir, actor); } catch (e) { onInvalid(path.join(journalDir, actor), `actor-dir:${e.message}`); continue; }
    events.push(...readSegments(dir, onInvalid));
  }
  return events;
};
