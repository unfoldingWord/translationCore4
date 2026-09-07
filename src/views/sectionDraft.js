// Section drafting — the design's Type / Place verse numbers flow (#141),
// after ts-desktop's markersToBalloons / balloonsToMarkers. Pure functions
// over a section's verse KEYS in order (["9", "10"], or a bridge ["9-10"]).
//
// Type mode holds the section as text: a line that starts with one of the
// section's verse keys begins that verse. Place mode holds a flat word list
// plus one pin index per verse (`markers[key] = index of the word the verse
// begins at`). Invariants the functions keep:
//   · words are never changed or reordered — only pins move;
//   · the section's first verse is fixed at word 0;
//   · a pin can never pass a neighbouring pin (canDrop refuses it).

const LINE = /^(\d+(?:-\d+)?)(?:\s+(.*))?$/s;

/** Read the typed section into words and pins. Pins out of order are dropped
 * (they return to the bank) so the marker set is always monotonic. */
export const parseDraft = (text, keys) => {
  /** @type {string[]} */
  const words = [];
  /** @type {Record<string, number>} */
  const found = {};
  for (const line of String(text ?? '').split(/\n+/)) {
    let rest = line.trim();
    if (!rest) continue;
    const m = rest.match(LINE);
    if (m && keys.includes(m[1])) {
      found[m[1]] = words.length;
      rest = m[2] ?? '';
    }
    for (const w of rest.split(/\s+/)) if (w) words.push(w);
  }
  /** @type {Record<string, number>} */
  const markers = {};
  if (words.length === 0) return { words, markers };
  markers[keys[0]] = 0;
  let last = 0;
  for (const k of keys.slice(1)) {
    const at = found[k];
    if (at === undefined || at <= last || at >= words.length) continue;
    markers[k] = at;
    last = at;
  }
  return { words, markers };
};

/** The text of each verse from the pinned word list: a verse runs from its pin
 * to the next pin. Only verses with text are returned. */
export const sectionVerses = (words, markers, keys) => {
  const at = {};
  for (const k of Object.keys(markers)) at[markers[k]] = k;
  const buf = {};
  let cur = keys[0];
  words.forEach((w, i) => {
    if (at[i] !== undefined) cur = at[i];
    buf[cur] = buf[cur] ? `${buf[cur]} ${w}` : w;
  });
  const out = {};
  for (const k of keys) if (buf[k]) out[k] = buf[k];
  return out;
};

/** Write the pinned word list back out as Type-mode text, one verse per line. */
export const serializeDraft = (words, markers, keys) => {
  const verses = sectionVerses(words, markers, keys);
  return keys.filter((k) => verses[k]).map((k) => `${k} ${verses[k]}`).join('\n');
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
