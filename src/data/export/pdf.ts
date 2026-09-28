// The PDF export (issue #20, D79 point 3, docs/ARCHITECTURE.md §7): the whole
// book, or the drafted stories of an OBS project (#360, D74 point 1, #454), as a print-ready
// PDF, by the print-styled route — the Chromium that renders the editor also
// prints the PDF. The producer builds one print document (the print DOM of
// src/views/print/PrintBook.jsx or PrintStories.jsx, the print stylesheet, and
// the page setup as CSS) and hands it to the desktop app's PDF bridge:
// `export:pdf` in scripts/desktop-main.cjs, exposed by scripts/preload.cjs as
// `window.tc4Desktop.printPdf`. The bridge prints the document in a hidden
// window with `printToPDF` and returns the bytes; no print dialog opens. A
// browser has no bridge, so there the menu has no PDF item.
import { t } from '../../i18n';
import { bookName } from '../bookNames';
import { bookModel, printedItems } from '../bookModel';
import { Refusal } from '../journal/runtime';
import { PAGE_MARGIN_MM, printBookHtml, printVariables } from '../../views/print/PrintBook.jsx';
import { printStoriesHtml } from '../../views/print/PrintStories.jsx';
import PRINT_CSS from '../../ds/tokens/print.css?raw';
import { readPrintedStories, type PrintedStory, type StoryPictures } from '../storyModel';
import { exportFilename, type ExportInput, type ExportProducer } from './kernel';
import { DEFAULT_PAGE_SETUP, type PageSetup, type PaperSize } from './pageSetup';

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

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** A print document: the page (its size, margins and number), the page setup
 * as CSS variables, print.css, then `body`, the print DOM. */
function printShell(title: string, body: string, pageSetup: PageSetup, dir: 'ltr' | 'rtl'): string {
  const { top, side, bottom } = PAGE_MARGIN_MM;
  const vars = Object.entries(printVariables(pageSetup)).map(([name, value]) => `${name}: ${value};`).join(' ');
  // The page: its size and margins, and its number at the bottom centre (a CSS
  // page-margin box). The book's own rules are print.css, shared with the preview.
  const setup = `@page { size: ${PAGE_SIZE[pageSetup.paper]}; margin: ${top}mm ${side}mm ${bottom}mm;
  @bottom-center { content: counter(page); font-family: "Charis SIL", "PT Serif", Georgia, "Times New Roman", serif; font-size: 11px; color: #626F78; } }
html { background: #fff; }
body { margin: 0; }
:root { ${vars} }`;
  return `<!doctype html>
<html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${setup}
${PRINT_CSS}</style></head>
<body>${body}</body></html>`;
}

/** The complete print document of one book: `printedItems`, the preview's rule
 * (each chapter with a drafted verse, one line for each run of undrafted
 * chapters between them), the page setup applied. A book with no drafted verse
 * has nothing to print: `export.nothing-drafted`. */
export function printDocument(bookRaw: string, code: string, pageSetup: PageSetup, dir: 'ltr' | 'rtl'): string {
  const { byChapter, chapterNums } = bookModel(bookRaw);
  const items = printedItems(byChapter, chapterNums);
  const title = bookName(code);
  if (items.length === 0) throw new Refusal('export.nothing-drafted', `${title} has no drafted verse yet, so the PDF has nothing to print.`, { book: code });
  return printShell(title, printBookHtml({ title, items, pageSetup, dir }), pageSetup, dir);
}

/** The complete print document of an OBS project (#360): `printedStories`,
 * the preview's rule (#454: each drafted story, one line for each run of
 * undrafted frames or stories), in the flow layout of PrintStories. `pictures`
 * holds each printed story's picture sources by frame number; with pictures
 * off none prints. With no story drafted, the document is one line that says
 * so. */
export function printStoriesDocument(title: string, items: PrintedStory[], pictures: StoryPictures, pageSetup: PageSetup, dir: 'ltr' | 'rtl'): string {
  return printShell(title, printStoriesHtml({ items, pictures, pageSetup, dir }), pageSetup, dir);
}

/** The picture at `uri` as a data: URL. The print document stands alone: the
 * hidden print window loads it from a file, where the app's `/api` addresses
 * do not resolve. A picture that cannot be read fails the export. */
const inlinePicture = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`picture ${uri}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${response.headers.get('content-type') || 'image/jpeg'};base64,${btoa(binary)}`;
};

/** The printed stories (`readPrintedStories`) and — with pictures on — the
 * picture of each drafted frame they print, as the preview resolves it,
 * inlined. */
const readStories = async ({ store, storyPictures, pageSetup = DEFAULT_PAGE_SETUP }: ExportInput): Promise<{ items: PrintedStory[]; pictures: StoryPictures }> => {
  const { items, pictures: sources } = await readPrintedStories(store, pageSetup.pictures ? storyPictures : undefined);
  const pictures: StoryPictures = {};
  for (const [story, frames] of Object.entries(sources)) {
    const inlined: Record<string, string> = {};
    for (const [frame, uri] of Object.entries(frames)) inlined[frame] = await inlinePicture(uri);
    pictures[Number(story)] = inlined;
  }
  return { items, pictures };
};

/** The bridge's PDF of `html`. A print that fails (#451) refuses with a next
 * step: `export.print-failed-pictures` when the pictures were on, since the
 * same document without them is far smaller; else `export.print-failed`. Both
 * say to open the app again first: on Linux, after one print failed, every
 * later print in that session failed too. */
const print = async (printer: PdfBridge, html: string, pictures: boolean): Promise<Uint8Array> => {
  try {
    return await printer.printPdf(html);
  } catch (error) {
    throw new Refusal(pictures ? 'export.print-failed-pictures' : 'export.print-failed', String((error as Error)?.message ?? error));
  }
};

export const PDF: ExportProducer = {
  id: 'pdf',
  label: t('cc.exportPdf'),
  appliesTo: () => bridge() !== undefined, // Bible and OBS projects
  produce: async (input) => {
    const { store, project, book, pageSetup = DEFAULT_PAGE_SETUP } = input;
    const printer = bridge();
    if (!printer) throw new Error('PDF export needs the desktop app');
    const dir = project.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
    if (project.flavor === 'textStories') {
      const { items, pictures } = await readStories(input);
      const bytes = await print(printer, printStoriesDocument(project.name, items, pictures, pageSetup, dir), pageSetup.pictures);
      return { bytes, filename: exportFilename(project.name, 'pdf'), mime: 'application/pdf' };
    }
    if (!book) throw new Error('no book is open');
    const { usfm } = await store.readBook(book);
    const bytes = await print(printer, printDocument(usfm, book, pageSetup, dir), false);
    return { bytes, filename: exportFilename(book, 'pdf'), mime: 'application/pdf' };
  },
};
