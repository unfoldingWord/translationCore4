// The USFM parser (issue #195, journey J9c, docs/ARCHITECTURE.md §8): one or
// several USFM files → one ImportBundle, one book per file. The book code comes
// from the `\id` line; the name comes from `\h` when the drop is one book. A USFM
// file carries no language, so the review page asks for it. Each book's text is
// the file's bytes as they are, so the shell stores it byte for byte. usfm-js
// reads the headers only; it never re-serializes the text (D8).
import { t } from '../../i18n';
import { usfmjs } from '../vendor';
import type { ImportBundle, ImportFile, ImportParser } from './types';

// `ignoreBOM` keeps a byte-order mark in the text, and `fatal` refuses bytes that
// are not UTF-8: either way the re-encoded text is the file byte for byte.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const EXTENSIONS = /\.(usfm|sfm|txt)$/i;

type Finding = ImportBundle['findings'][number];
const damaged = (text: string): Finding => ({ kind: 'damaged', text, warn: true, code: 'import.damaged.usfm-parse' });

type VerseObject = { tag?: string; endTag?: string; children?: VerseObject[] };
type UsfmJson = { headers?: Array<{ tag?: string; content?: string }>; chapters?: Record<string, Record<string, { verseObjects?: VerseObject[] }>> };

/** The first marker with no end marker. usfm-js gives such a marker an empty
 * `endTag` (a closed one gets its `\f*`, `\zaln-e\*`, …). The file is refused
 * whole: 4.0.0 does not import the correct chapters of a damaged file (#41). */
function unclosed(json: UsfmJson): { marker: string; chapter: string; verse: string } | undefined {
  const find = (objects: VerseObject[] = []): string | undefined => {
    for (const o of objects) {
      if (o.endTag === '') return o.tag;
      const inner = find(o.children);
      if (inner) return inner;
    }
    return undefined;
  };
  for (const [chapter, verses] of Object.entries(json.chapters ?? {}))
    for (const [verse, { verseObjects }] of Object.entries(verses)) {
      const marker = find(verseObjects);
      if (marker) return { marker, chapter, verse };
    }
  return undefined;
}

async function parse(files: ImportFile[]): Promise<ImportBundle> {
  const findings: Finding[] = [{ kind: 'license', text: t('importer.review.licenseNone'), warn: true }];
  const books: ImportBundle['books'] = [];
  const names: string[] = [];
  const fileOf = new Map<string, string>();
  for (const file of files) {
    let usfm: string;
    try {
      usfm = decoder.decode(file.bytes);
    } catch {
      findings.push(damaged(t('importer.usfm.notText', { file: file.name })));
      continue;
    }
    const json = usfmjs.toJSON(usfm) as UsfmJson;
    const headers = json.headers ?? [];
    const header = (tag: string) => headers.find((h) => h.tag === tag)?.content?.trim() ?? '';
    const code = /^[A-Z0-9]{3}\b/.exec(header('id'))?.[0];
    if (!code) {
      findings.push(damaged(t('importer.usfm.noId', { file: file.name })));
      continue;
    }
    const first = fileOf.get(code);
    if (first) {
      findings.push(damaged(t('importer.usfm.twoFiles', { code, first, file: file.name })));
      continue;
    }
    const open = unclosed(json);
    if (open) {
      findings.push(damaged(t('importer.usfm.unclosed', { file: file.name, ...open })));
      continue;
    }
    fileOf.set(code, file.name);
    books.push({ code, usfm });
    names.push(header('h'));
  }
  const name = books.length === 1 ? names[0] : '';
  return { kind: 'bible', facts: { language: '', name }, books: books.sort((a, b) => a.code.localeCompare(b.code)), findings };
}

export const USFM_PARSER: ImportParser = {
  id: 'usfm',
  accepts: (files) => files.length > 0 && files.every((f) => EXTENSIONS.test(f.name)),
  parse,
};
