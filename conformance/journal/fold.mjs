// The fold — BURRITO-SPEC §8.6 reference implementation (spec 1.8, the D48 flip change set).
// fold(events) is a pure function of the event SET: validate (v, op, actor binding),
// dedup by ts, sort by ts, per-key LWW with fork detection, same-actor linearity,
// structural application (text.structure.apply) with branch-local effects, then project.
import crypto from 'crypto';
import { createRequire } from 'module';
import { SLOT, recompose } from './skeleton.mjs';

const require = createRequire(import.meta.url);
const usfmjs = require('usfm-js');

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// §5.1 plain-text extraction — the fold's ONLY validity hash (I-3; §8.5 "Text vs. plain text").
// There is no substitute hash: the D48 flip removed the former opts escape.
export const verseTextMd5 = (content) => {
  const parsed = usfmjs.toJSON(`\\v 1 ${content}`, { chunk: true });
  const vo = parsed.verses?.['1']?.verseObjects || [];
  return md5(vo.map((o) => o.text || '').join('').trim());
};

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
  'text.verse.set', 'text.skeleton.set', 'text.structure.apply', 'book.add', 'book.remove',
  'align.verse.set', 'check.decision.set', 'note.add', 'resource.pin.set', 'project.meta.set',
  'settings.set', 'project.vrs.set',
]);
const META_RESERVED_ROOTS = new Set(['format', 'ingredients', 'type', 'meta']); // §8.5: derived/fixed

// §8.5: the pin slot grammar is the §5.3 document's own paths — anything else refuses.
const PIN_SLOT_RE = /^(languageSets\.(primary|fallback)\.(gatewayLanguage|translationNotes|translationWordsLinks|translationWords|translationAcademy)|resources\.(originalLanguage|lexicon)\.(nt|ot)|extraScripture\.[A-Za-z0-9_-]+)$/;

const SLOT_RE = () => new RegExp(`${SLOT}([^${SLOT}]+)${SLOT}`, 'g');
export const slotKeysOf = (skeleton) => [...skeleton.matchAll(SLOT_RE())].map((m) => m[1]);

// The §5.2 identity key a decision disposition names: toolId|checkId|bookId|chapter|verse|occurrence.
const decKeyOf = (toolId, d) => {
  const c = d.contextId;
  return `dec|${toolId}|${c.checkId}|${c.reference.bookId}|${c.reference.chapter}|${c.reference.verse}|${c.occurrence}`;
};

// LWW-register key per §8.5. note.add is grow-only (no key); structural/vrs ops are handled inline.
const keyOf = (e) => {
  switch (e.op) {
    case 'text.verse.set':      return `text|${e.book}|${e.chapter}:${e.verse}`;
    case 'align.verse.set':     return `align|${e.book}|${e.chapter}:${e.verse}`;
    case 'check.decision.set':  return decKeyOf(e.toolId, e.decision);
    case 'resource.pin.set': {
      if (!PIN_SLOT_RE.test(String(e.slot)))
        throw new Error(`resource.pin.set slot "${e.slot}" is not a §5.3 slot (ts ${e.ts}) — refuse to fold`);
      return `pin|${e.slot}`;
    }
    case 'project.meta.set': {
      if (META_RESERVED_ROOTS.has(String(e.path).split('.')[0]))
        throw new Error(`project.meta.set targets reserved root "${e.path}" (ts ${e.ts}) — refuse to fold`);
      return `meta|${e.path}`;
    }
    case 'settings.set':        return `set|${e.path}`;
    default: throw new Error(`unreachable op ${e.op}`);
  }
};

const bookOfEvent = (e) => {
  if (e.book) return e.book;
  if (e.op === 'check.decision.set') return e.decision.contextId.reference.bookId.toUpperCase();
  return null;
};

export const fold = (eventsIn) => {
  // 1. validate + de-duplicate by ts (identical copies fine; same ts + different content = corruption)
  const byTs = new Map();
  for (const e of eventsIn) {
    if (e.v !== 1) throw new Error(`unknown envelope version v=${e.v} (ts ${e.ts}) — refuse to fold`);
    if (!KNOWN_OPS.has(e.op)) throw new Error(`unrecognized op "${e.op}" (ts ${e.ts}) — refuse to fold`);
    const tsActor = String(e.ts).split('|')[2];
    if (tsActor !== e.actor)
      throw new Error(`actor binding violated: event actor "${e.actor}" ≠ ts actor "${tsActor}" (ts ${e.ts}) — refuse to fold`);
    const prev = byTs.get(e.ts);
    if (prev) {
      if (canon(prev) !== canon(e)) throw new Error(`two different events share ts ${e.ts} — corrupt union`);
      continue;
    }
    byTs.set(e.ts, e);
  }
  // 2. total order = plain string compare on ts
  const events = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));

  // structural ancestry: sancOf(ts) = the nearest book.add / text.structure.apply on the base chain
  const sancCache = new Map();
  const sancOf = (ts) => {
    if (ts == null) return null;
    if (sancCache.has(ts)) return sancCache.get(ts);
    sancCache.set(ts, null); // cycle guard
    const e = byTs.get(ts);
    let r = null;
    if (e) r = (e.op === 'book.add' || e.op === 'text.structure.apply') ? ts : sancOf(e.base ?? null);
    sancCache.set(ts, r);
    return r;
  };
  const headSancFor = (e) =>
    (e.op === 'book.add' || e.op === 'text.structure.apply') ? e.ts : sancOf(e.base ?? null);

  // 3. per-key live-head sets. Head = {ts, actor, sanc, book, event}.
  const heads = new Map();
  const notes = [];
  const noteRekey = new Map();     // note ts -> {structTs, to}
  const consumed = new Map();      // `${key}|${headTs}` -> Set(structTs)
  const retainedByStruct = [];     // {structTs, key, ts, reason}
  const pendingStructural = [];    // {ts, book, status, detail}
  let vrs = null;                  // {name, bytes, ts} — immutable first-value register
  const vrsRejected = [];

  const consume = (key, headTs, structTs) => {
    const k = `${key}|${headTs}`;
    if (!consumed.has(k)) consumed.set(k, new Set());
    consumed.get(k).add(structTs);
  };
  const pushHead = (key, head) => { heads.set(key, [...(heads.get(key) || []), head]); };
  const joinHead = (key, head, base, supersedes, actor) => {
    const live = heads.get(key) || [];
    const supers = new Set(supersedes || []);
    if (live.length === 0) {
      heads.set(key, [head]);
    } else if (supers.size && live.every((h) => supers.has(h.ts))) {
      heads.set(key, [head]); // resolution: supersedes ALL live heads
    } else if (live.some((h) => h.ts === base)) {
      // linear continuation: advance the branch whose head this event observed
      heads.set(key, [...live.filter((h) => h.ts !== base && !supers.has(h.ts)), head]);
    } else if (live.some((h) => h.actor === actor)) {
      // §8.3/§8.6: same-actor events are totally ordered by ts and never fork — advance linearly
      heads.set(key, [...live.filter((h) => h.actor !== actor && !supers.has(h.ts)), head]);
    } else {
      heads.set(key, [...live.filter((h) => !supers.has(h.ts)), head]); // fork joins
    }
  };
  const vkeyParts = (vkey) => { const i = vkey.indexOf(':'); return { chapter: vkey.slice(0, i), verse: vkey.slice(i + 1) }; };

  for (const e of events) {
    if (e.op === 'note.add') { notes.push(e); continue; }

    if (e.op === 'project.vrs.set') {
      // §8.5: immutable first-value register — first binds, identical repeat de-duplicates,
      // any different later value is surfaced and never applied.
      if (typeof e.bytes !== 'string') throw new Error(`project.vrs.set carries no raw bytes (ts ${e.ts}) — refuse to fold`);
      if (!vrs) vrs = { name: e.name, bytes: e.bytes, ts: e.ts };
      else if (vrs.name !== e.name || vrs.bytes !== e.bytes) vrsRejected.push(e.ts);
      continue;
    }

    if (e.op === 'book.add') {
      // §8.5: self-contained — {book, scope, skeleton, initialVerses}
      if (typeof e.skeleton !== 'string') throw new Error(`book.add without a skeleton (ts ${e.ts}) — refuse to fold (§8.5 self-contained)`);
      if (!Array.isArray(e.scope)) throw new Error(`book.add without a scope array (ts ${e.ts}) — refuse to fold (§8.5)`);
      const initial = e.initialVerses || {};
      joinHead(`book|${e.book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book, event: e }, e.base, e.supersedes, e.actor);
      joinHead(`skel|${e.book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book,
        event: { op: 'text.skeleton.set', book: e.book, skeleton: e.skeleton } }, e.base, e.supersedes, e.actor);
      for (const k of slotKeysOf(e.skeleton)) {
        const { chapter, verse } = vkeyParts(k);
        joinHead(`text|${e.book}|${k}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book,
          event: { op: 'text.verse.set', book: e.book, chapter, verse, text: initial[k] ?? '___\n' } }, e.base, e.supersedes, e.actor);
      }
      continue;
    }

    if (e.op === 'book.remove') {
      joinHead(`book|${e.book}`, { ts: e.ts, actor: e.actor, sanc: sancOf(e.base ?? null), book: e.book, event: e }, e.base, e.supersedes, e.actor);
      continue;
    }

    if (e.op === 'text.skeleton.set') {
      // §8.4/§8.5: slot-preserving only — a slot-set/key/ordering change MUST use
      // text.structure.apply. The check binds against the base event when it is present,
      // and otherwise against the CURRENT PROJECTED skeleton head (max-ts live head) —
      // a missing or unknown base is not an escape from the topology rule.
      const baseEvent = e.base ? byTs.get(e.base) : null;
      let reference = null;
      if (baseEvent && typeof baseEvent.skeleton === 'string') reference = baseEvent.skeleton;
      else {
        const live = heads.get(`skel|${e.book}`) || [];
        if (live.length) reference = live.reduce((a, b) => (a.ts > b.ts ? a : b)).event.skeleton;
      }
      if (reference != null &&
          JSON.stringify(slotKeysOf(reference)) !== JSON.stringify(slotKeysOf(e.skeleton)))
        throw new Error(`text.skeleton.set changes the slot set (ts ${e.ts}) — refuse to fold; use text.structure.apply (§8.4)`);
      joinHead(`skel|${e.book}`, { ts: e.ts, actor: e.actor, sanc: sancOf(e.base ?? null), book: e.book, event: e }, e.base, e.supersedes, e.actor);
      continue;
    }

    if (e.op === 'text.structure.apply') {
      const book = e.book;
      const newSlots = slotKeysOf(e.skeleton);
      const transitions = e.transitions || {};
      const dispositions = e.dispositions || [];
      // well-formedness (refuse-class — a malformed event is a writer defect, never applied):
      const tKeys = Object.keys(transitions);
      if (JSON.stringify([...tKeys].sort()) !== JSON.stringify([...newSlots].sort()))
        throw new Error(`text.structure.apply transitions must cover exactly the new skeleton's slots (ts ${e.ts}) — refuse to fold`);
      const claimed = new Set();
      for (const dest of tKeys) {
        for (const src of transitions[dest].sources || []) {
          const c = `${src.key}|${src.ts}`;
          if (claimed.has(c)) throw new Error(`text.structure.apply claims source ${c} twice (ts ${e.ts}) — refuse to fold`);
          claimed.add(c);
        }
      }
      // §8.5: at most ONE disposition per record — duplicates/conflicts are malformed
      const dispId = (d) => `${d.surface}|${d.key ?? ''}|${d.ts}`;
      const dispSet = new Set();
      for (const d of dispositions) {
        const id = dispId(d);
        if (dispSet.has(id))
          throw new Error(`text.structure.apply carries duplicate/conflicting dispositions for ${id} (ts ${e.ts}) — refuse to fold`);
        dispSet.add(id);
      }
      // applicability (§8.5 all-or-nothing): every referenced source head present AND live
      const missing = []; const stale = [];
      const checkRef = (key, ts) => {
        if (!byTs.has(ts)) { missing.push(`${key}@${ts}`); return; }
        const live = heads.get(key) || [];
        if (!live.some((h) => h.ts === ts)) stale.push(`${key}@${ts}`);
      };
      for (const dest of tKeys)
        for (const src of transitions[dest].sources || []) checkRef(`text|${book}|${src.key}`, src.ts);
      for (const d of dispositions) {
        const key = d.surface === 'alignment' ? `align|${book}|${d.key}`
          : d.surface === 'decision' ? `dec|${d.key}` : null;
        if (key) checkRef(key, d.ts);
        else if (!byTs.has(d.ts)) missing.push(`note@${d.ts}`);
      }
      if (missing.length) { pendingStructural.push({ ts: e.ts, book, status: 'incomplete', detail: missing }); continue; }
      if (stale.length)   { pendingStructural.push({ ts: e.ts, book, status: 'conflicted', detail: stale });  continue; }
      // §8.5: dispositions must be COMPLETE — every live alignment, decision, and
      // verse-targeted note on a MAPPED source key (re-keyed or removed) needs exactly
      // one disposition; anything undispositioned makes the event incomplete.
      const mapped = new Set();
      for (const dest of tKeys)
        for (const src of transitions[dest].sources || []) if (src.key !== dest) mapped.add(src.key);
      const baseEvent = e.base ? byTs.get(e.base) : null;
      if (baseEvent && typeof baseEvent.skeleton === 'string')
        for (const k of slotKeysOf(baseEvent.skeleton)) if (!newSlots.includes(k)) mapped.add(k);
      const undispositioned = [];
      for (const k of mapped) {
        for (const h of heads.get(`align|${book}|${k}`) || [])
          if (!dispSet.has(`alignment|${k}|${h.ts}`)) undispositioned.push(`alignment|${k}|${h.ts}`);
        for (const [dkey, live] of heads) {
          if (!dkey.startsWith('dec|')) continue;
          for (const h of live) {
            if (h.book !== book) continue;
            const r = h.event.decision.contextId.reference;
            if (`${r.chapter}:${r.verse}` !== k) continue;
            if (!dispSet.has(`decision|${dkey.slice(4)}|${h.ts}`)) undispositioned.push(`decision|${dkey.slice(4)}|${h.ts}`);
          }
        }
        for (const n of notes) {
          const tg = n.target;
          if (tg && tg.book === book && `${tg.chapter}:${tg.verse}` === k && !dispSet.has(`note||${n.ts}`))
            undispositioned.push(`note|${n.ts}`);
        }
      }
      if (undispositioned.length) {
        pendingStructural.push({ ts: e.ts, book, status: 'incomplete', detail: undispositioned.map((u) => `undispositioned:${u}`) });
        continue;
      }
      // apply — the skeleton head joins normally (a stale base = a structural FORK head);
      // post-images always PUSH (branch-local: pre-images stay live for the other branch and
      // are shadowed on this branch by consumption).
      joinHead(`skel|${book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book, event: e }, e.base, e.supersedes, e.actor);
      for (const dest of newSlots) {
        const tr = transitions[dest];
        for (const src of tr.sources || []) consume(`text|${book}|${src.key}`, src.ts, e.ts);
        const { chapter, verse } = vkeyParts(dest);
        pushHead(`text|${book}|${dest}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
          event: { op: 'text.verse.set', book, chapter, verse, text: tr.text } });
      }
      for (const d of dispositions) {
        if (d.surface === 'alignment') {
          const key = `align|${book}|${d.key}`;
          const old = (heads.get(key) || []).find((h) => h.ts === d.ts);
          consume(key, d.ts, e.ts);
          if (d.action === 're-key') {
            const { chapter, verse } = vkeyParts(d.to);
            pushHead(`align|${book}|${d.to}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { ...old.event, op: 'align.verse.set', book, chapter, verse } });
          } else if (d.action === 'replace') {
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book, event: { op: 'align.verse.set', book, ...d.post } });
          } else {
            retainedByStruct.push({ structTs: e.ts, key, ts: d.ts, reason: d.action });
          }
        } else if (d.surface === 'decision') {
          const key = `dec|${d.key}`;
          const old = (heads.get(key) || []).find((h) => h.ts === d.ts);
          consume(key, d.ts, e.ts);
          const toolId = old.event.toolId;
          if (d.action === 're-key') {
            const { chapter, verse } = vkeyParts(d.to);
            const dec = JSON.parse(JSON.stringify(old.event.decision));
            dec.contextId.reference.chapter = /^\d+$/.test(chapter) ? Number(chapter) : chapter;
            dec.contextId.reference.verse = /^\d+$/.test(verse) ? Number(verse) : verse;
            pushHead(decKeyOf(toolId, dec), { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, decision: dec } });
          } else if (d.action === 'replace') {
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, decision: d.post } });
          } else {
            // invalidate-retain / orphan-review: decisions are never deleted (D36) —
            // the record is retained, invalidated.
            const dec = { ...old.event.decision, invalidated: true, status: 'invalid' };
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, decision: dec } });
            retainedByStruct.push({ structTs: e.ts, key, ts: d.ts, reason: d.action });
          }
        } else if (d.surface === 'note') {
          if (d.action === 're-key') noteRekey.set(d.ts, { structTs: e.ts, to: d.to });
          else retainedByStruct.push({ structTs: e.ts, key: 'note', ts: d.ts, reason: d.action });
        }
      }
      continue;
    }

    // standard LWW ops
    const key = keyOf(e);
    joinHead(key, { ts: e.ts, actor: e.actor, sanc: headSancFor(e), book: bookOfEvent(e), event: e }, e.base, e.supersedes, e.actor);
  }

  // 4. project — per book, select the winning skeleton head; its structural chain is the
  // selected branch (§8.5 lineage rule). Heads off the chain are retained, never projected.
  const chainOf = (structTs) => {
    const chain = new Set();
    let cur = structTs; let guard = 0;
    while (cur && !chain.has(cur) && guard++ < 10000) {
      chain.add(cur);
      const ev = byTs.get(cur);
      if (!ev || ev.op === 'book.add') break;
      cur = sancOf(ev.base ?? null);
    }
    return chain;
  };
  const isConsumed = (key, ts, chain) => {
    const set = consumed.get(`${key}|${ts}`);
    if (!set) return false;
    for (const s of set) if (chain.has(s)) return true;
    return false;
  };

  const forks = [];
  const retained = [];
  const maxTs = (arr) => arr.reduce((a, b) => (a.ts > b.ts ? a : b));
  // resolve a key under a chain: filter by ancestry + consumption, auto-merge identical
  // payloads, report a fork otherwise. skel keys skip the ancestry filter — a structural
  // fork is exactly the review item (#65).
  const resolved = new Map(); // memoized: each key resolves once (stable chain per key)
  const resolveKey = (key, chain, { skipAncestry = false } = {}) => {
    if (resolved.has(key)) return resolved.get(key);
    const r = resolveKeyRaw(key, chain, { skipAncestry });
    resolved.set(key, r);
    return r;
  };
  const resolveKeyRaw = (key, chain, { skipAncestry = false } = {}) => {
    const live = heads.get(key) || [];
    if (live.length === 0) return null;
    let candidates = live;
    if (!skipAncestry && chain) {
      candidates = live.filter((h) => (h.sanc == null || chain.has(h.sanc)) && !isConsumed(key, h.ts, chain));
      for (const h of live)
        if (h.sanc != null && !chain.has(h.sanc))
          retained.push({ key, ts: h.ts, reason: 'unselected-structural-branch' });
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      const c0 = canon(payloadOf(candidates[0].event));
      if (candidates.every((h) => canon(payloadOf(h.event)) === c0)) {
        candidates = [maxTs(candidates)];
      } else {
        const winner = maxTs(candidates);
        forks.push({ key, heads: candidates.map((h) => h.ts).sort(), provisional: winner.ts });
        return winner;
      }
    }
    return candidates[0];
  };

  const books = {};
  const scope = {};
  const chains = new Map(); // book -> chain (Set)
  const bookCodes = new Set([...heads.keys()].filter((k) => k.startsWith('book|')).map((k) => k.slice(5)));
  const headsTs = {};
  for (const book of bookCodes) {
    const bookHead = resolveKey(`book|${book}`, null, { skipAncestry: true });
    if (bookHead) headsTs[`book|${book}`] = bookHead.ts;
    if (!bookHead || bookHead.event.op !== 'book.add') continue; // absent books fold but don't project
    scope[book] = bookHead.event.scope ?? [];
    const skelHead = resolveKey(`skel|${book}`, null, { skipAncestry: true });
    if (!skelHead) continue;
    headsTs[`skel|${book}`] = skelHead.ts;
    const chain = chainOf(skelHead.sanc);
    chains.set(book, chain);
    const skeleton = skelHead.event.skeleton;
    const verses = {};
    for (const k of slotKeysOf(skeleton)) {
      const h = resolveKey(`text|${book}|${k}`, chain);
      verses[k] = h ? h.event.text : '___\n'; // §4.1 stub for a slot with no live verse head
      if (h) headsTs[`text|${book}|${k}`] = h.ts;
    }
    books[book] = { usfm: recompose(skeleton, verses), verses };
    // resolve the book's non-slot text keys too: their heads never project (no slot),
    // but off-branch descendants must surface in retained[] (§8.5 lineage rule)
    for (const key of heads.keys()) {
      if (!key.startsWith(`text|${book}|`)) continue;
      if (!(key.slice(`text|${book}|`.length) in verses)) resolveKey(key, chain);
    }
  }
  const allChains = new Set();
  for (const c of chains.values()) for (const s of c) allChains.add(s);

  const decisions = {};
  for (const key of heads.keys()) {
    if (!key.startsWith('dec|')) continue;
    const anyHead = heads.get(key)[0];
    const h = resolveKey(key, chains.get(anyHead.book) || null);
    if (!h) continue;
    headsTs[key] = h.ts;
    (decisions[h.event.toolId] ||= []).push(h.event.decision);
  }
  for (const t of Object.keys(decisions))
    decisions[t].sort((a, b) => canon(a.contextId) < canon(b.contextId) ? -1 : 1);

  const alignments = {}; const invalid = [];
  for (const key of heads.keys()) {
    if (!key.startsWith('align|')) continue;
    const anyHead = heads.get(key)[0];
    const h = resolveKey(key, chains.get(anyHead.book) || null);
    if (!h) continue;
    headsTs[key] = h.ts;
    const ev = h.event;
    const vkey = `${ev.chapter}:${ev.verse}`;
    // carry the COMPLETE §5.1 record: every payload field (sourceVersion, invalid, …),
    // not a hand-picked subset — seeding must reproduce real projects byte-for-byte
    const record = {};
    for (const k of Object.keys(ev))
      if (!ENVELOPE.has(k) && k !== 'op' && k !== 'book' && k !== 'chapter' && k !== 'verse') record[k] = ev[k];
    ((alignments[ev.book] ||= {})[vkey]) = record;
    // orphaned if the verse has no slot in the current skeleton (§8.6 step 4 — the backstop
    // for a dependent record a structural action did not disposition)
    const skelHead = resolveKey(`skel|${ev.book}`, null, { skipAncestry: true });
    const hasSlot = !!skelHead && slotKeysOf(skelHead.event.skeleton).includes(vkey);
    const verseContent = books[ev.book]?.verses?.[vkey];
    if (!hasSlot || verseContent === undefined || verseTextMd5(verseContent) !== ev.targetVerseMd5)
      invalid.push({ book: ev.book, verse: vkey, ts: h.ts, ...(hasSlot ? {} : { orphaned: true }) });
  }

  const pins = {};
  for (const key of heads.keys()) {
    if (!key.startsWith('pin|')) continue;
    const h = resolveKey(key, null, { skipAncestry: true });
    if (!h) continue;
    headsTs[key] = h.ts;
    if (!h.event.removed) pins[h.event.slot] = h.event.entry; // removed pins project to absence
  }

  const projectMeta = {};
  const projectMetaRemoved = []; // removed paths must DELETE from the base document at checkpoint (§8.7)
  for (const key of heads.keys()) {
    if (!key.startsWith('meta|')) continue;
    const h = resolveKey(key, null, { skipAncestry: true });
    if (!h) continue;
    headsTs[key] = h.ts;
    if (!h.event.removed) projectMeta[h.event.path] = h.event.value; // {path, removed:true} folds to absence
    else projectMetaRemoved.push(h.event.path);
  }

  const settings = {};
  for (const key of heads.keys()) {
    if (!key.startsWith('set|')) continue;
    const h = resolveKey(key, null, { skipAncestry: true });
    if (!h) continue;
    headsTs[key] = h.ts;
    if (!h.event.removed) settings[h.event.path] = h.event.value;
  }

  const notesOut = notes.map((n) => {
    const rk = noteRekey.get(n.ts);
    if (rk && allChains.has(rk.structTs)) {
      const { chapter, verse } = { chapter: rk.to.split(':')[0], verse: rk.to.split(':').slice(1).join(':') };
      return { ...n, target: { ...n.target, chapter, verse } };
    }
    return n;
  });
  for (const r of retainedByStruct) if (allChains.has(r.structTs)) retained.push({ key: r.key, ts: r.ts, reason: r.reason });

  return {
    books, decisions, alignments, pins, projectMeta, projectMetaRemoved, settings, notes: notesOut,
    forks, invalid, retained, scope,
    vrs: vrs ? { name: vrs.name, bytes: vrs.bytes } : null, vrsRejected,
    pendingStructural, headsTs,
  };
};
