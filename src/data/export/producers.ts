// The export producer table (issue #375, docs/ARCHITECTURE.md §7): every export
// registers here and only here; the export menu (src/views/ExportMenu.jsx)
// renders this table filtered by `appliesTo`. The producers arrive with their
// issues: USFM #19, Scripture Burrito zip #359, PDF #20, OBS Markdown #360.
import { exportFilename, type ExportProducer } from './kernel';
import { BURRITO_ZIP } from './burritoZip';
import { PDF } from './pdf';

/** The e2e kernel case (e2e/j07-publish.spec.ts) proves the menu and the
 * wrapper with this fake: the open book's USFM as a text file. Dev server only,
 * and only when the spec sets the flag; `import.meta.env.DEV` is statically
 * false in a build, so the fake never ships. Its id is outside the producer
 * union on purpose: no real export can collide with it. */
const E2E_FAKE: ExportProducer = {
  id: 'e2e-fake' as ExportProducer['id'],
  label: 'Fake export (e2e)',
  appliesTo: (project) => project.flavor === 'textTranslation',
  produce: async ({ store, project, book }) => {
    if (!book) throw new Error('no book is open');
    const { usfm } = await store.readBook(book);
    return { bytes: new TextEncoder().encode(usfm), filename: exportFilename(`${project.name}-${book}`, 'txt'), mime: 'text/plain' };
  },
};

const e2eFakeEnabled = (): boolean => {
  try {
    return globalThis.localStorage?.getItem('tc4.e2e.fakeExport') === '1';
  } catch {
    return false;
  }
};

export const PRODUCERS: readonly ExportProducer[] = [PDF, BURRITO_ZIP, ...(import.meta.env.DEV && e2eFakeEnabled() ? [E2E_FAKE] : [])];
