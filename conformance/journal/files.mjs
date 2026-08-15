// Journal file I/O — BURRITO-SPEC §8.1 reference implementation (spec 1.8, D50 write model).
// WRITE path: every mutation publishes as ONE immutable sealed action segment
// (journal/<actorId>/segments/<ts>.action.json, container + body-string sha256, 4 MiB cap).
// READ path: sealed segments PLUS the legacy NDJSON streams (read-compat only:
// <BOOK>.<seq>.jsonl / _project.<seq>.jsonl with the torn-tail rule).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const SEGMENT_LIMIT = 4 * 1024 * 1024; // 4 MiB (§8.1)

// Filename: the action's first event ts with each '|' replaced by '.'
// ('|' is a forbidden ingredient-path character, §2). Fixed-width fields keep sort order.
export const segmentName = (ts) => `${String(ts).replaceAll('|', '.')}.action.json`;

// Seal one action (all events of ONE store mutation, ts order, one actor; multi-scope allowed).
export const sealAction = (events) => {
  const body = JSON.stringify({ events });
  const seg = JSON.stringify({ container: 1, body, sha256: sha256(body) });
  if (Buffer.byteLength(seg, 'utf8') > SEGMENT_LIMIT)
    throw new Error(`action segment exceeds the 4 MiB limit (§8.1)`);
  return seg;
};

export const writeActionSegment = (actorDir, events) => {
  const dir = path.join(actorDir, 'segments');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, segmentName(events[0].ts));
  fs.writeFileSync(file, sealAction(events));
  return file;
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
  return { ok: true, events: body.events };
};

// Read one actor's sealed segments in filename (= ts) order. Invalid segments are
// invisible as a whole; they are reported to `onInvalid` so the caller can apply the
// §8.1 asymmetric rule (local: republish-from-staged-intent or report; intake: reject).
export const readSegments = (actorDir, onInvalid = () => {}) => {
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

// ---- legacy NDJSON streams (READ-COMPAT ONLY — v:1 writers MUST NOT produce this form) ----
const ROTATE_BYTES = 1024 * 1024;
const seqName = (stream, n) => `${stream}.${String(n).padStart(5, '0')}.jsonl`;

// Legacy writer, kept ONLY so the suite can fabricate pre-1.8 artifacts for read-compat tests.
export const appendEventLegacy = (actorDir, stream, event) => {
  fs.mkdirSync(actorDir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(actorDir, seqName(stream, n + 1)))) n++;
  let file = path.join(actorDir, seqName(stream, n));
  if (fs.existsSync(file) && fs.statSync(file).size > ROTATE_BYTES)
    file = path.join(actorDir, seqName(stream, ++n)); // rotate BEFORE appending
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
};

// Read one actor's legacy stream across all <seq> files, applying the torn-tail rule.
export const readStream = (actorDir, stream) => {
  const files = fs.existsSync(actorDir)
    ? fs.readdirSync(actorDir).filter((f) => f.startsWith(`${stream}.`) && f.endsWith('.jsonl')).sort()
    : [];
  const events = [];
  files.forEach((f, fi) => {
    const raw = fs.readFileSync(path.join(actorDir, f), 'utf8');
    const lines = raw.split('\n');
    const lastIdx = lines.length - 1;
    lines.forEach((line, li) => {
      if (line === '') return; // trailing LF / blank
      try {
        events.push(JSON.parse(line));
      } catch (e) {
        const isFinalLine = fi === files.length - 1 && li === lastIdx - (lines[lastIdx] === '' ? 1 : 0);
        const isTornTail = isFinalLine && !raw.endsWith('\n');
        if (isTornTail) return; // §8.1 read-compat: ignore torn tail
        throw new Error(`corrupt journal line in ${f}:${li + 1} — refuse to fold`);
      }
    });
  });
  return events;
};

// Union across every actor under journal/: sealed segments + legacy streams.
export const readUnion = (journalDir, onInvalid = () => {}) => {
  if (!fs.existsSync(journalDir)) return [];
  const events = [];
  for (const actor of fs.readdirSync(journalDir)) {
    const dir = path.join(journalDir, actor);
    if (!fs.statSync(dir).isDirectory()) continue;
    events.push(...readSegments(dir, onInvalid));
    const streams = new Set(
      fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.\d{5}\.jsonl$/, ''))
    );
    for (const s of streams) events.push(...readStream(dir, s));
  }
  return events;
};
