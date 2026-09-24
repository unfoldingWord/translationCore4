// The print DOM of one book (#20): the PDF export renders it to static HTML and
// the desktop app prints it (src/data/export/pdf.ts). It shows what the
// Community Checking preview shows (src/data/bookModel.js printedItems): each
// chapter with a drafted verse, one line for each run of undrafted chapters
// between them, and an undrafted verse as "not yet drafted". Drop caps and
// verse numbers change the DOM; the print stylesheet
// (src/ds/tokens/print.css) sets columns, leading and paper.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../../i18n';

/** The line that stands for undrafted chapters `from`–`to` (one chapter when equal). */
export const chapterGapText = ([from, to]) =>
  from === to ? t('cc.chapterNotDrafted', { n: from }) : t('cc.chaptersNotDrafted', { from, to });

/** `items` is `printedItems(...)` from src/data/bookModel.js. */
export default function PrintBook({ title, items, pageSetup, dir }) {
  return (
    <main className="print-book">
      <h1 className="print-title" dir={dir}>{title}</h1>
      <div className="print-flow" dir={dir}>
        {items.map((item) => item.gap
          ? <p key={`gap-${item.gap[0]}`} className="print-chapter-gap" dir={dir}>{chapterGapText(item.gap)}</p>
          : (
            <section key={item.c} className="print-chapter" dir={dir}>
              {pageSetup.dropCapChapters
                ? <span className="print-dropcap">{item.c}</span>
                : <h2 className="print-chapter-heading">{t('cc.chapterHeading', { n: item.c })}</h2>}
              {item.verses.map((v) => v.drafted && v.text
                ? <span key={v.n}>{pageSetup.verseNumbers ? <sup className="print-verse-number">{v.n}</sup> : null}{v.text} </span>
                : <span key={v.n} className="print-undrafted"><sup className="print-verse-number">{v.n}</sup>{t('cc.notYetDrafted')} </span>)}
            </section>
          ))}
      </div>
    </main>
  );
}

/** The print DOM as static HTML, for the print document. */
export const printBookHtml = (props) => renderToStaticMarkup(<PrintBook {...props} />);
