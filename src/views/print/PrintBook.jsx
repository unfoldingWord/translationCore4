// The print DOM of one book (#20). The PDF export renders it to static HTML and
// the desktop app prints it (src/data/export/pdf.ts); the Community Checking
// preview renders the same DOM on page sheets (src/views/print/PrintPages.jsx).
// It shows src/data/bookModel.js printedItems: each chapter with a drafted
// verse, one line for each run of undrafted chapters between them, and an
// undrafted verse as "not yet drafted". Drop caps and verse numbers change the
// DOM; src/ds/tokens/print.css sets columns and leading from the variables of
// printVariables.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../../i18n';
import { PAGE_SPACING_FACTOR } from '../../data/export/pageSetup';

/** Single leading, × the verse size (owner, 2026-09-24); Double is twice it. */
export const PRINT_LEADING = 1.4;

/** The page-setup CSS variables that print.css reads, for a style attribute or a :root rule. */
export const printVariables = (pageSetup) => ({
  '--print-columns': pageSetup.columns,
  '--print-leading': PRINT_LEADING * PAGE_SPACING_FACTOR[pageSetup.spacing],
});

/** The paper in millimetres (A4 is 595 × 842 pt, US Letter 612 × 792 pt) and the page
 * margins; the bottom margin holds the page number. The PDF's @page rule and the
 * preview's sheets both read these. */
export const PAPER_MM = Object.freeze({ a4: [210, 297], letter: [215.9, 279.4] });
export const PAGE_MARGIN_MM = Object.freeze({ top: 18, side: 16, bottom: 20 });

/** The line that stands for undrafted chapters `from`–`to` (one chapter when equal). */
export const chapterGapText = ([from, to]) =>
  from === to ? t('cc.chapterNotDrafted', { n: from }) : t('cc.chaptersNotDrafted', { from, to });

/** `printedItems` as print parts: every chapter opens with its head, every verse whole. */
export const partsOfItems = (items) =>
  items.map((item) => (item.gap ? item : { c: item.c, head: true, verses: item.verses }));

/**
 * The flow content: a gap line `{ gap }` or a chapter part `{ c, head, verses }`.
 * `head` is false for the rest of a chapter that a page break split; a verse
 * with `rest` is the text after a page break and shows no number. `testIds`
 * adds the preview's test handles, never the PDF's.
 */
export function PrintParts({ parts, pageSetup, dir, testIds = false }) {
  const id = (name) => (testIds ? { 'data-testid': name } : {});
  return parts.map((part) => part.gap
    ? <p key={`gap-${part.gap[0]}`} className="print-chapter-gap" dir={dir} {...id('cc-chapter-gap')}>{chapterGapText(part.gap)}</p>
    : (
      <section key={`${part.c}-${part.head ? 'h' : part.verses[0]?.n}`} className="print-chapter" dir={dir} {...id('cc-chapter')}>
        {part.head && (pageSetup.dropCapChapters
          ? <span className="print-dropcap">{part.c}</span>
          : <h2 className="print-chapter-heading" {...id('cc-chapter-heading')}>{t('cc.chapterHeading', { n: part.c })}</h2>)}
        {part.verses.map((v) => v.drafted && v.text
          ? <span key={v.n}>{pageSetup.verseNumbers && v.rest === undefined ? <sup className="print-verse-number">{v.n}</sup> : null}{v.rest ?? v.text} </span>
          : <span key={v.n} className="print-undrafted"><sup className="print-verse-number">{v.n}</sup>{t('cc.notYetDrafted')} </span>)}
      </section>
    ));
}

/** The whole book as one flow, for the PDF: Chromium's print breaks it into pages. */
export default function PrintBook({ title, items, pageSetup, dir }) {
  return (
    <main className="print-book">
      <h1 className="print-title" dir={dir}>{title}</h1>
      <div className="print-flow" dir={dir}>
        <PrintParts parts={partsOfItems(items)} pageSetup={pageSetup} dir={dir} />
      </div>
    </main>
  );
}

/** The print DOM as static HTML, for the print document. */
export const printBookHtml = (props) => renderToStaticMarkup(<PrintBook {...props} />);
