// Translator sections and display paragraphs — ONE grouping rule for
// Understand and Translate (#141): both screens lay a chapter out as one row
// per `\ts\*` section, verses running on inside a paragraph unless the USFM
// marks a break. Display only, never re-serialized.
import { leadingNum } from './HelpsPanel.jsx';

// A USFM paragraph-level marker inside a verse's objects (usfm-js keeps `\p`,
// `\m`, `\q…`, list markers as paragraph objects in the verse where they
// fall; the list markers `lh`/`lf`/`lim` arrive without type "paragraph").
export const isParaMark = (vo) => !!vo && (vo.type === 'paragraph' || /^(p|m|pi\d?|pm|pmo|nb|b|q\d?|li\d?|lh|lf|lim\d?)$/.test(vo.tag ?? ''));
const carriesText = (vo) => vo?.type === 'text' || vo?.type === 'word' || (vo?.text ?? '') !== '';
// The objects before a verse's first text (leading) and after its last (trailing).
const leading = (objs) => { const i = objs.findIndex(carriesText); return i === -1 ? objs : objs.slice(0, i); };
const trailing = (objs) => { let i = objs.length - 1; while (i >= 0 && !carriesText(objs[i])) i--; return objs.slice(i + 1); };

/** Group a unit's verse keys into display paragraphs: a verse opens a new
 * paragraph when the previous verse ends with a paragraph marker or it starts
 * with one — the design's `para: true`. */
export const paragraphsOf = (keys, chapterVerses) => {
  const paras = [];
  keys.forEach((k, i) => {
    const objs = chapterVerses[String(k)]?.verseObjects ?? [];
    const prev = i > 0 ? chapterVerses[String(keys[i - 1])]?.verseObjects ?? [] : [];
    const breaks = i === 0 || trailing(prev).some(isParaMark) || leading(objs).some(isParaMark);
    if (breaks) paras.push([]);
    paras[paras.length - 1].push(k);
  });
  return paras;
};

/** Section starts for one chapter, from the source's own \ts\* chunk markers.
 * A source without markers yields one whole-chapter section. */
export const sectionStarts = (raw, chapter) => {
  if (!raw) return [];
  const chapters = raw.split(/\\c\s+(\d+)/);
  const i = chapters.findIndex((part, idx) => idx % 2 === 1 && Number(part) === Number(chapter));
  if (i === -1) return [];
  const body = chapters[i + 1] ?? '';
  const starts = [];
  // A \ts\* often sits BEFORE \c (closing the previous chunk), so the
  // chapter's first verse always starts a section even when no in-body marker
  // precedes it.
  const first = body.match(/\\v\s+(\d+)/);
  if (first) starts.push(Number(first[1]));
  for (const seg of body.split(/\\ts\\\*/).slice(1)) {
    const m = seg.match(/\\v\s+(\d+)/);
    if (m && !starts.includes(Number(m[1]))) starts.push(Number(m[1]));
  }
  return starts.sort((a, b) => a - b);
};

/** Split ordered verse keys into section ranges at the given starts; with no
 * starts the whole list is one range. Keys before the first start join the
 * first range so no verse is ever dropped from the page. */
export const sectionRanges = (starts, verseKeys) => {
  if (starts.length === 0) return verseKeys.length ? [verseKeys] : [];
  const ranges = [];
  let cur = [];
  for (const k of verseKeys) {
    const n = leadingNum(k);
    if (cur.length && starts.includes(n) && n !== leadingNum(cur[0])) { ranges.push(cur); cur = []; }
    cur.push(k);
  }
  if (cur.length) ranges.push(cur);
  return ranges;
};

/** The design's span label for a range of keys: "9–10", "9" or "9-10" for a
 * single bridged key. */
export const rangeSpan = (keys) => {
  const from = keys[0];
  const to = keys[keys.length - 1];
  if (keys.length === 1) return String(from);
  return `${leadingNum(from)}–${String(to).split('-').pop()}`;
};
