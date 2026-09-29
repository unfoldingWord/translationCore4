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
//    raw names again (the guard test below);
// 6. normalization LAUNDERS a hostile name (PR #469 review, George): a stored
//    filename `ingredients\..\x` becomes the traversal key `ingredients/../x`,
//    an absolute name escapes the tree, two names that fold to one key drop a
//    file silently (last write wins — a lost journal segment is not even
//    `invalid`), or a `__proto__` entry poisons the result's prototype (fflate
//    does exactly that). The helper must refuse all four.
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

  it('refuses a name whose normalized form traverses or escapes: `..` segments and absolute paths', () => {
    expect(() => unzipServerZip(zipSync({ 'ingredients\\..\\metadata.json': strToU8('x') }))).toThrow(/not a relative path/);
    expect(() => unzipServerZip(zipSync({ '..\\..\\x': strToU8('x') }))).toThrow(/not a relative path/);
    expect(() => unzipServerZip(zipSync({ '/etc/x': strToU8('x') }))).toThrow(/not a relative path/);
    expect(() => unzipServerZip(zipSync({ 'C:\\evil.txt': strToU8('x') }))).toThrow(/not a relative path/);
  });

  it('refuses two entries that normalize to one name, instead of dropping one silently', () => {
    expect(() => unzipServerZip(zipSync({ 'a\\b.txt': strToU8('one'), 'a/b.txt': strToU8('two') }))).toThrow(/collide/);
  });

  it('refuses a `__proto__` entry instead of losing it into the prototype', () => {
    // fflate's zipSync cannot even write such an entry, and its unzipSync
    // REPLACES the result's prototype when one arrives, so the zip is built by
    // hand: one STORED entry named __proto__ [VERIFIED — fflate 0.8.x probe,
    // 2026-09-28: own keys [], prototype poisoned].
    expect(() => unzipServerZip(storedZip('__proto__', strToU8('data')))).toThrow(/__proto__/);
  });

  it('a hostile name among good ones is refused — validated in the result loop, not only the filter', () => {
    expect(() => unzipServerZip(zipSync({ 'ok.txt': strToU8('x'), 'a\\..\\b': strToU8('y') }), () => true)).toThrow(/not a relative path/);
  });
});

/** A minimal one-entry STORED zip, built by hand so the entry NAME is not
 * constrained by fflate's own zipSync (which refuses `__proto__`). */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const zlib = process.getBuiltinModule('node:zlib') as unknown as { crc32(b: Uint8Array): number };
  const nameBytes = strToU8(name);
  const num = (n: number, w: number) => {
    const b = new Uint8Array(w);
    for (let i = 0; i < w; i++) b[i] = (n >>> (8 * i)) & 0xff;
    return b;
  };
  const crc = zlib.crc32(data);
  const lfh = [new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]), num(crc, 4), num(data.length, 4), num(data.length, 4), num(nameBytes.length, 2), num(0, 2), nameBytes, data];
  const cdh = [new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]), num(crc, 4), num(data.length, 4), num(data.length, 4), num(nameBytes.length, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 4), num(0, 4), nameBytes];
  const flat = (parts: Uint8Array[]) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const lfhBytes = flat(lfh);
  const cdhBytes = flat(cdh);
  const eocd = flat([new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0]), num(1, 2), num(1, 2), num(cdhBytes.length, 4), num(lfhBytes.length, 4), num(0, 2)]);
  return flat([lfhBytes, cdhBytes, eocd]);
}

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
