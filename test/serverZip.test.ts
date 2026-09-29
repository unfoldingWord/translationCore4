// The server-zip reader (issues #425 and #423): on Windows the server names
// every zip entry with `\` (pankosmia-web 0.18.5, `src/utils/zip.rs:25-32` —
// see docs/PLATFORM-NOTES.md note 41), in the whole-repository zip AND the
// ingredient-directory zip, and every tC4 reader of those zips matches entry
// names with `/`. One helper, unzipServerZip, reads a server zip and gives `/`
// names on every platform. Every reader of a server zip uses it; none matches
// raw entry names itself.
//
// The ways the helper can fail, written before the tests (D81 rule 3):
// 1. a `\` in an entry name survives, so a reader's `/` match misses the entry;
// 2. normalization touches the bytes, not only the name — the stored file must
//    stay byte-identical, a leading byte-order mark included;
// 3. the keep filter tests the raw name instead of the normalized one, so a
//    filtered read still misses on Windows;
// 4. a directory entry (`ingredients\`) does not normalize to `ingredients/`,
//    so a reader's trailing-`/` skip keeps it as a file;
// 5. a new reader of a server zip calls fflate's unzipSync itself and matches
//    raw names again (the guard test below).
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { unzipServerZip } from '../src/data/serverZip';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const BOM_BOOK = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('\\id TIT\n')]);

/** The sample repository zipped the way the Windows server zips one: `\` names. */
const windowsZip = () =>
  zipSync({
    'ingredients\\': new Uint8Array(0),
    'ingredients\\TIT.usfm': BOM_BOOK,
    'ingredients\\checking\\resources.json': strToU8('{}'),
    'metadata.json': strToU8('{"format":"scripture burrito"}'),
  });

describe('#425 unzipServerZip', () => {
  it('gives every entry name with `/`, the bytes untouched (byte-order mark included)', () => {
    const out = unzipServerZip(windowsZip());
    expect(Object.keys(out).sort()).toEqual(['ingredients/', 'ingredients/TIT.usfm', 'ingredients/checking/resources.json', 'metadata.json']);
    expect(Buffer.from(out['ingredients/TIT.usfm']).equals(Buffer.from(BOM_BOOK))).toBe(true);
  });

  it('leaves `/` names as they are (macOS and Linux read unchanged)', () => {
    const out = unzipServerZip(zipSync({ 'ingredients/TIT.usfm': BOM_BOOK }));
    expect(Object.keys(out)).toEqual(['ingredients/TIT.usfm']);
  });

  it('the keep filter tests the normalized name, so a `/` filter finds a `\\` entry', () => {
    const out = unzipServerZip(windowsZip(), (name) => name === 'ingredients/TIT.usfm');
    expect(Object.keys(out)).toEqual(['ingredients/TIT.usfm']);
    expect(Buffer.from(out['ingredients/TIT.usfm']).equals(Buffer.from(BOM_BOOK))).toBe(true);
  });
});

// The guard (#425 acceptance criterion 1, extended to #423's journal read): no
// reader of a server zip matches raw entry names itself — a file in src/ that
// reads the repository zip (readZipped) or an ingredient-directory zip
// (readIngredientZipped) must not also call fflate's unzipSync; it uses
// unzipServerZip. Same shape as test/noBypass.test.ts (#62).
describe('#425 no reader of a server zip unzips raw entry names', () => {
  const SRC = path.resolve(process.cwd(), 'src');
  const HELPER = 'src/data/serverZip.ts'; // the one place that unzips a server zip

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
    });

  const rel = (file: string): string => path.relative(path.dirname(SRC), file).replaceAll('\\', '/');

  it('a src/ file that calls readZipped() or readIngredientZipped() does not call unzipSync itself', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20); // the scan is not vacuous
    const offenders = files.map(rel).filter((name) => {
      if (name === HELPER) return false;
      const source = fs.readFileSync(path.join(path.dirname(SRC), name), 'utf8');
      return (source.includes('readZipped()') || source.includes('readIngredientZipped(')) && source.includes('unzipSync(');
    });
    expect(offenders, `server-zip readers matching raw entry names:\n${offenders.join('\n')}`).toEqual([]);
  });
});
