// The fold — BURRITO-SPEC §8.6 reference implementation (spec 1.8, the D48 flip change set).
// fold(events) is a pure function of the event SET: validate (v, op, actor binding),
// dedup by ts, sort by ts, per-key LWW with fork detection, same-actor linearity,
// structural application (text.structure.apply) with branch-local effects, then project.
import crypto from 'crypto';
import { createRequire } from 'module';
import { slotKeysOf, recompose } from './skeleton.mjs';
import { validateEvent, PAYLOAD_FIELDS } from './schema.mjs';
import { identityKeyOf, noteRekeyError, journaledTextError, MAX_JSON_DEPTH } from './grammar.mjs';
export { slotKeysOf }; // kept on this module for existing importers

const require = createRequire(import.meta.url);
const usfmjs = require('usfm-js');

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// §5.1 plain-text extraction — the fold's ONLY validity hash (I-3; §8.5 "Text vs. plain text").
// There is no substitute hash: the D48 flip removed the former opts escape.
//
// LAYER 2 (round 9): the hash covers the WHOLE content slot. The extraction used to read
// only the parse's verse `1`, so bytes after an embedded `\v ` or `\c ` marker fell
// OUTSIDE the validity hash — an alignment stayed "valid" over text it never saw. Layer 1
// (the schema's `journaledTextError`) refuses such content at seal and at fold; this walk
// refuses to be truncated by it in the first place, so the two layers fail independently.
export const verseTextMd5 = (content) => {
  // The extraction REFUSES what it cannot cover. A `\c ` region is dropped outright by the
  // chunk parse, so hashing such content would return a hash over PART of it — silently.
  // The same ONE grammar layer 1 applies at the schema is applied here, at the hash, so a
  // truncated hash cannot be produced even with validation off.
  const err = journaledTextError(content);
  if (err) throw new Error(`verseTextMd5: content ${err} — the §5.1 extraction (I-3) covers ONE content slot; refuse to hash part of it`);
  const parsed = usfmjs.toJSON(`\\v 1 ${content}`, { chunk: true });
  const parts = [];
  const take = (vo) => { for (const o of vo || []) parts.push(o.text || ''); };
  for (const k of Object.keys(parsed.verses || {})) take(parsed.verses[k].verseObjects);
  return md5(parts.join('').trim());
};

// Own-key-safe object rebuild. `out[k] = v` runs the PROTOTYPE setter for a `__proto__`
// key and swallows the field, so any walk that copies field-by-field goes blind on it.
const putOwn = (out, k, v) => {
  Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  return out;
};
// The canonical form the fold compares heads by. Bounded like every other recursive walk
// (§8.1): the schema already refuses a deeper document, and this walk refuses it AGAIN so
// a hostile event reaching the fold with validation off cannot blow the stack here.
const sortKeys = (o, depth = 0) => {
  if (depth > MAX_JSON_DEPTH)
    throw new Error(`value nests deeper than the §8.1 limit of ${MAX_JSON_DEPTH} levels — refuse to fold`);
  if (Array.isArray(o)) return o.map((x) => sortKeys(x, depth + 1));
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o).sort()) putOwn(out, k, sortKeys(o[k], depth + 1));
    return out;
  }
  return o;
};
const canon = (o) => JSON.stringify(sortKeys(o));

const EMPTY_SET = new Set();
const ENVELOPE = new Set(['v', 'op', 'actor', 'ts', 'base', 'supersedes', 'seed', 'batch']);
// Fork identity is built by ADDITION from the op's §8.5 payload row (schema.mjs), never by
// subtracting the known envelope keys: subtraction made every unknown top-level field —
// including an additive-optional one §9 says readers MUST tolerate — part of identity, so
// two otherwise IDENTICAL heads forked instead of auto-merging. `align.verse.set` declares
// no row (its payload IS the open §5.1 record) and keeps the subtractive rule.
const payloadOf = (e) => {
  const fields = PAYLOAD_FIELDS[e.op];
  const p = putOwn({}, 'op', e.op);
  if (fields) {
    for (const k of fields) if (e[k] !== undefined) putOwn(p, k, e[k]);
    return p;
  }
  for (const k of Object.keys(e)) if (!ENVELOPE.has(k)) putOwn(p, k, e[k]);
  return p;
};
// The canonical head identity the auto-merge test compares (§8.6 step 3), exported so the
// conformance suite can assert LAYER 2 directly — with the schema bypassed, which is the
// only way to reach an own `__proto__` payload field or an over-deep value here.
export const headIdentity = (e) => canon(payloadOf(e));

// The §5.2 identity key a decision disposition names: toolId|checkId|bookId|chapter|verse|occurrence.
// Built from the ONE identity-key serializer (grammar.mjs) — the same string the schema's
// grammar validates, so serializer and validator can never drift.
const decKeyOf = (toolId, d) => `dec|${toolId}|${identityKeyOf(d.contextId)}`;

// LWW-register key per §8.5. note.add is grow-only (no key); structural/vrs ops are
// handled inline. Payload validity (pin slot grammar, reserved meta roots, …) was
// already established by the schema (validateEvent) in step 1.
const keyOf = (e) => {
  switch (e.op) {
    case 'text.verse.set':      return `text|${e.book}|${e.chapter}:${e.verse}`;
    case 'align.verse.set':     return `align|${e.book}|${e.chapter}:${e.verse}`;
    case 'check.decision.set':  return decKeyOf(e.toolId, e.decision);
    case 'resource.pin.set':    return `pin|${e.slot}`;
    case 'project.meta.set':    return `meta|${e.path}`;
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
  // 1. validate (the ONE §8.3/§8.5 schema — the same validator the writer's seal and
  //    segment intake apply) + de-duplicate by ts (identical copies fine; same ts +
  //    different content = corruption)
  const byTs = new Map();
  for (const e of eventsIn) {
    const schemaErr = validateEvent(e);
    if (schemaErr) throw new Error(`${schemaErr} (ts ${e && e.ts}) — refuse to fold`);
    const prev = byTs.get(e.ts);
    if (prev) {
      if (canon(prev) !== canon(e)) throw new Error(`two different events share ts ${e.ts} — corrupt union`);
      continue;
    }
    byTs.set(e.ts, e);
  }
  // 2. total order = plain string compare on ts
  const events = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));

  // structural ancestry: sancOf(ts) = the nearest book.add / text.structure.apply on the
  // base chain, or null when the chain resolves to NO structural anchor (an absent base,
  // a cycle, or a chain that bottoms out in a rootless content event).
  //
  // ROUND 9 — `base` absence is a legal state, and the fold DECIDES it. `sanc == null`
  // used to mean "belongs to every branch and every generation": `inChain` passed
  // unconditionally and the generational test fell back to an HLC cutoff (`h.ts >
  // genRoot`) — the exact mechanism §8.5 forbids by name. That single unhandled state is
  // what let a rootless content op project under EVERY structural branch, let a base
  // cycle behave chain-agnostically, and let a still-offline actor's prior-generation
  // draft win or lose purely by clock. `sanc == null` now means exactly what it says —
  // NO anchor — and an unanchored head does not project (it is retained and reported).
  // CONVERGED creation roots (round 10, D53 part d). `base: null` asserts "no prior
  // state I KNOW OF", not "no prior state exists": a rootless `book.add` whose payload
  // (the event minus `actor` and `ts`) is identical to an existing creation head IS the
  // same fact, recorded twice — §8.8 seeding is deterministic modulo actor, so every
  // second-device seed lands here. The later record aliases to the earlier root, and
  // every place a generation root is consulted (anchors, generation stamps, payload
  // identity) resolves through the alias. Events sort by ts before this map is built,
  // so the canonical root is order- and permutation-independent.
  const genAlias = new Map();
  const aliasTs = (ts) => genAlias.get(ts) ?? ts;
  const sancCache = new Map();
  const sancOf = (ts) => {
    if (ts == null) return null;
    if (sancCache.has(ts)) return sancCache.get(ts);
    sancCache.set(ts, null); // cycle guard: a cycle resolves to NO anchor, never to "any"
    const e = byTs.get(ts);
    let r = null;
    if (e) r = e.op === 'book.add' ? aliasTs(ts) : e.op === 'text.structure.apply' ? ts : sancOf(e.base ?? null);
    sancCache.set(ts, r);
    return r;
  };
  // The anchor a head carries. A structural post-image confers its own ts (§8.5 multi-key
  // rule). A CONTENT head inherits its base's anchor; when the base is rootless or
  // unresolvable it falls back to the op's CAUSAL stamp — `generation`, the ts of the
  // book's rooting `book.add` as the writer projected it (§8.5 Book generations). That
  // stamp is mandatory for exactly the ops whose first write is legitimately rootless
  // (`align.verse.set`, `check.decision.set`, `note.add`), which is what lets two genuine
  // concurrent first writes fork instead of silently agreeing to be branch-agnostic.
  const headSancFor = (e) => {
    if (e.op === 'book.add' || e.op === 'text.structure.apply') return e.ts;
    const a = sancOf(e.base ?? null);
    if (a != null) return a;
    return e.generation != null ? aliasTs(e.generation) : null;
  };

  // 3. per-key live-head sets. Head = {ts, actor, sanc, book, event}.
  const heads = new Map();
  const notes = [];
  const noteRekey = new Map();     // note ts -> {structTs, to}
  const noteRetired = new Map();   // note ts -> structTs (orphan-review / invalidate-retain)
  const consumed = new Map();      // `${key}|${headTs}` -> Set(structTs)
  const retainedByStruct = [];     // {structTs, key, ts, reason}
  const pendingStructural = [];    // {ts, book, status, detail}
  const superseded = [];           // {key, ts, by} — every head a `supersedes` erased
  const supersedeRefused = [];     // {key, ts, by} — every cross-ancestry erasure REFUSED
  const rootless = [];             // {key, ts} — every rootless content write on a live key
  // ONE accepted-structural-predecessors set (round 7): every ACCEPTED chain link of the
  // whole class — book.add, text.skeleton.set, text.structure.apply — lands here, and
  // every chain link consults it for its base. A base that is merely present in the
  // union but not accepted pends its descendant, so pending propagates transitively
  // ACROSS op types (a skeleton edit on a pending structure.apply, and the inverse).
  const STRUCTURAL_OPS = new Set(['book.add', 'text.skeleton.set', 'text.structure.apply']);
  // book.remove is a chain link of a book's lineage too: a re-add bases on it (§8.5 book
  // generations). It is accepted-on-application like the structural ops, so the ONE base
  // rule below covers a re-add without a special case.
  const CHAIN_OPS = new Set([...STRUCTURAL_OPS, 'book.remove']);
  const acceptedStructural = new Set();
  // ONE structural chain-link rule (round 8), applied by EVERY non-root structural op —
  // book.add with a base, text.skeleton.set, text.structure.apply. A base must:
  //   (a) EXIST in the union            → else the event PENDS (it may still arrive);
  //   (b) be a chain-link event FOR THE SAME BOOK → else REFUSE (malformed lineage — a
  //       base naming a text.verse.set, or a structural event of another book, would
  //       otherwise silently apply against an unrelated ancestry);
  //   (c) be ACCEPTED                   → else PEND transitively (a descendant must never
  //       win a fork off an unaccepted link).
  // ROUND 9 — the base:null COLUMN of that same rule. `base: null` used to be an
  // unhandled state that every rule keyed on ancestry FELL OPEN on, and the class was not
  // even uniform: at `base: null` a `book.add`, a `book.remove` and a `text.structure.apply`
  // all APPLIED while `text.skeleton.set` REFUSED, ten lines apart, with no text
  // explaining the difference. A rootless `book.remove` deleted the book; a rootless
  // `text.structure.apply` dropped slots with ZERO dispositions, because the affected-set
  // computation reads the BASE skeleton and there was none.
  //
  // ONE rule (round 10, D53 part d): `base: null` is a CLAIM — "no prior state I KNOW
  // OF" — and the fold decides it per event, NEVER by refusing the whole fold.
  //   • `book.add` while the book does not exist: an ordinary root.
  //   • `book.add` while the book exists: identical payload → CONVERGE (the same fact,
  //     recorded twice — the alias above); different payload → FORK and surface for
  //     review like any structural fork. Neither ever throws.
  //   • `book.remove` / `text.skeleton.set` / `text.structure.apply`: a rootless
  //     structural op cannot fire blind (its effect reads the base it did not name), so
  //     it refuses to ACT — retained and reported (`rootless-structural`) — and the
  //     project keeps folding.
  const rootlessStructural = []; // {key, ts} — every rootless non-add structural op
  // Returns a pendingStructural record, or null when the base is fine (or absent).
  const structuralBaseState = (e, allowed) => {
    if (e.base == null) return null; // a root — there is no chain link to check
    const baseEv = byTs.get(e.base);
    if (!baseEv) return { ts: e.ts, book: e.book, status: 'incomplete', detail: [`unknown-base:${e.base}`] };
    if (!allowed.has(baseEv.op) || baseEv.book !== e.book)
      throw new Error(`${e.op} base ${e.base} is not a ${[...allowed].join('/')} event of ${e.book} (ts ${e.ts}) — refuse to fold (§8.5)`);
    if (!acceptedStructural.has(e.base))
      return { ts: e.ts, book: e.book, status: 'incomplete', detail: [`pending-ancestor:${e.base}`] };
    return null;
  };
  let vrs = null;                  // {name, bytes, ts} — immutable first-value register
  const vrsRejected = [];

  const consume = (key, headTs, structTs) => {
    const k = `${key}|${headTs}`;
    if (!consumed.has(k)) consumed.set(k, new Set());
    consumed.get(k).add(structTs);
  };
  const pushHead = (key, head) => { heads.set(key, [...(heads.get(key) || []), head]); };
  // A `supersedes` ERASES a live head. Two rules bound it (round 9, D-F1):
  //   • CONSERVATION — an erased head is REPORTED (`retained[]`, reason `superseded`).
  //     Pre-fix it could not appear in any review list: `retained[]` is built from
  //     SURVIVING heads, so the erased draft left the projection AND every list at once,
  //     and `\v 1 ___` was committed over drafted text with nothing anywhere to see.
  //   • ANCESTRY — a supersedes MUST NOT erase a head OUTSIDE its own ancestry. Resolving
  //     a fork is a statement about one's own branch; reaching across a structural branch
  //     to delete another branch's head is not resolution, it is deletion. Such an
  //     erasure is refused (the head stays live and the attempt is reported), so the two
  //     branches remain a visible fork instead of one silently winning.
  const supersedeOk = (target, head) =>
    (target.sanc == null || head.sanc == null)
      ? target.sanc === head.sanc            // ancestry-free surfaces (pins, meta, settings)
      : chainOf(head.sanc).has(target.sanc); // the target must lie on this head's own chain
  const joinHead = (key, head, baseIn, supersedes, actor) => {
    // Base MATCHING resolves through the D53d alias (round 12): a converged device's
    // journal names ITS OWN aliased seed root as the base of every descendant, and the
    // canonical head it must advance carries the canonical ts. Comparing the raw ts read
    // every such continuation as a fork — a PHANTOM FORK on every post-convergence edit
    // by the re-seeded device.
    const base = aliasTs(baseIn);
    const live = heads.get(key) || [];
    // Dangling supersedes refs are harmless BY CONSTRUCTION: supers is only ever used to
    // filter/match LIVE heads, so an entry naming no live head filters nothing and the
    // resolution condition (live.every) never consults it. Self-supersession is refused
    // by the schema (§8.3) before any event reaches this point.
    const claimed = new Set((supersedes || []).map((s) => aliasTs(s)));
    const supers = new Set();
    for (const h of live) {
      if (!claimed.has(h.ts)) continue;
      if (supersedeOk(h, head)) { supers.add(h.ts); superseded.push({ key, ts: h.ts, by: head.ts }); }
      else supersedeRefused.push({ key, ts: h.ts, by: head.ts });
    }
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
  // §8.5 chain-of-structural-ancestry walk. Declared before the event loop because the
  // supersedes ancestry rule above consults it while heads are still being built.
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
  // THE ROOTLESS-BASE RULE for content ops (round 9). `base: null` is a CLAIM: "I observed
  // no prior state for this key". It is legal only when that claim can be true.
  //   • `text.verse.set` — a slot's verse head is created BY the `book.add` that created
  //     the slot (§8.5 multi-key rule), so on an existing slot the claim is false: the
  //     write is a writer defect. It does not become a head; it is retained and reported
  //     (`rootless-base`), never projected. Pre-fix such an event carried NO ancestry, so
  //     it projected under every structural branch and overwrote the winning branch's
  //     post-image, and its generation was decided by the clock.
  //   • `align.verse.set` / `check.decision.set` — a rootless FIRST write is ordinary, and
  //     its anchor is the mandatory `generation` stamp (headSancFor). Two genuine
  //     concurrent first writes therefore still fork.
  //   • pins, project metadata and settings carry no structural ancestry at all.
  const ROOTLESS_REFUSED = new Set(['text.verse.set']);
  const rootlessDefect = (e, key) =>
    e.base == null && ROOTLESS_REFUSED.has(e.op) && (heads.get(key) || []).length > 0;
  // ONE stale-own-head rule for BOTH skeleton-chain ops (round 9, E-R3; narrowed round
  // 12). The refusal is about REVERSAL: it fires only when the actor's own live skeleton
  // head genuinely DESCENDS from the claimed base — the base sits in that head's own base
  // chain, so the actor is reversing its own accepted structural action (a writer
  // defect). Merely APPEARING among the live heads is not enough: a same-actor
  // fork-LOSER head (a D53d differing-add genesis, or a same-base skeleton fork loser)
  // never advanced past the base at all, so the event forks or pends by the ordinary
  // rules. Pre-fix ANY same-actor live head triggered the refusal — a WHOLE-FOLD throw —
  // so an honest union whose journals each folded clean alone was permanently
  // unfoldable (round 12).
  const descendsFrom = (headTs, baseTs) => {
    let cur = headTs; let guard = 0;
    while (cur != null && guard++ < 10000) {
      if (cur === baseTs) return true;
      const ev = byTs.get(cur);
      if (!ev || ev.op === 'book.add') return false;
      cur = ev.base == null ? null : aliasTs(ev.base);
    }
    return false;
  };
  const staleOwnSkeletonHead = (e) => {
    const base = aliasTs(e.base); // the D53d alias — same comparison rule as joinHead
    const live = heads.get(`skel|${e.book}`) || [];
    if (!live.length || live.some((h) => h.ts === base)) return null;
    if (!live.some((h) => h.actor === e.actor && h.ts !== e.ts && descendsFrom(h.ts, base))) return null;
    return `${e.op} base ${e.base} is stale: this actor's own skeleton head advanced past it (ts ${e.ts}) — a structural edit cannot silently reverse an accepted structural action of the same actor; refuse to fold (§8.4)`;
  };
  const vkeyParts = (vkey) => { const i = vkey.indexOf(':'); return { chapter: vkey.slice(0, i), verse: vkey.slice(i + 1) }; };

  for (const e of events) {
    // ONE rootless-base gate for the whole structural class, before any op-specific work.
    if (CHAIN_OPS.has(e.op) && e.base == null) {
      if (e.op !== 'book.add') {
        // refuse to ACT, keep folding (D53d): the op's effect reads a base it never named
        rootlessStructural.push({ key: e.op === 'book.remove' ? `book|${e.book}` : `skel|${e.book}`, ts: e.ts });
        continue;
      }
      const same = (heads.get(`book|${e.book}`) || [])
        .find((h) => h.event.op === 'book.add' && canon(payloadOf(h.event)) === canon(payloadOf(e)));
      if (same) {
        // CONVERGE (D53d): one fact, two records — the later aliases to the earlier
        // root; no second head, and descendants/generation stamps resolve through it
        genAlias.set(e.ts, aliasTs(same.ts));
        acceptedStructural.add(e.ts); // a chain link others may legitimately base on
        continue;
      }
      // different payload (or the book does not exist yet): fall through — a first add
      // is a root, and a differing rootless add joins as a structural FORK head below
    }
    if (e.op === 'note.add') { notes.push(e); continue; }

    if (e.op === 'project.vrs.set') {
      // §8.5: immutable first-value register — first binds, identical repeat de-duplicates,
      // any different later value is surfaced and never applied.
      if (!vrs) vrs = { name: e.name, bytes: e.bytes, ts: e.ts };
      else if (vrs.name !== e.name || vrs.bytes !== e.bytes) vrsRejected.push(e.ts);
      continue;
    }

    if (e.op === 'book.add') {
      // §8.5: self-contained — {book, scope, skeleton, initialVerses} (shape: schema).
      // A re-add bases on the book.remove it follows; a first add is a root (base null).
      const pend = structuralBaseState(e, CHAIN_OPS);
      if (pend) { pendingStructural.push(pend); continue; }
      const initial = e.initialVerses || {};
      joinHead(`book|${e.book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book, event: e }, e.base, e.supersedes, e.actor);
      joinHead(`skel|${e.book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book,
        event: { op: 'text.skeleton.set', book: e.book, skeleton: e.skeleton } }, e.base, e.supersedes, e.actor);
      for (const k of slotKeysOf(e.skeleton)) {
        const { chapter, verse } = vkeyParts(k);
        // slot heads PUSH, never join (round 10, F2) — the same branch-local rule as
        // text.structure.apply post-images. joinHead's same-actor linear rule read a
        // PRIOR-GENERATION text head as this actor's own history and CONSUMED it, so a
        // same-actor remove + re-add ERASED the draft with no report, while a different
        // actor's re-add quarantined it. The prior head stays live; the generation
        // quarantine (ancestry, at projection) decides — one rule for every actor.
        pushHead(`text|${e.book}|${k}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book: e.book,
          event: { op: 'text.verse.set', book: e.book, chapter, verse, text: initial[k] ?? '___\n' } });
      }
      acceptedStructural.add(e.ts);
      continue;
    }

    if (e.op === 'book.remove') {
      // The SAME chain-link rule as every other structural op (round 8): a removal is a
      // chain link of the book's lineage, and it DELETES the book from the projection —
      // so an unvalidated base kind is the most destructive of the class, not the least.
      const pend = structuralBaseState(e, CHAIN_OPS);
      if (pend) { pendingStructural.push(pend); continue; }
      joinHead(`book|${e.book}`, { ts: e.ts, actor: e.actor, sanc: sancOf(e.base ?? null), book: e.book, event: e }, e.base, e.supersedes, e.actor);
      acceptedStructural.add(e.ts); // an accepted chain link — a later re-add may base on it
      continue;
    }

    if (e.op === 'text.skeleton.set') {
      // §8.4/§8.5 (round-5 simplification): a skeleton edit is an ORDINARY CHAIN LINK.
      // Its base MUST name the predecessor skeleton head (a book.add /
      // text.skeleton.set / text.structure.apply of the same book); the link inherits
      // that base's structural ancestry, so an accepted slot-preserving edit can never
      // move the selected chain or drop verse content. There is no historical-base
      // branch, no implicit rebasing, and no ancestry reconstruction. Same-base
      // competitors fork (explicit conflict, §8.3); an unknown base is pending until
      // it arrives (fold determinism stays per event-SET); an actor whose own head has
      // advanced past the claimed base is a writer defect and refuses — a skeleton
      // edit cannot silently reverse a text.structure.apply.
      // (a rootless text.skeleton.set never reaches here — the D53d gate above reports
      // it; the first skeleton comes from book.add)
      // The ONE chain-link rule (round 8): exists → else pend; a structural event of the
      // SAME book → else refuse; accepted → else pend transitively, so a descendant never
      // wins a fork off an unaccepted link.
      const pend = structuralBaseState(e, STRUCTURAL_OPS);
      if (pend) { pendingStructural.push(pend); continue; }
      const baseEv = byTs.get(e.base);
      if (JSON.stringify(slotKeysOf(baseEv.skeleton)) !== JSON.stringify(slotKeysOf(e.skeleton)))
        throw new Error(`text.skeleton.set changes the slot set (ts ${e.ts}) — refuse to fold; use text.structure.apply (§8.4)`);
      const staleErr = staleOwnSkeletonHead(e);
      if (staleErr) throw new Error(staleErr);
      joinHead(`skel|${e.book}`, { ts: e.ts, actor: e.actor, sanc: sancOf(e.base), book: e.book, event: e }, e.base, e.supersedes, e.actor);
      acceptedStructural.add(e.ts);
      continue;
    }

    if (e.op === 'text.structure.apply') {
      const book = e.book;
      const newSlots = slotKeysOf(e.skeleton);
      const transitions = e.transitions;
      const dispositions = e.dispositions;
      // shape (transitions cover the slots, stated texts, no double-claimed source,
      // the disposition enum + required to/post, no duplicates) is the SCHEMA's —
      // already refused in step 1. From here on: semantics only.
      const tKeys = Object.keys(transitions);
      // Source refs and disposition refs resolve through the D53d alias (round 12), the
      // same rule as base matching: a converged device's refs name its own aliased seed
      // slot-head ts, and the live head carries the canonical one. Pre-fix such refs
      // read as STALE and the action pended `conflicted` forever.
      const dispId = (d) => `${d.surface}|${d.key ?? ''}|${aliasTs(d.ts)}`;
      const dispSet = new Set(dispositions.map(dispId));
      // The ONE chain-link rule (round 8) — the SAME rule book.add and text.skeleton.set
      // apply: an unknown base pends (it may still arrive), a base that is not a
      // structural event of THIS book refuses (a text.verse.set base, or another book's
      // structure, has no lineage to inherit), and a present-but-unaccepted base pends
      // transitively across op types.
      {
        const pend = structuralBaseState(e, STRUCTURAL_OPS);
        if (pend) { pendingStructural.push(pend); continue; }
        const staleErr = staleOwnSkeletonHead(e);
        if (staleErr) throw new Error(staleErr);
      }
      // applicability (§8.5 all-or-nothing): every referenced source head present AND live
      const missing = []; const stale = [];
      const checkRef = (key, ts) => {
        if (!byTs.has(ts)) { missing.push(`${key}@${ts}`); return; }
        const live = heads.get(key) || [];
        if (!live.some((h) => h.ts === aliasTs(ts))) stale.push(`${key}@${ts}`);
      };
      for (const dest of tKeys)
        for (const src of transitions[dest].sources || []) checkRef(`text|${book}|${src.key}`, src.ts);
      for (const d of dispositions) {
        const key = d.surface === 'alignment' ? `align|${book}|${d.key}`
          : d.surface === 'decision' ? `dec|${d.key}`
          : d.surface === 'text' ? `text|${book}|${d.key}` : null;
        if (key) checkRef(key, d.ts);
        else if (!byTs.has(d.ts)) missing.push(`note@${d.ts}`);
      }
      if (missing.length) { pendingStructural.push({ ts: e.ts, book, status: 'incomplete', detail: missing }); continue; }
      if (stale.length)   { pendingStructural.push({ ts: e.ts, book, status: 'conflicted', detail: stale });  continue; }
      // §8.5: dispositions must be COMPLETE and CONSTRAINED — the fold computes the
      // affected-record set (every live alignment, decision, and verse-targeted note on
      // a MAPPED source key, re-keyed or removed, plus decisionKey-notes of re-keyed
      // decisions); every affected record needs exactly one disposition (else
      // incomplete), and every disposition MUST reference an affected record — a
      // disposition outside the set could consume any unrelated live record, so it
      // refuses the whole event (all-or-nothing).
      const mapped = new Set();
      for (const dest of tKeys)
        for (const src of transitions[dest].sources || []) if (src.key !== dest) mapped.add(src.key);
      const baseEvent = e.base ? byTs.get(e.base) : null;
      if (baseEvent && typeof baseEvent.skeleton === 'string')
        for (const k of slotKeysOf(baseEvent.skeleton)) if (!newSlots.includes(k)) mapped.add(k);
      // every source head this event CLAIMS — a claimed text head is carried forward by a
      // transition and needs no disposition; an unclaimed one on a mapped key does
      const claimedSrc = new Set();
      for (const dest of tKeys)
        for (const src of transitions[dest].sources || []) claimedSrc.add(`${src.key}|${aliasTs(src.ts)}`);
      const affected = new Set();
      for (const k of mapped) {
        // TEXT is a dependent record class like any other (round 9, D-F2). Verse text on a
        // slot this event removes, and that no transition claims as a source, is
        // UNCONSERVED without a disposition: it left the projection with no report and
        // then resurfaced as a zombie fork when the slot returned.
        for (const h of heads.get(`text|${book}|${k}`) || [])
          if (!claimedSrc.has(`${k}|${h.ts}`)) affected.add(`text|${k}|${h.ts}`);
        for (const h of heads.get(`align|${book}|${k}`) || []) affected.add(`alignment|${k}|${h.ts}`);
        for (const [dkey, live] of heads) {
          if (!dkey.startsWith('dec|')) continue;
          for (const h of live) {
            if (h.book !== book) continue;
            const c = h.event.decision.contextId;
            const r = c.reference;
            if (`${r.chapter}:${r.verse}` !== k) continue;
            affected.add(`decision|${dkey.slice(4)}|${h.ts}`);
            // a decisionKey-targeted note on a RE-KEYED decision is an affected record
            // too: its identity retires with the re-key, so it needs a disposition.
            // (invalidate-retain/replace keep the decision's key — such notes stay valid.)
            const decDisp = dispositions.find((d) => dispId(d) === `decision|${dkey.slice(4)}|${h.ts}`);
            if (decDisp && decDisp.action === 're-key') {
              for (const n of notes)
                if (n.target && n.target.decisionKey === dkey.slice(4)) affected.add(`note||${n.ts}`);
            }
          }
        }
        for (const n of notes) {
          const tg = n.target;
          if (tg && tg.book === book && `${tg.chapter}:${tg.verse}` === k) affected.add(`note||${n.ts}`);
        }
      }
      for (const d of dispositions)
        if (!affected.has(dispId(d)))
          throw new Error(`text.structure.apply disposition ${dispId(d)} references a record outside the affected set (ts ${e.ts}) — refuse to fold (§8.5: dispositions cannot consume unrelated records)`);
      // The note re-key destination is bound to the note's target KIND, and only the fold
      // knows BOTH the note and the destination — so the ONE shared predicate is applied
      // here, at the call site (the deferred half of round 8's finding 12). Pre-fix a
      // decisionKey-targeted note could be re-keyed to a verse slot string, producing
      // `{decisionKey: "1:1"}` — a target the schema itself rejects.
      for (const d of dispositions) {
        if (d.surface !== 'note' || d.action !== 're-key') continue;
        const n = notes.find((x) => x.ts === d.ts);
        const err = n && noteRekeyError(n.target, d.to, newSlots);
        if (err)
          throw new Error(`text.structure.apply note disposition ${err} (ts ${e.ts}) — refuse to fold (§8.5)`);
      }
      const undispositioned = [...affected].filter((id) => !dispSet.has(id));
      if (undispositioned.length) {
        pendingStructural.push({ ts: e.ts, book, status: 'incomplete', detail: undispositioned.map((u) => `undispositioned:${u}`) });
        continue;
      }
      // apply — the skeleton head joins normally (a stale base = a structural FORK head);
      // post-images always PUSH (branch-local: pre-images stay live for the other branch and
      // are shadowed on this branch by consumption).
      joinHead(`skel|${book}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book, event: e }, e.base, e.supersedes, e.actor);
      acceptedStructural.add(e.ts);
      for (const dest of newSlots) {
        const tr = transitions[dest];
        for (const src of tr.sources || []) consume(`text|${book}|${src.key}`, aliasTs(src.ts), e.ts);
        const { chapter, verse } = vkeyParts(dest);
        pushHead(`text|${book}|${dest}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
          event: { op: 'text.verse.set', book, chapter, verse, text: tr.text } });
      }
      for (const d of dispositions) {
        const dts = aliasTs(d.ts); // the D53d alias — the canonical head the ref names
        if (d.surface === 'text') {
          // the slot's content is DROPPED: consume the head on this branch (so it can
          // never resurface as a zombie when the slot returns) and RETAIN it for review
          const key = `text|${book}|${d.key}`;
          consume(key, dts, e.ts);
          retainedByStruct.push({ structTs: e.ts, key, ts: dts, reason: d.action });
        } else if (d.surface === 'alignment') {
          const key = `align|${book}|${d.key}`;
          const old = (heads.get(key) || []).find((h) => h.ts === dts);
          consume(key, dts, e.ts);
          if (d.action === 're-key') {
            const { chapter, verse } = vkeyParts(d.to);
            pushHead(`align|${book}|${d.to}`, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { ...old.event, op: 'align.verse.set', book, chapter, verse } });
          } else if (d.action === 'replace') {
            // the post-image carries the ORIGINAL record's `generation` (§8.5). Rebuilding
            // it without the stamp LAUNDERED the generation quarantine: a prior-generation
            // record resurrected through the conservative disposition that reconcile
            // itself emits (round 9, D-F5).
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'align.verse.set', book, generation: old.event.generation, ...d.post } });
          } else {
            retainedByStruct.push({ structTs: e.ts, key, ts: dts, reason: d.action });
          }
        } else if (d.surface === 'decision') {
          const key = `dec|${d.key}`;
          const old = (heads.get(key) || []).find((h) => h.ts === dts);
          consume(key, dts, e.ts);
          const toolId = old.event.toolId;
          const generation = old.event.generation; // never laundered — see above
          if (d.action === 're-key') {
            const { chapter, verse } = vkeyParts(d.to);
            // A slot key is a STRING. `Number("02")` is 2, so re-keying to slot `1:02`
            // put the record on verse 2 — a slot that does not exist — permanently
            // unreachable by any future structural action. The number form is taken only
            // when it round-trips exactly (§5.2 keeps a single verse as a JSON number).
            const numeric = (s) => (String(Number(s)) === s ? Number(s) : s);
            const dec = JSON.parse(JSON.stringify(old.event.decision));
            dec.contextId.reference.chapter = numeric(chapter);
            dec.contextId.reference.verse = numeric(verse);
            pushHead(decKeyOf(toolId, dec), { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, generation, decision: dec } });
          } else if (d.action === 'replace') {
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, generation, decision: d.post } });
          } else {
            // invalidate-retain / orphan-review: decisions are never deleted (D36) —
            // the record is retained, invalidated.
            const dec = { ...old.event.decision, invalidated: true, status: 'invalid' };
            pushHead(key, { ts: e.ts, actor: e.actor, sanc: e.ts, book,
              event: { op: 'check.decision.set', toolId, generation, decision: dec } });
            retainedByStruct.push({ structTs: e.ts, key, ts: dts, reason: d.action });
          }
        } else if (d.surface === 'note') {
          if (d.action === 're-key') noteRekey.set(d.ts, { structTs: e.ts, to: d.to });
          else {
            noteRetired.set(d.ts, e.ts);
            retainedByStruct.push({ structTs: e.ts, key: 'note', ts: d.ts, reason: d.action });
          }
        }
      }
      continue;
    }

    // standard LWW ops
    const key = keyOf(e);
    if (rootlessDefect(e, key)) { rootless.push({ key, ts: e.ts }); continue; }
    joinHead(key, { ts: e.ts, actor: e.actor, sanc: headSancFor(e), book: bookOfEvent(e), event: e }, e.base, e.supersedes, e.actor);
  }

  // 4. project — per book, select the winning skeleton head; its structural chain is the
  // selected branch (§8.5 lineage rule). Heads off the chain are retained, never projected.
  // (`chainOf` is declared above the event loop — the supersedes ancestry rule needs it.)
  const isConsumed = (key, ts, chain) => {
    const set = consumed.get(`${key}|${ts}`);
    if (!set) return false;
    for (const s of set) if (chain.has(s)) return true;
    return false;
  };

  const forks = [];
  const retained = [];
  // R-8.6.4 auto-merge bookkeeping (round 12): identical-payload heads collapse to ONE
  // projected record, and each collapse is REPORTED — {key, heads, winner} — so a losing
  // twin's observable state is the projected identical head. Pre-fix the twin was in NO
  // output list at all (not projected, retained, forked, invalid or pending): no bytes
  // lost, but a state the R-8.6.2 conservation vocabulary did not cover.
  const autoMerged = [];
  const maxTs = (arr) => arr.reduce((a, b) => (a.ts > b.ts ? a : b));
  // resolve a key under a chain: filter by ancestry + consumption, auto-merge identical
  // payloads, report a fork otherwise. skel keys skip the ancestry filter — a structural
  // fork is exactly the review item (#65).
  const resolved = new Map(); // memoized: each key resolves once (stable chain per key)
  const resolveKey = (key, chain, opts = {}) => {
    if (resolved.has(key)) return resolved.get(key);
    const r = resolveKeyRaw(key, chain, opts);
    resolved.set(key, r);
    return r;
  };
  const resolveKeyRaw = (key, chain, { skipAncestry = false, genRoot = null, priorRoots = EMPTY_SET } = {}) => {
    const live = heads.get(key) || [];
    if (live.length === 0) return null;
    let candidates = live;
    if (!skipAncestry && chain) {
      // §8.5 generational rule (CAUSAL): a record that carries `generation` belongs to
      // the current book generation iff it names the current generation root — the
      // writer's projected causal context decides, NEVER the HLC (offline edits arrive
      // with arbitrarily later timestamps, so a ts cutoff cannot implement quarantine).
      // Input records always carry the stamp (refused above otherwise); the field-less
      // branch covers CHAIN-BORNE heads only — text heads and structural post-images,
      // whose generation IS their structural ancestry, decided by `inChain` below.
      //
      // ROUND 9: the field-less branch used to end in `h.ts > genRoot` — an HLC cutoff,
      // the exact mechanism §8.5 forbids by name. It was reachable because an unanchored
      // head (`sanc == null`) fell through to it, so a still-offline actor's
      // prior-generation draft won or lost purely by clock. Unanchored heads no longer
      // reach the projection at all (the rootless-base rule), and the cutoff is gone.
      const inGeneration = (h) => {
        const g = h.event.generation;
        return g === undefined || genRoot == null || aliasTs(g) === genRoot;
      };
      // An ANCHOR is required. `sanc == null` used to pass unconditionally — "belongs to
      // every branch" — which is how a rootless or cycle-based content op projected under
      // every structural branch and overwrote the winning branch's post-image.
      const inChain = (h) => h.sanc != null && chain.has(h.sanc);
      candidates = live.filter((h) => inGeneration(h) && inChain(h) && !isConsumed(key, h.ts, chain));
      for (const h of live) {
        if (!inGeneration(h)) retained.push({ key, ts: h.ts, reason: 'prior-generation' });
        else if (h.sanc == null) retained.push({ key, ts: h.ts, reason: 'no-structural-ancestor' });
        // an anchor that is a PRIOR generation root of this same book is a generation
        // miss, not a branch miss — name it for what it is
        else if (!chain.has(h.sanc)) retained.push({ key, ts: h.ts, reason: priorRoots.has(h.sanc) ? 'prior-generation' : 'unselected-structural-branch' });
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      // payload identity resolves `generation` through the D53d alias: two seeded
      // records whose stamps name CONVERGED creation roots carry the same fact
      const payloadCanon = (ev) => {
        const p = payloadOf(ev);
        if (typeof p.generation === 'string') putOwn(p, 'generation', aliasTs(p.generation));
        return canon(p);
      };
      const c0 = payloadCanon(candidates[0].event);
      if (candidates.every((h) => payloadCanon(h.event) === c0)) {
        const winner = maxTs(candidates);
        autoMerged.push({ key, heads: candidates.map((h) => h.ts).sort(), winner: winner.ts });
        candidates = [winner];
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
  const chains = new Map();   // book -> chain (Set)
  const genRoots = new Map(); // book -> the current generation root (book.add ts, §8.5)
  const bookCodes = new Set([...heads.keys()].filter((k) => k.startsWith('book|')).map((k) => k.slice(5)));
  const headsTs = {};
  // Every generation root this union ever held, per book (§8.5) — so a head anchored to a
  // RETIRED root of its own book is reported as `prior-generation`, not as a branch miss.
  const rootsOfBook = new Map();
  for (const e of events) {
    if (e.op !== 'book.add') continue;
    if (!rootsOfBook.has(e.book)) rootsOfBook.set(e.book, new Set());
    rootsOfBook.get(e.book).add(e.ts);
  }
  const optsFor = (book) => ({ genRoot: genRoots.get(book), priorRoots: rootsOfBook.get(book) || EMPTY_SET });
  for (const book of bookCodes) {
    const bookHead = resolveKey(`book|${book}`, null, { skipAncestry: true });
    if (bookHead) headsTs[`book|${book}`] = bookHead.ts;
    if (!bookHead || bookHead.event.op !== 'book.add') continue; // absent books fold but don't project
    scope[book] = bookHead.event.scope ?? [];
    genRoots.set(book, bookHead.ts);
    const skelHead = resolveKey(`skel|${book}`, null, { skipAncestry: true });
    if (!skelHead) continue;
    headsTs[`skel|${book}`] = skelHead.ts;
    const chain = chainOf(skelHead.sanc);
    chains.set(book, chain);
    const skeleton = skelHead.event.skeleton;
    const verses = {};
    for (const k of slotKeysOf(skeleton)) {
      const h = resolveKey(`text|${book}|${k}`, chain, optsFor(book));
      verses[k] = h ? h.event.text : '___\n'; // §4.1 stub for a slot with no live verse head
      if (h) headsTs[`text|${book}|${k}`] = h.ts;
    }
    books[book] = { usfm: recompose(skeleton, verses), verses };
    // resolve the book's non-slot text keys too: their heads never project (no slot),
    // but off-branch descendants must surface in retained[] (§8.5 lineage rule), and a
    // live head on a key with NO SLOT is the §8.6 orphan backstop for TEXT — the same
    // rule alignments already had. Without it, drafted text on a slot a structural action
    // removed was the one dependent record class that went silently absent (round 9).
    for (const key of heads.keys()) {
      if (!key.startsWith(`text|${book}|`)) continue;
      const vkey = key.slice(`text|${book}|`.length);
      if (vkey in verses) continue;
      const h = resolveKey(key, chain, optsFor(book));
      if (h) retained.push({ key, ts: h.ts, reason: 'orphaned-text' });
    }
  }
  const allChains = new Set();
  for (const c of chains.values()) for (const s of c) allChains.add(s);

  // §8.5: "content events for absent books fold but don't project". The rule was written
  // and never implemented: an absent book left `chains`/`genRoots` unset, `resolveKey`
  // was handed a null chain, and the ancestry filter was SKIPPED ENTIRELY — so a removed
  // book kept projecting its decisions, alignments and notes AND lost its generation
  // quarantine at the same time. A book with no selected chain now retains its content
  // records and projects none of them (round 9, D-F4).
  const absentBook = (book) => book != null && !chains.has(book);
  const retainAll = (key, reason) => { for (const h of heads.get(key) || []) retained.push({ key, ts: h.ts, reason }); };

  const decisions = {};
  for (const key of heads.keys()) {
    if (!key.startsWith('dec|')) continue;
    const anyHead = heads.get(key)[0];
    if (absentBook(anyHead.book)) { retainAll(key, 'absent-book'); continue; }
    const h = resolveKey(key, chains.get(anyHead.book), optsFor(anyHead.book));
    if (!h) continue;
    headsTs[key] = h.ts;
    (decisions[h.event.toolId] ||= []).push(h.event.decision);
  }
  for (const t of Object.keys(decisions))
    decisions[t].sort((a, b) => canon(a.contextId) < canon(b.contextId) ? -1 : 1);

  // TEXT is bound by the SAME absent-book conservation rule (round 10, F2). The two
  // loops below retained decisions and alignments of a removed book; verse text — the
  // one surface whose loss is the product's whole promise — was skipped, so a removed
  // book's live text heads ended in NO observable state.
  for (const key of heads.keys()) {
    if (!key.startsWith('text|')) continue;
    const anyHead = heads.get(key)[0];
    if (absentBook(anyHead.book)) retainAll(key, 'absent-book');
  }

  const alignments = {}; const invalid = [];
  for (const key of heads.keys()) {
    if (!key.startsWith('align|')) continue;
    const anyHead = heads.get(key)[0];
    if (absentBook(anyHead.book)) { retainAll(key, 'absent-book'); continue; }
    const h = resolveKey(key, chains.get(anyHead.book), optsFor(anyHead.book));
    if (!h) continue;
    headsTs[key] = h.ts;
    const ev = h.event;
    const vkey = `${ev.chapter}:${ev.verse}`;
    // carry the COMPLETE §5.1 record: every payload field (sourceVersion, invalid, …),
    // not a hand-picked subset — seeding must reproduce real projects byte-for-byte.
    // `generation` is fold bookkeeping (§8.5), never part of the projected §5.1 record.
    const record = {};
    for (const k of Object.keys(ev))
      if (!ENVELOPE.has(k) && k !== 'op' && k !== 'book' && k !== 'chapter' && k !== 'verse' && k !== 'generation') record[k] = ev[k];
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

  // §8.5: a note belongs to a book either by its verse target or by the bookId embedded
  // in its decision key (toolId|checkId|bookId|chapter|verse|occurrence)
  const noteBookOf = (n) => {
    const tg = n.target || {};
    if (tg.book) return tg.book;
    if (typeof tg.decisionKey === 'string') {
      const bookId = tg.decisionKey.split('|')[2];
      if (bookId) return bookId.toUpperCase();
    }
    return null;
  };
  const notesOut = [];
  for (const n of notes) {
    const nb = noteBookOf(n);
    // a note of an ABSENT book folds but does not project, exactly like every other
    // content record of that book (§8.5)
    if (nb && bookCodes.has(nb) && !chains.has(nb)) {
      retained.push({ key: 'note', ts: n.ts, reason: 'absent-book' });
      continue;
    }
    // §8.5 generational rule for notes (verse- AND decisionKey-targeted): the stamp is
    // unconditional, so quarantine is purely causal — a mismatch with the book's
    // current generation root quarantines regardless of ts
    if (nb && genRoots.has(nb) && aliasTs(n.generation) !== genRoots.get(nb)) {
      retained.push({ key: 'note', ts: n.ts, reason: 'prior-generation' });
      continue;
    }
    // A note dispositioned `orphan-review` / `invalidate-retain` on the SELECTED chain is
    // RETAINED — and retained means NOT projected. Pre-fix it was both at once: two
    // observable states for one record, one of them pointing at a slot that is gone.
    const retire = noteRetired.get(n.ts);
    if (retire !== undefined && allChains.has(retire)) continue;
    notesOut.push(rewriteNote(n));
  }
  function rewriteNote(n) {
    const rk = noteRekey.get(n.ts);
    if (rk && allChains.has(rk.structTs)) {
      // a decisionKey-targeted note re-keys to the NEW decision key;
      // a verse-targeted note re-keys to the new verse key
      if (n.target && n.target.decisionKey !== undefined) return { ...n, target: { decisionKey: rk.to } };
      const { chapter, verse } = { chapter: rk.to.split(':')[0], verse: rk.to.split(':').slice(1).join(':') };
      return { ...n, target: { ...n.target, chapter, verse } };
    }
    return n;
  }
  for (const r of retainedByStruct) if (allChains.has(r.structTs)) retained.push({ key: r.key, ts: r.ts, reason: r.reason });
  for (const s of superseded) retained.push({ key: s.key, ts: s.ts, reason: 'superseded' });
  for (const r of rootless) retained.push({ key: r.key, ts: r.ts, reason: 'rootless-base' });
  for (const r of rootlessStructural) retained.push({ key: r.key, ts: r.ts, reason: 'rootless-structural' });

  // §8.5/§5.4 dotted-path registers: `a` and `a.b` are DIFFERENT register keys that write
  // the SAME place in the projected document, so the later write silently clobbered the
  // earlier — no fork, no retained entry, no report. The resolution semantics are now
  // normative [§8.5, D54, decided 2026-08-17]: the loss is never silent. The later `ts` takes
  // the projection and the earlier is retained and reported.
  const prefixResolve = (paths, headTsOf, label) => {
    const drop = new Set();
    const keys = Object.keys(paths);
    for (const a of keys) for (const b of keys) {
      if (a === b || !b.startsWith(`${a}.`)) continue;
      const loser = headTsOf(a) > headTsOf(b) ? b : a;
      drop.add(loser);
      retained.push({ key: `${label}|${loser}`, ts: headTsOf(loser), reason: 'prefix-collision' });
    }
    for (const p of drop) delete paths[p];
  };
  prefixResolve(settings, (p) => headsTs[`set|${p}`], 'set');
  prefixResolve(projectMeta, (p) => headsTs[`meta|${p}`], 'meta');

  return {
    books, decisions, alignments, pins, projectMeta, projectMetaRemoved, settings, notes: notesOut,
    forks, invalid, retained, autoMerged, scope,
    vrs: vrs ? { name: vrs.name, bytes: vrs.bytes } : null, vrsRejected,
    pendingStructural, headsTs, supersedeRefused,
    // The RAW live-head sets (§8.6 step 3), exposed because §8.8 reconcile must build its
    // dispositions from the SAME set the fold computes its affected set from. Reconcile
    // used to enumerate PROJECTED records, so a quarantined or losing-fork head was live
    // for the fold and invisible to reconcile — and every reconcile of such a book emitted
    // a `text.structure.apply` the fold then permanently refused as `incomplete`.
    liveHeads: Object.fromEntries([...heads].map(([k, v]) => [k, v.map((h) => ({ ts: h.ts, actor: h.actor, book: h.book }))])),
    liveNotes: notes.map((n) => ({ ts: n.ts, target: n.target, generation: n.generation })),
  };
};
