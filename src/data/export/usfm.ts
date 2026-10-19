// The USFM export (issue #19, J7, docs/ARCHITECTURE.md §7): one book as one
// USFM file, in two forms. Plain is the stored book file byte for byte: it
// comes from the server's zip of the repository, because the text read drops
// a leading byte-order mark (Fetch `Response.text()`) and an imported book
// keeps one (src/data/import/usfm.ts).
// Aligned weaves the book's §5.1 records in as `\zaln` and `\w` markup
// (./weave.mjs, the one weave the conformance harness also runs), the form
// tC3 and Door43 tooling read. Alignment markup exists only in this output,
// never at rest (I-1). A verse whose alignment is left out (it needs review,
// holds imported markup, or `merge` refused it) is named in `skipped` (#796).
import { exportFilename, type ExportFile, type ExportInput, type ExportProducer } from './kernel';
import { unzipServerZip } from '../serverZip';
import { weaveBook } from './weave.mjs';
import { AlignmentHelpers } from '../vendor';

const bible: ExportProducer['appliesTo'] = (project) => project.flavor === 'textTranslation';

const openBook = (book: string | undefined): string => {
  if (!book) throw new Error('no book is open');
  return book;
};

const usfmFile = (text: string, filename: string): ExportFile => ({ bytes: new TextEncoder().encode(text), filename, mime: 'text/plain' });

export const USFM_ALIGNED: ExportProducer = {
  id: 'usfm-aligned',
  label: 'cc.exportUsfmAligned',
  appliesTo: bible,
  produce: async ({ store, book }: ExportInput) => {
    const id = openBook(book);
    const [{ usfm }, alignments] = await Promise.all([store.readBook(id), store.readAlignments(id)]);
    // #796: each verse that has an alignment of the translator's and is not in the file is named, so that
    // the export can tell them which verses to check in Align.
    const skipped: string[] = [];
    const text = weaveBook(usfm, alignments, AlignmentHelpers, ({ ref }: { ref: string }) => skipped.push(ref));
    return { ...usfmFile(text, exportFilename(`${id}-aligned`, 'usfm')), ...(skipped.length ? { skipped } : {}) };
  },
};

export const USFM_PLAIN: ExportProducer = {
  id: 'usfm-plain',
  label: 'cc.exportUsfmPlain',
  appliesTo: bible,
  produce: async ({ store, book }: ExportInput) => {
    const id = openBook(book);
    const ipath = `ingredients/${id.toUpperCase()}.usfm`;
    const bytes = unzipServerZip(await store.readZipped(), (name) => name === ipath)[ipath];
    if (!bytes) throw new Error(`${ipath} is not in the project`);
    return { bytes, filename: exportFilename(id, 'usfm'), mime: 'text/plain' };
  },
};
