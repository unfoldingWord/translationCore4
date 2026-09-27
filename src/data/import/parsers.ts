// The import parser table (issue #361, docs/ARCHITECTURE.md §8): every parser
// registers here and only here; the import screen (src/views/modals/Import.jsx)
// enables the kind of file whose parser is in the table. The parsers arrive
// with their issues: USFM #195, Scripture Burrito #196, tC3 #21.
import { unzipSync } from 'fflate';
import { BURRITO_PARSER } from './burrito';
import { TC3_PARSER } from './tc3';
import { USFM_PARSER } from './usfm';
import type { ImportBundle, ImportFile, ImportParser } from './types';

const decoder = new TextDecoder();

/** The fake parser the shell's tests and the e2e shell block
 * (e2e/j09-import.spec.ts) prove the shell with. One `.zip` is a Scripture
 * Burrito uploaded as it is (`archive`); any other files are USFM books, one per
 * file, read from the `\id` line. A file whose name contains `damaged` gives a
 * damaged finding. Its id is outside the parser union on purpose: no real
 * parser can collide with it. */
export const FAKE_PARSER: ImportParser = {
  id: 'e2e-fake' as ImportParser['id'],
  accepts: (files) => files.length > 0,
  parse: async (files: ImportFile[]): Promise<ImportBundle> => {
    const findings: ImportBundle['findings'] = [
      { kind: 'license', text: 'No license was found. CC BY-SA 4.0 will be applied.', warn: true },
    ];
    for (const file of files)
      if (file.name.includes('damaged'))
        findings.push({ kind: 'damaged', text: `${file.name} ends partway through a chapter.`, warn: true, code: 'import.damaged.truncated' });
    if (files.length === 1 && file0IsZip(files)) {
      const entries = unzipSync(files[0].bytes);
      const meta = Object.entries(entries).find(([name]) => name === 'metadata.json' || /^[^/]+\/metadata\.json$/.test(name));
      const parsed = meta ? (JSON.parse(decoder.decode(meta[1])) as { languages?: Array<{ tag?: string }>; identification?: { name?: Record<string, string> } }) : {};
      const books = Object.entries(entries)
        .map(([name, bytes]) => ({ code: /(?:^|\/)ingredients\/([A-Z0-9]{3})\.usfm$/.exec(name)?.[1], usfm: decoder.decode(bytes) }))
        .filter((b): b is { code: string; usfm: string } => !!b.code)
        .sort((a, b) => a.code.localeCompare(b.code));
      return {
        kind: 'bible',
        facts: { language: parsed.languages?.[0]?.tag ?? '', name: Object.values(parsed.identification?.name ?? {})[0] ?? '' },
        books,
        archive: files[0].bytes,
        findings,
      };
    }
    const books = files.map((file) => {
      const usfm = decoder.decode(file.bytes);
      return { code: /^\\id ([A-Z0-9]{3})/m.exec(usfm)?.[1] ?? '', usfm };
    });
    return { kind: 'bible', facts: { language: 'es-419', name: 'Fake import' }, books, findings };
  },
};

const file0IsZip = (files: ImportFile[]): boolean => files[0].name.toLowerCase().endsWith('.zip');

const e2eFakeEnabled = (): boolean => {
  try {
    return globalThis.localStorage?.getItem('tc4.e2e.fakeImport') === '1';
  } catch {
    return false;
  }
};

/** Dev server only, and only when the spec sets the flag: `import.meta.env.DEV`
 * is statically false in a build, so the fake never ships. */
export const PARSERS: readonly ImportParser[] = [TC3_PARSER, USFM_PARSER, BURRITO_PARSER, ...(import.meta.env.DEV && e2eFakeEnabled() ? [FAKE_PARSER] : [])];
