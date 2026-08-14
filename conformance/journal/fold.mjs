// The fold — BURRITO-SPEC §8.6 reference implementation.
// fold(events) is a pure function of the event SET: dedup by ts, sort by ts,
// per-key LWW with fork detection, then project.
import crypto from 'crypto';
import { SLOT, recompose } from './skeleton.mjs';

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const canon = (o) => JSON.stringify(sortKeys(o));
const sortKeys = (o) =>
  Array.isArray(o) ? o.map(sortKeys)
  : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
  : o;

const ENVELOPE = new Set(['v', 'op', 'actor', 'ts', 'base', 'supersedes', 'seed', 'batch']);
const payloadOf = (e) => {
  const p = { op: e.op };
  for (const k of Object.keys(e)) if (!ENVELOPE.has(k)) p[k] = e[k];
  return p;
};

const KNOWN_OPS = new Set([
  'text.verse.set', 'text.skeleton.set', 'book.add', 'book.remove',
  'align.verse.set', 'check.decision.set', 'note.add', 'resource.pin.set', 'project.meta.set',
  'settings.set',
]);
const META_RESERVED_ROOTS = new Set(['format', 'ingredients', 'type', 'meta']); // §8.5: derived/fixed

// LWW-register key per §8.5. note.add is grow-only (no key).
const keyOf = (e) => {
  switch (e.op) {
    case 'text.verse.set':      return `text|${e.book}|${e.chapter}:${e.verse}`;
    case 'text.skeleton.set':   return `skel|${e.book}`;
    case 'book.add': case 'book.remove': return `book|${e.book}`;
    case 'align.verse.set':     return `align|${e.book}|${e.chapter}:${e.verse}`;
    case 'check.decision.set': {
      const c = e.decision.contextId;
      return `dec|${e.toolId}|${c.checkId}|${c.reference.bookId}|${c.reference.chapter}|${c.reference.verse}|${c.occurrence}`;
    }
    case 'resource.pin.set':    return `pin|${e.slot}`;
    case 'project.meta.set': {
      if (META_RESERVED_ROOTS.has(String(e.path).split('.')[0]))
        throw new Error(`project.meta.set targets reserved root "${e.path}" (ts ${e.ts}) — refuse to fold`);
      return `meta|${e.path}`;
    }
    case 'settings.set':        return `set|${e.path}`;
    case 'note.add':            return null;
    default: throw new Error(`unreachable op ${e.op}`);
  }
};

export const fold = (eventsIn, opts = {}) => {
  const verseTextMd5 = opts.verseTextMd5 || ((content) => md5(content.trim()));

  // 1. de-duplicate by ts (identical copies fine; same ts + different content = corruption)
  const byTs = new Map();
  for (const e of eventsIn) {
    if (e.v !== 1) throw new Error(`unknown envelope version v=${e.v} (ts ${e.ts}) — refuse to fold`);
    if (!KNOWN_OPS.has(e.op)) throw new Error(`unrecognized op "${e.op}" (ts ${e.ts}) — refuse to fold`);
    const prev = byTs.get(e.ts);
    if (prev) {
      if (canon(prev) !== canon(e)) throw new Error(`two different events share ts ${e.ts} — corrupt union`);
      continue;
    }
    byTs.set(e.ts, e);
  }
  // 2. total order = plain string compare on ts
  const events = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));

  // 3. per-key live-head sets
  const heads = new Map(); // key -> [{ts, event}]
  const notes = [];
  for (const e of events) {
    const key = keyOf(e);
    if (key === null) { notes.push(e); continue; }
    const live = heads.get(key) || [];
    const supers = new Set(e.supersedes || []);
    if (live.length === 0) {
      heads.set(key, [{ ts: e.ts, event: e }]);
    } else if (supers.size && live.every((h) => supers.has(h.ts))) {
      heads.set(key, [{ ts: e.ts, event: e }]); // resolution: supersedes ALL live heads
    } else if (live.some((h) => h.ts === e.base)) {
      // linear continuation: advance the branch whose head this event observed
      heads.set(key, [...live.filter((h) => h.ts !== e.base && !supers.has(h.ts)), { ts: e.ts, event: e }]);
    } else {
      heads.set(key, [...live.filter((h) => !supers.has(h.ts)), { ts: e.ts, event: e }]); // fork joins
    }
  }

  // fork bookkeeping: identical payloads auto-merge (§8.6)
  const forks = [];
  for (const [key, live] of heads) {
    if (live.length <= 1) continue;
    const c0 = canon(payloadOf(live[0].event));
    if (live.every((h) => canon(payloadOf(h.event)) === c0)) {
      const winner = live.reduce((a, b) => (a.ts > b.ts ? a : b));
      heads.set(key, [winner]);
    } else {
      const winner = live.reduce((a, b) => (a.ts > b.ts ? a : b));
      forks.push({ key, heads: live.map((h) => h.ts).sort(), provisional: winner.ts });
    }
  }
  const headOf = (key) => {
    const live = heads.get(key);
    if (!live || live.length === 0) return null;
    return live.reduce((a, b) => (a.ts > b.ts ? a : b)).event; // provisional winner if forked
  };

  // 4. project
  const books = {};
  const bookCodes = new Set(
    [...heads.keys()].filter((k) => k.startsWith('book|')).map((k) => k.slice(5))
  );
  for (const book of bookCodes) {
    const bookHead = headOf(`book|${book}`);
    if (!bookHead || bookHead.op !== 'book.add') continue; // absent books fold but don't project
    const skelHead = headOf(`skel|${book}`);
    if (!skelHead) continue;
    const verses = {};
    for (const key of heads.keys()) {
      if (!key.startsWith(`text|${book}|`)) continue;
      const h = headOf(key);
      verses[key.slice(`text|${book}|`.length)] = h.text;
    }
    // slots with no verse event yet project as the untranslated stub (§4.1 convention)
    for (const m of skelHead.skeleton.matchAll(new RegExp(`${SLOT}([^${SLOT}]+)${SLOT}`, 'g')))
      if (!(m[1] in verses)) verses[m[1]] = '___\n';
    books[book] = { usfm: recompose(skelHead.skeleton, verses), verses };
  }

  const decisions = {};
  for (const key of heads.keys()) {
    if (!key.startsWith('dec|')) continue;
    const h = headOf(key);
    (decisions[h.toolId] ||= []).push(h.decision);
  }
  for (const t of Object.keys(decisions))
    decisions[t].sort((a, b) => canon(a.contextId) < canon(b.contextId) ? -1 : 1);

  const alignments = {}; const invalid = [];
  for (const key of heads.keys()) {
    if (!key.startsWith('align|')) continue;
    const h = headOf(key);
    const vkey = `${h.chapter}:${h.verse}`;
    ((alignments[h.book] ||= {})[vkey]) = { alignments: h.alignments, wordBank: h.wordBank, targetVerseMd5: h.targetVerseMd5 };
    // orphaned if the verse has no slot in the current skeleton (§8.6 step 4)
    const skelHead = headOf(`skel|${h.book}`);
    const hasSlot = !!skelHead && skelHead.skeleton.includes(`${SLOT}${vkey}${SLOT}`);
    const verseContent = books[h.book]?.verses?.[vkey];
    if (!hasSlot || verseContent === undefined || verseTextMd5(verseContent) !== h.targetVerseMd5)
      invalid.push({ book: h.book, verse: vkey, ts: h.ts, ...(hasSlot ? {} : { orphaned: true }) });
  }

  const pins = {};
  for (const key of heads.keys())
    if (key.startsWith('pin|')) { const h = headOf(key); pins[h.slot] = h.entry; }

  const projectMeta = {};
  for (const key of heads.keys())
    if (key.startsWith('meta|')) { const h = headOf(key); projectMeta[h.path] = h.value; }

  const settings = {};
  for (const key of heads.keys())
    if (key.startsWith('set|')) { const h = headOf(key); settings[h.path] = h.value; }

  const headsTs = {};
  for (const key of heads.keys()) { const h = headOf(key); if (h) headsTs[key] = h.ts; }

  return { books, decisions, alignments, pins, projectMeta, settings, notes, forks, invalid, headsTs };
};
