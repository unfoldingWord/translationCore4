// Section drafting — the design's Type / Place verse numbers flow (#141),
// after ts-desktop's markersToBalloons / balloonsToMarkers. Pure functions
// over a section's verse KEYS in order (["9", "10"], or a bridge ["9-10"]).
//
// Type mode holds the section as text: a line that starts with one of the
// section's verse keys begins that verse. Place mode holds a flat word list,
// the whitespace that followed each word (`seps`, so an untouched verse
// serializes back byte-for-byte), and one pin index per verse
// (`markers[key] = index of the word the verse begins at`). Invariants:
//   · words and their separators are never changed or reordered — only pins move;
//   · the section's first verse is fixed at word 0;
//   · a pin can never pass a neighbouring pin (canDrop refuses it). Two pins
//     may share an index only when the earlier verse has no words (a stub
//     verse before a drafted one); a drop can never create that state (#63).

// A line that BEGINS with one of the section's verse keys begins that verse.
// The key must sit at column 0: a verse body may wrap onto a line that starts
// with a number of its own ("…y le dio\n10 talentos"), and reading that as a
// marker would move the words and rewrite a verse nobody edited (Codex review,
// round 2). Such a body line is written out indented by one space, and the
// parser takes that one space back off — the escape is invisible in the file.
const LINE = /^(\d+(?:-\d+)?)(?:\s+|$)([\s\S]*)$/;

const markerKey = (line, keys) => {
  const m = String(line).match(LINE);
  return m && keys.includes(m[1]) ? m : null;
};

/** Indent every continuation line of a body that would read as a marker. */
const escapeBody = (body, keys) => String(body)
  .split('\n')
  .map((line, i) => (i > 0 && markerKey(line, keys) ? ` ${line}` : line))
  .join('\n');

/** The card's opening text: one "key body" line per verse, a stub verse an
 * empty one, and nothing at all for a section with no draft yet. Without the
 * stub's own line a stub first verse would take the next verse's words. */
export const initialDraftText = (verses, keys) => (verses.some((v) => v.drafted)
  ? verses.map((v) => `${v.n} ${v.drafted ? escapeBody(v.body, keys) : ''}`).join('\n')
  : '');

/** Read the typed section into words, separators and pins. A pin that would
 * pass an earlier pin is dropped (it returns to the bank). */
export const parseDraft = (text, keys) => {
  /** @type {string[]} */
  const words = [];
  /** @type {string[]} */
  const seps = [];
  /** Each key found in the text: the word index it marks, and the LINE it was
   * written on. The line settles a tie — two keys at the same word index are
   * an empty leading verse followed by its neighbour only when they were
   * written in that order (Codex round 1). */
  /** @type {Record<string, { at: number, line: number }>} */
  const found = {};
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, li) => {
    let rest = line;
    const m = markerKey(rest, keys);
    if (m) {
      found[m[1]] = { at: words.length, line: li };
      rest = m[2];
    } else if (rest.startsWith(' ') && markerKey(rest.slice(1), keys)) {
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
  markers[keys[0]] = 0;
  let last = { at: 0, line: found[keys[0]]?.line ?? -1 };
  for (const k of keys.slice(1)) {
    const f = found[k];
    if (f === undefined || f.at >= words.length) continue;
    // Later in the words than the verse before it — or at the same word, when
    // that verse was written first and so owns no words (a stub before a
    // drafted verse). Anything else is out of order: the pin goes to the bank.
    if (f.at < last.at || (f.at === last.at && f.line <= last.line)) continue;
    markers[k] = f.at;
    last = f;
  }
  return { words, seps, markers };
};

/** The text of each verse from the pinned word list: a verse runs from its pin
 * to the next pin, words joined by their own separators. Only verses with text
 * are returned. */
export const sectionVerses = (words, seps, markers, keys) => {
  const at = {};
  for (const k of keys) if (markers[k] !== undefined) at[markers[k]] = k; // a later key wins a shared index
  const buf = {};
  let cur = keys[0];
  words.forEach((w, i) => {
    if (at[i] !== undefined) cur = at[i];
    buf[cur] = (buf[cur] ?? '') + w + (seps[i] ?? '');
  });
  const out = {};
  for (const k of keys) {
    const t = (buf[k] ?? '').trim();
    if (t) out[k] = t;
  }
  return out;
};

/** Write the pinned word list back out as Type-mode text, one verse per line. */
export const serializeDraft = (words, seps, markers, keys) => {
  const verses = sectionVerses(words, seps, markers, keys);
  return keys.filter((k) => verses[k]).map((k) => `${k} ${escapeBody(verses[k], keys)}`).join('\n');
};

/** May `pin` begin at word `index`? Never the first verse (fixed), never on or
 * past a later verse's pin, never on or before an earlier verse's pin. The
 * pin's own current position is ignored (it is in hand). */
export const canDrop = (markers, keys, pin, index) => {
  const pos = keys.indexOf(pin);
  if (pos <= 0 || index < 0) return false;
  for (const k of keys) {
    if (k === pin || markers[k] === undefined) continue;
    if (keys.indexOf(k) < pos ? markers[k] >= index : markers[k] <= index) return false;
  }
  return true;
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
