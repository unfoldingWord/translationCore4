// The display model of one book: its chapters and, in each, its verses with
// their drafted state and plain text. The editor state (src/state.jsx) and the
// PDF export (src/data/export/pdf.ts, #20) read a book through this one
// module, so the preview and the PDF state the same verses the same way.
import usfm from 'usfm-js';
import { gapMarkerOf } from './usfm/splice';
import { indexBook } from './usfm/indexer';
import { bodyToEditorText } from './usfm/poemLines';
import { tokenizeVerse, tokensText } from './sourceHighlight';

export const parseChapters = (raw) => {
  // Display parse (whole-book: chapters + headers — PLATFORM-NOTES #4).
  const json = usfm.toJSON(raw);
  return json.chapters || {};
};

// #782: the walk is tokenizeVerse, which reads words at any `\zaln` depth. The
// whitespace stays as the file has it (src/views/verseText.js collapses it for
// the source panes), so a stored Check selection still matches its verse.
export const verseText = (vObj) => tokensText(tokenizeVerse(vObj)).trim();

export function buildChapterVerses(bookRaw, chapters, entries) {
  const byChapter = /** @type {Record<string, object[]>} */ ({});
  const PARA_IN_GAP = /\\(?:p|m|pi\d?|pm|pmo|nb|b|q\d?|li\d?|lh|lf|lim\d?)\b/;
  let prev = null;
  for (const e of entries) {
    const body = bookRaw.slice(e.start, e.end).trim();
    const drafted = body !== '' && body !== '___';
    const sameCh = prev && prev.chapter === e.chapter;
    // The gap ends at this verse's own `\v` (the last one before its body), as
    // spliceVerseGap's does: for `\q1 \v 15` (#784) its last line is `\q1 `,
    // the marker the section Save writes back.
    const gap = sameCh ? bookRaw.slice(prev.end, bookRaw.lastIndexOf('\\v', e.start - 1)) : '';
    // #786, #812: the verse before may hold poem lines and breaks, which are
    // its body now; a verse after them starts a paragraph, as when they were
    // the gap. Read from that verse's own `\v`: its first poem marker or break
    // may sit before the body (`\v 2` / `\q1 But I …`).
    const para = !sameCh || PARA_IN_GAP.test(bookRaw.slice(bookRaw.lastIndexOf('\\v', prev.start - 1), bookRaw.lastIndexOf('\\v', e.start - 1)));
    const format = sameCh ? gapMarkerOf(gap) : null;
    (byChapter[e.chapter] ||= []).push({
      n: e.verseKey,
      drafted,
      para,
      format,
      text: drafted ? verseText(chapters[e.chapter]?.[e.verseKey]) : '',
      // #786: the editors' text, inner poem lines as leading tabs.
      body: drafted ? bodyToEditorText(body) : '',
    });
    prev = e;
  }
  return byChapter;
}

/** What the Community Checking preview and the PDF show, in chapter order
 * (owner rulings on #20, 2026-09-24): `{ c, verses }` for each chapter with at
 * least one drafted verse, and one `{ gap: [from, to] }` for each run of
 * chapters with no drafted verse between two such chapters. Undrafted chapters
 * before the first drafted chapter or after the last are left out. An
 * undrafted verse inside a shown chapter stays, stated as not yet drafted.
 * Empty when no verse of the book is drafted. */
export function printedItems(byChapter, chapterNums) {
  const chapters = chapterNums.map((c) => ({ c, verses: byChapter[String(c)] || [] }));
  const drafted = chapters.map(({ verses }) => verses.some((v) => v.drafted && v.text));
  const first = drafted.indexOf(true);
  const last = drafted.lastIndexOf(true);
  const items = [];
  for (let i = first; first !== -1 && i <= last; i++) {
    if (drafted[i]) items.push(chapters[i]);
    else if (drafted[i - 1]) items.push({ gap: [chapters[i].c, chapters[i].c] });
    else items[items.length - 1].gap[1] = chapters[i].c;
  }
  return items;
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
