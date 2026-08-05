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
