// The print DOM of one book (#20): the PDF export renders it to static HTML and
// the desktop app prints it (src/data/export/pdf.ts). It states what the
// Community Checking preview states — every chapter, every verse, an undrafted
// verse as "not yet drafted". Drop caps and verse numbers change the DOM; the
// print stylesheet (src/ds/tokens/print.css) sets columns, leading and paper.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../../i18n';

/** `chapters` is `[{ c, verses }]` from src/data/bookModel.js. */
export default function PrintBook({ title, chapters, pageSetup, dir }) {
  return (
    <main className="print-book">
      <h1 className="print-title" dir={dir}>{title}</h1>
      {chapters.map(({ c, verses }) => (
        <section key={c} className="print-chapter" dir={dir}>
          {pageSetup.dropCapChapters ? <span className="print-dropcap">{c}</span> : null}
          {verses.map((v) => v.drafted && v.text
            ? <span key={v.n}>{pageSetup.verseNumbers ? <sup className="print-verse-number">{v.n}</sup> : null}{v.text} </span>
            : <span key={v.n} className="print-undrafted"><sup className="print-verse-number">{v.n}</sup>{t('cc.notYetDrafted')} </span>)}
        </section>
      ))}
    </main>
  );
}

/** The print DOM as static HTML, for the print document. */
export const printBookHtml = (props) => renderToStaticMarkup(<PrintBook {...props} />);
