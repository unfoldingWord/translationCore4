// Section drafting — the design's Type / Place verse numbers flow (#141),
// after ts-desktop's markersToBalloons / balloonsToMarkers, and the verse-span
// gesture on top of it (#63, D70.3). Pure functions over a section's verse
// KEYS as the book has them (["9", "10"], or with a span ["9-10", "11"]) and
// its PINS: every single verse number of the section in order (expandKeys).
//
// Type mode holds the section as text: a line that starts with one of the
// section's pins begins that verse; a line that starts with a run of pins
// ("9-10") begins that span. Place mode holds a flat word list, the whitespace
// that followed each word (`seps`, so an untouched verse serializes back
// byte-for-byte), and one pin index per verse
// (`markers[pin] = index of the word the verse begins at`). Invariants:
//   · words and their separators are never changed or reordered — only pins move;
//   · the section's first verse is fixed at word 0 while it has words;
//   · a pin can never pass a neighbouring pin (canDrop refuses it);
//   · pins that share an index are one span — the verses' text in order (#63);
//   · an unplaced pin is a stub verse: it has no text.

/** The single verse numbers of a key list: "9-10" is 9 and 10. */
export const expandKeys = (keys) => keys.flatMap((k) => {
  const m = /^(\d+)-(\d+)$/.exec(String(k));
  if (!m) return [String(k)];
  const out = [];
  for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
  return out;
});

/** The pins a marker token names: one pin, or every pin of a run "a-b" whose
 * two ends are pins of this section, in order. Anything else is not a marker. */
const runOf = (tok, pins) => {
  if (pins.includes(tok)) return [tok];
  const m = /^(\d+)-(\d+)$/.exec(tok);
  if (!m) return null;
  const a = pins.indexOf(m[1]);
  const b = pins.indexOf(m[2]);
  return a >= 0 && b > a ? pins.slice(a, b + 1) : null;
};

// A line that BEGINS with one of the section's pins (or a run of them) begins
// that verse. The token must sit at column 0: a verse body may wrap onto a
// line that starts with a number of its own ("…y le dio\n10 talentos"), and
// reading that as a marker would move the words and rewrite a verse nobody
// edited (Codex review, round 2). Such a body line is written out indented by
// one space, and the parser takes that one space back off — the escape is
// invisible in the file.
const LINE = /^(\d+(?:-\d+)?)(?:\s+|$)([\s\S]*)$/;

const markerLine = (line, pins) => {
  const m = String(line).match(LINE);
  const run = m && runOf(m[1], pins);
  return run ? { run, rest: m[2] } : null;
};

/** A body line that needs the escape: a section pin (or run) under any number
 * of leading spaces. Counting the ALREADY-indented forms too is what makes the
 * escape reversible — one space is added, one space is taken off, whatever the
 * line started with (Codex review, round 3). */
const escapable = (line, pins) => {
  const m = String(line).match(/^( *)(\d+(?:-\d+)?)(?:\s|$)/);
  return !!m && runOf(m[2], pins) !== null;
};

/** Indent every continuation line of a body that would read as a marker. */
const escapeBody = (body, pins) => String(body)
  .split('\n')
  .map((line, i) => (i > 0 && escapable(line, pins) ? ` ${line}` : line))
  .join('\n');

/** The card's opening text: one "key body" line per verse, a stub verse an
 * empty one, and nothing at all for a section with no draft yet. Without the
 * stub's own line a stub first verse would take the next verse's words. */
export const initialDraftText = (verses, pins) => (verses.some((v) => v.drafted)
  ? verses.map((v) => `${v.n} ${v.drafted ? escapeBody(v.body, pins) : ''}`).join('\n')
  : '');

/** Read the typed section into words, separators and pins. A pin that would
 * pass an earlier pin is dropped (it returns to the bank). */
export const parseDraft = (text, pins) => {
  /** @type {string[]} */
  const words = [];
  /** @type {string[]} */
  const seps = [];
  /** Each pin found in the text: the word index it marks, and the LINE it was
   * written on. The line settles a tie — two pins at the same word index are
   * one span when they were written on one line ("9-10 …"), and an empty
   * verse followed by its neighbour when they were written on two: the
   * earlier line's verse has no words, so it is a stub (Codex round 1, #63). */
  /** @type {Record<string, { at: number, line: number }>} */
  const found = {};
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, li) => {
    let rest = line;
    const m = markerLine(rest, pins);
    if (m) {
      for (const p of m.run) found[p] = { at: words.length, line: li };
      rest = m.rest;
    } else if (rest.startsWith(' ') && escapable(rest.slice(1), pins)) {
      rest = rest.slice(1); // an escaped body line: the words are text, not a marker
    }
    const tokens = rest.split(/(\s+)/);
    for (let i = 0; i < tokens.length; i++) {
      if (i % 2 === 0) {
        if (tokens[i] !== '') { words.push(tokens[i]); seps.push(''); }
      } else if (words.length) {
        seps[words.length - 1] += tokens[i];
      }
    }
    if (li < lines.length - 1 && words.length) seps[words.length - 1] += '\n';
  });
  /** @type {Record<string, number>} */
  const markers = {};
  if (words.length === 0) return { words, seps, markers };
  // The first pin is fixed at word 0 — unless a later pin begins there on a
  // later line, which makes the first verse a stub.
  markers[pins[0]] = 0;
  let last = { at: 0, line: found[pins[0]]?.line ?? -1 };
  for (const k of pins.slice(1)) {
    const f = found[k];
    if (f === undefined || f.at >= words.length || f.at < last.at) continue;
    if (f.at === last.at) {
      if (f.line < last.line) continue; // out of order: the pin goes to the bank
      // A later line at the same word: the verses written before it at that
      // word own no words — stubs, unplaced. The same line: one span.
      if (f.line > last.line) for (const p of Object.keys(markers)) if (markers[p] === f.at) delete markers[p];
    }
    markers[k] = f.at;
    last = f;
  }
  return { words, seps, markers };
};

/** The original key a pin belongs to. */
const keyOfPin = (pin, keys) => keys.find((k) => expandKeys([k]).includes(pin));

/** The section's verses as the save will write them, in order: placed pins
 * that share an index are one span (`key` "9-10"); an unplaced pin is a stub
 * — and a span whose pins are ALL unplaced stays the stub span it was. */
export const sectionGroups = (markers, pins, keys = pins) => {
  const groups = [];
  let i = 0;
  while (i < pins.length) {
    const at = markers[pins[i]];
    if (at === undefined) {
      const orig = String(keyOfPin(pins[i], keys) ?? pins[i]);
      const members = expandKeys([orig]);
      const whole = members[0] === pins[i] && members.every((p) => markers[p] === undefined);
      const run = whole ? members : [pins[i]];
      groups.push({ key: whole ? orig : pins[i], members: run, at: undefined });
      i += run.length;
    } else {
      let j = i;
      while (j + 1 < pins.length && markers[pins[j + 1]] === at) j++;
      const members = pins.slice(i, j + 1);
      groups.push({ key: members.length > 1 ? `${members[0]}-${members[members.length - 1]}` : members[0], members, at });
      i = j + 1;
    }
  }
  return groups;
};

/** The section's verse keys after the edit, stubs included. */
export const sectionKeys = (markers, pins, keys = pins) => sectionGroups(markers, pins, keys).map((g) => g.key);

/** The text of each verse from the pinned word list: a verse (or span) runs
 * from its pin to the next pin, words joined by their own separators. Only
 * verses with text are returned, keyed by the key the save writes. */
export const sectionVerses = (words, seps, markers, pins, keys = pins) => {
  const groups = sectionGroups(markers, pins, keys);
  const at = {};
  for (const g of groups) if (g.at !== undefined) at[g.at] = g.key;
  const buf = {};
  let cur = groups[0].key; // words before any pin belong to the first verse
  words.forEach((w, i) => {
    if (at[i] !== undefined) cur = at[i];
    buf[cur] = (buf[cur] ?? '') + w + (seps[i] ?? '');
  });
  const out = {};
  for (const g of groups) {
    const t = (buf[g.key] ?? '').trim();
    if (t) out[g.key] = t;
  }
  return out;
};

/** Write the pinned word list back out as Type-mode text, one verse per line. */
export const serializeDraft = (words, seps, markers, pins, keys = pins) => {
  const verses = sectionVerses(words, seps, markers, pins, keys);
  return sectionGroups(markers, pins, keys).filter((g) => verses[g.key]).map((g) => `${g.key} ${escapeBody(verses[g.key], pins)}`).join('\n');
};

/** May `pin` begin at word `index`? Never the first verse (fixed), never past
 * a later verse's pin, never before an earlier verse's pin. ON another pin is
 * allowed: the two form a span (#63) — unless an unplaced pin would then sit
 * inside that span. The pin's own current position is ignored (it is in hand). */
export const canDrop = (markers, pins, pin, index) => {
  const pos = pins.indexOf(pin);
  if (pos <= 0 || index < 0) return false;
  for (const k of pins) {
    if (k === pin || markers[k] === undefined) continue;
    if (pins.indexOf(k) < pos ? markers[k] > index : markers[k] < index) return false;
  }
  const stacked = pins.filter((k) => k !== pin && markers[k] === index).map((k) => pins.indexOf(k));
  if (stacked.length) {
    const lo = Math.min(pos, ...stacked);
    const hi = Math.max(pos, ...stacked);
    for (let i = lo; i <= hi; i++) if (pins[i] !== pin && markers[pins[i]] === undefined) return false;
  }
  return true;
};

/** The markers after `pin` lands at `index`. The first verse takes the
 * leading words back when no pin begins at word 0 any more (a stub first
 * verse whose neighbour moved on). */
export const dropPin = (markers, pins, pin, index) => {
  const next = { ...markers, [pin]: index };
  if (next[pins[0]] === undefined && !pins.some((k) => next[k] === 0)) next[pins[0]] = 0;
  return next;
};

/** Where a verse beginning at `index` would end: the next pin after it, the
 * held pin's old place ignored. */
export const spanEnd = (markers, index, held, total) => {
  let end = total;
  for (const k of Object.keys(markers)) {
    const i = markers[k];
    if (k !== held && i > index && i < end) end = i;
  }
  return end;
};
