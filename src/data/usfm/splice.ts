// Splice engine — THE ONLY mutation path for book text (arch §7.2 AD-1/AD-4,
// checklist C1a.3). An edit to one verse becomes a whole-book raw-string
// splice; every byte outside the replaced range stays identical (FR-7).
// The result feeds BurritoStore.writeBook whole-file — callers never pass
// re-serialized USFM (D8: usfm-js never re-serializes).
import { findVerse, indexBook } from './indexer';

/** Typed failure: the raw book does not contain the addressed verse. Partial
 * books are legal (D26), so "not found" is a normal, catchable condition. */
export class VerseNotFoundError extends Error {
  constructor(
    readonly chapter: string,
    readonly verseKey: string,
  ) {
    super(`verse not found: chapter ${chapter}, verse "${verseKey}"`);
    this.name = 'VerseNotFoundError';
  }
}

/** Read one verse body from the raw book, or null when absent. */
export const verseBody = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
): string | null => {
  const entry = findVerse(indexBook(rawBook), chapter, verseKey);
  return entry ? rawBook.slice(entry.start, entry.end) : null;
};

/** Replace exactly the indexed verse-body range; return the whole-book string.
 * Throws VerseNotFoundError when the verse is not in the file.
 *
 * Empty-verse guard (review finding M3, 2026-07-30): a contentless `\v N` line
 * indexes as a zero-width body flush against the key token. Writing a body
 * there without a separator would glue it onto the number (`\v 2H`) and
 * destroy the verse identity for every later parse. When the character before
 * the insert point is not whitespace, a single space is added — that byte is
 * part of the `\v N ` marker grammar, not a violation of byte-strictness
 * (the identity splice of an empty body onto an empty range stays byte-exact
 * because nothing is written). */
export const spliceVerse = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
  newBody: string,
): string => {
  const entry = findVerse(indexBook(rawBook), chapter, verseKey);
  if (!entry) throw new VerseNotFoundError(String(chapter), verseKey);
  const sep =
    newBody !== '' && entry.start > 0 && !/\s/.test(rawBook[entry.start - 1]) ? ' ' : '';
  return rawBook.slice(0, entry.start) + sep + newBody + rawBook.slice(entry.end);
};

/** The start of an indexed verse's own `\\v` marker line (the body follows it). */
const markerStart = (rawBook: string, entry: { start: number; verseKey: string }): number => {
  const at = rawBook.lastIndexOf('\\v', entry.start - 1);
  const ok = at >= 0 && new RegExp(`^\\\\v[ \\t]+${entry.verseKey.replace('-', '\\-')}(?:[ \\t]|$)`).test(rawBook.slice(at, entry.start));
  if (!ok) throw new Error(`spliceSection: no marker found for verse "${entry.verseKey}"`);
  return at;
};

/** Rewrite a run of verses as a new run (#63: a verse span created or
 * broken). `oldKeys` are the verses as the book has them, in order;
 * `verses` are the keys and bodies to write in their place (an empty body is
 * the `___` stub, BURRITO-SPEC §4.1). Only the verses that actually change —
 * by key or by body — are rewritten, from the first to the last of them; every
 * byte outside that range stays identical (FR-7). Bytes BETWEEN the rewritten
 * verses (a paragraph marker line) are replaced with the new verse lines. */
export const spliceSection = (
  rawBook: string,
  chapter: string | number,
  oldKeys: readonly string[],
  verses: ReadonlyArray<{ key: string; body: string }>,
): string => {
  const entries = indexBook(rawBook);
  const old = oldKeys.map((key) => {
    const entry = findVerse(entries, chapter, key);
    if (!entry) throw new VerseNotFoundError(String(chapter), key);
    return { key, entry, body: rawBook.slice(entry.start, entry.end) };
  });
  const line = (v: { key: string; body: string }): string => `\\v ${v.key} ${v.body === '' ? '___' : v.body}`;
  const same = (o: { key: string; body: string }, v: { key: string; body: string }): boolean =>
    o.key === v.key && o.body === (v.body === '' ? '___' : v.body);
  let lo = 0;
  while (lo < old.length && lo < verses.length && same(old[lo], verses[lo])) lo++;
  let hi = 0;
  while (hi < old.length - lo && hi < verses.length - lo && same(old[old.length - 1 - hi], verses[verses.length - 1 - hi])) hi++;
  if (lo + hi >= old.length) {
    if (lo + hi >= verses.length) return rawBook; // nothing changed
    throw new Error('spliceSection: the new verses only add to the old ones');
  }
  const start = markerStart(rawBook, old[lo].entry);
  const end = old[old.length - 1 - hi].entry.end;
  return rawBook.slice(0, start) + verses.slice(lo, verses.length - hi).map(line).join('\n') + rawBook.slice(end);
};

interface GapMarkerMatch {
  marker: 'p' | 'q1' | 'q2';
  start: number;
  end: number;
}

/** Boundaries [start, end) of the gap between a verse body and the next verse / chapter marker. */
const getVerseGap = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
): { start: number; end: number } => {
  const entries = indexBook(rawBook);
  const idx = entries.findIndex((e) => e.chapter === String(chapter) && e.verseKey === verseKey);
  if (idx === -1) throw new VerseNotFoundError(String(chapter), verseKey);
  const gapStart = entries[idx].end;
  let gapEnd = rawBook.length;
  if (idx + 1 < entries.length && entries[idx + 1].chapter === String(chapter)) {
    gapEnd = markerStart(rawBook, entries[idx + 1]);
  } else {
    const rest = rawBook.slice(gapStart);
    const m = /\r?\n\\c[ \t]/.exec(rest);
    if (m) gapEnd = gapStart + m.index + m[0].indexOf('\\');
  }
  return { start: gapStart, end: gapEnd };
};

const findGapMarker = (rawBook: string, gapStart: number, gapEnd: number): GapMarkerMatch | null => {
  const gap = rawBook.slice(gapStart, gapEnd);
  let pos = 0;
  while (pos < gap.length) {
    const nextNl = gap.indexOf('\n', pos);
    const lineEnd = nextNl === -1 ? gap.length : nextNl;
    const nextPos = nextNl === -1 ? gap.length : nextNl + 1;
    let line = gap.slice(pos, lineEnd);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '\\p' || line === '\\q1' || line === '\\q2') {
      return {
        marker: line.slice(1) as 'p' | 'q1' | 'q2',
        start: gapStart + pos,
        end: gapStart + nextPos,
      };
    }
    pos = nextPos;
  }
  return null;
};

/** Read any paragraph/poetry marker line (\p, \q1, \q2) in the gap after a verse body (#54). */
export const verseGapMarker = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
): 'p' | 'q1' | 'q2' | null => {
  const gap = getVerseGap(rawBook, chapter, verseKey);
  const match = findGapMarker(rawBook, gap.start, gap.end);
  return match ? match.marker : null;
};

/**
 * Rewrite only \p/\q1/\q2 lines in the gap after the verse body. Inserting
 * places the marker line ending the preceding verse's slot; removing restores
 * the exact prior bytes (#54, R-8.4.1).
 */
export const spliceVerseGap = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
  marker: 'p' | 'q1' | 'q2' | null,
): string => {
  const gap = getVerseGap(rawBook, chapter, verseKey);
  const match = findGapMarker(rawBook, gap.start, gap.end);
  if (match) {
    if (marker === match.marker) return rawBook;
    if (marker === null) {
      return rawBook.slice(0, match.start) + rawBook.slice(match.end);
    }
    const nl = rawBook.slice(match.start, match.end).endsWith('\r\n') ? '\r\n' : '\n';
    return rawBook.slice(0, match.start) + '\\' + marker + nl + rawBook.slice(match.end);
  }
  if (marker === null) return rawBook;
  const nl = rawBook.slice(gap.start, gap.end).includes('\r\n') || rawBook.includes('\r\n') ? '\r\n' : '\n';
  return rawBook.slice(0, gap.end) + '\\' + marker + nl + rawBook.slice(gap.end);
};

