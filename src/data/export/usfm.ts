// The USFM export (issue #19, J7, docs/ARCHITECTURE.md §7): one book as one
// USFM file, in two forms. Plain is the stored book file byte for byte.
// Aligned weaves the book's §5.1 records in as `\zaln` and `\w` markup
// (./weave.mjs, the one weave the conformance harness also runs), the form
// tC3 and Door43 tooling read. Alignment markup exists only in this output,
// never at rest (I-1).
import { t } from '../../i18n';
import { exportFilename, type ExportInput, type ExportProducer } from './kernel';
import { weaveBook } from './weave.mjs';

const bible: ExportProducer['appliesTo'] = (project) => project.flavor === 'textTranslation';

const openBook = (book: string | undefined): string => {
  if (!book) throw new Error('no book is open');
  return book;
};

const usfmFile = (text: string, filename: string) => ({ bytes: new TextEncoder().encode(text), filename, mime: 'text/plain' });

export const USFM_ALIGNED: ExportProducer = {
  id: 'usfm-aligned',
  label: t('cc.exportUsfmAligned'),
  appliesTo: bible,
  produce: async ({ store, book }: ExportInput) => {
    const id = openBook(book);
    const [{ usfm }, alignments] = await Promise.all([store.readBook(id), store.readAlignments(id)]);
    return usfmFile(weaveBook(usfm, alignments), exportFilename(`${id}-aligned`, 'usfm'));
  },
};

export const USFM_PLAIN: ExportProducer = {
  id: 'usfm-plain',
  label: t('cc.exportUsfmPlain'),
  appliesTo: bible,
  produce: async ({ store, book }: ExportInput) => {
    const id = openBook(book);
    return usfmFile((await store.readBook(id)).usfm, exportFilename(id, 'usfm'));
  },
};
