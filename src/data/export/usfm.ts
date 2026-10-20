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
// #790 (D107): before the weave, each record that vouches and holds a card is fitted to the
// pinned original-language verse (../align/source.mjs). A record with a link to a source word that
// the pin does not hold is then flagged `invalid`, and the weave leaves it out and names it.
import { exportFilename, type ExportFile, type ExportInput, type ExportProducer } from './kernel';
import { unzipServerZip } from '../serverZip';
import { weaveBook } from './weave.mjs';
import { vouches } from '../align/review.mjs';
import { fitSourceCards } from '../align/source.mjs';
import type { AlignmentFile, AlignmentVerseRecord } from '../align/zaln';
import { AlignmentHelpers } from '../vendor';

const bible: ExportProducer['appliesTo'] = (project) => project.flavor === 'textTranslation';

const openBook = (book: string | undefined): string => {
  if (!book) throw new Error('no book is open');
  return book;
};

const usfmFile = (text: string, filename: string): ExportFile => ({ bytes: new TextEncoder().encode(text), filename, mime: 'text/plain' });

/** #790 (D107): the sidecar with each record that vouches and holds a card fitted to the pinned
 * verse (`fitSourceCards`), the one fit the Align open runs. The pinned book is read once, through
 * `alignSource`, and only when such a record exists: a book with none exports with no source read.
 * A record with no card is not fitted, as the open fits the bootstrap and not `[]`. The fit writes
 * and stamps nothing. A call that needs `alignSource` and has none is a programming error. */
const fitToPinnedSource = async (file: AlignmentFile | null, alignSource: ExportInput['alignSource']): Promise<AlignmentFile | null> => {
  if (!file) return file;
  const due: Array<[string, string, AlignmentVerseRecord]> = [];
  for (const [chapter, records] of Object.entries(file.chapters ?? {})) {
    for (const [verse, record] of Object.entries(records)) {
      if (vouches(record) && record.alignments.length > 0) due.push([chapter, verse, record]);
    }
  }
  if (due.length === 0) return file;
  if (!alignSource) throw new Error('the aligned export needs the pinned original-language text, and no alignSource was given');
  const wordsFor = await alignSource();
  const chapters: AlignmentFile['chapters'] = Object.fromEntries(Object.entries(file.chapters).map(([c, records]) => [c, { ...records }]));
  for (const [chapter, verse, record] of due) {
    chapters[chapter][verse] = fitSourceCards(record, await wordsFor(`${chapter}:${verse}`)).record;
  }
  return { ...file, chapters };
};

export const USFM_ALIGNED: ExportProducer = {
  id: 'usfm-aligned',
  label: 'cc.exportUsfmAligned',
  appliesTo: bible,
  produce: async ({ store, book, alignSource }: ExportInput) => {
    const id = openBook(book);
    const [{ usfm }, stored] = await Promise.all([store.readBook(id), store.readAlignments(id)]);
    const alignments = await fitToPinnedSource(stored, alignSource);
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
