// The PDF export (issue #20, D79 point 3, docs/ARCHITECTURE.md §7): the whole
// book as a print-ready PDF, by the print-styled route — the Chromium that
// renders the editor also prints the PDF. The producer builds one print
// document (the print DOM of src/views/print/PrintBook.jsx, the print
// stylesheet, and the page setup as CSS) and hands it to the desktop app's PDF
// bridge: `export:pdf` in scripts/desktop-main.cjs, exposed by
// scripts/preload.cjs as `window.tc4Desktop.printPdf`. The bridge prints the
// document in a hidden window with `printToPDF` and returns the bytes; no print
// dialog opens. A browser has no bridge, so there the menu has no PDF item.
import { t } from '../../i18n';
import { bookName } from '../bookNames';
import { bookModel } from '../bookModel';
import { printBookHtml } from '../../views/print/PrintBook.jsx';
import PRINT_CSS from '../../ds/tokens/print.css?raw';
import { exportFilename, type ExportProducer } from './kernel';
import { DEFAULT_PAGE_SETUP, PAGE_SPACING_FACTOR, type PageSetup, type PaperSize } from './pageSetup';

/** The desktop bridge (scripts/preload.cjs): a print document in, PDF bytes out. */
type PdfBridge = { printPdf: (html: string) => Promise<Uint8Array> };
declare global {
  interface Window {
    tc4Desktop?: PdfBridge;
  }
}

const bridge = (): PdfBridge | undefined => globalThis.window?.tc4Desktop;

/** CSS `@page` sizes: A4 is 595 × 842 pt, US Letter 612 × 792 pt. */
const PAGE_SIZE: Readonly<Record<PaperSize, string>> = { a4: 'A4', letter: 'letter' };
/** The print leading at Single spacing; Double is PAGE_SPACING_FACTOR times it. */
const LEADING = 1.64;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The complete print document of one book: every chapter, the page setup applied. */
export function printDocument(bookRaw: string, code: string, pageSetup: PageSetup, dir: 'ltr' | 'rtl'): string {
  const { byChapter, chapterNums } = bookModel(bookRaw);
  const chapters = chapterNums.map((c: number) => ({ c, verses: byChapter[String(c)] || [] }));
  const title = bookName(code);
  const setup = `@page { size: ${PAGE_SIZE[pageSetup.paper]}; }
:root { --print-columns: ${pageSetup.columns}; --print-leading: ${LEADING * PAGE_SPACING_FACTOR[pageSetup.spacing]}; }`;
  return `<!doctype html>
<html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${setup}
${PRINT_CSS}</style></head>
<body>${printBookHtml({ title, chapters, pageSetup, dir })}</body></html>`;
}

export const PDF: ExportProducer = {
  id: 'pdf',
  label: t('cc.exportPdf'),
  appliesTo: (project) => project.flavor === 'textTranslation' && bridge() !== undefined,
  produce: async ({ store, project, book, pageSetup = DEFAULT_PAGE_SETUP }) => {
    const printer = bridge();
    if (!printer) throw new Error('PDF export needs the desktop app');
    if (!book) throw new Error('no book is open');
    const { usfm } = await store.readBook(book);
    const dir = project.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
    const bytes = await printer.printPdf(printDocument(usfm, book, pageSetup, dir));
    return { bytes, filename: exportFilename(book, 'pdf'), mime: 'application/pdf' };
  },
};
