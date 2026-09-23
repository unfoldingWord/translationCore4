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
    const headers = (usfmjs.toJSON(usfm).headers ?? []) as Array<{ tag?: string; content?: string }>;
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
