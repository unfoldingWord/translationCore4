// The display model of one book: its chapters and, in each, its verses with
// their drafted state and plain text. The editor state (src/state.jsx) and the
// PDF export (src/data/export/pdf.ts, #20) read a book through this one
// module, so the preview and the PDF state the same verses the same way.
import usfm from 'usfm-js';
import { gapMarkerOf } from './usfm/splice';
import { indexBook } from './usfm/indexer';

export const parseChapters = (raw) => {
  // Display parse (whole-book: chapters + headers — PLATFORM-NOTES #4).
  const json = usfm.toJSON(raw);
  return json.chapters || {};
};

export const verseText = (vObj) =>
  (vObj?.verseObjects || [])
    .map((vo) => vo.text || vo.children?.map((c) => c.text || '').join('') || '')
    .join('')
    .trim();

export function buildChapterVerses(bookRaw, chapters, entries) {
  const byChapter = /** @type {Record<string, object[]>} */ ({});
  const PARA_IN_GAP = /\\(?:p|m|pi\d?|pm|pmo|nb|b|q\d?|li\d?|lh|lf|lim\d?)\b/;
  let prev = null;
  for (const e of entries) {
    const body = bookRaw.slice(e.start, e.end).trim();
    const drafted = body !== '' && body !== '___';
    const sameCh = prev && prev.chapter === e.chapter;
    const gap = sameCh ? bookRaw.slice(prev.end, e.start) : '';
    const para = !sameCh || PARA_IN_GAP.test(gap);
    const format = sameCh ? gapMarkerOf(gap) : null;
    (byChapter[e.chapter] ||= []).push({
      n: e.verseKey,
      drafted,
      para,
      format,
      text: drafted ? verseText(chapters[e.chapter]?.[e.verseKey]) : '',
      body: drafted ? body : '',
    });
    prev = e;
  }
  return byChapter;
}

/** The raw USFM of a book → its verse index, its verses by chapter, and the
 * chapter numbers in order. */
export function bookModel(bookRaw) {
  const entries = indexBook(bookRaw);
  const byChapter = buildChapterVerses(bookRaw, parseChapters(bookRaw), entries);
  const chapterNums = Object.keys(byChapter)
    .map(Number)
    .sort((a, b) => a - b);
  return { entries, byChapter, chapterNums };
}
