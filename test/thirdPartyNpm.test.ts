// #554 — the list of npm packages that the client build bundles, with each license text.
// Written before the code (AGENTS.md "How to test", rule 3). The ways it can fail:
//  1. a package with a license file loses its text;
//  2. a package with no license file and an override for its exact version loses the override;
//  3. a package with no license file and no override passes silently;
//  4. an override for another version of the package is used;
//  5. two versions of one package become one entry;
//  6. one package read by many modules (main and worker chunks) becomes many entries;
//  7. a scoped name, a nested node_modules path, a "\0" prefix or a "?query" suffix
//     resolves to the wrong package;
//  8. a module outside node_modules becomes an entry;
//  9. a directory named "licenses" counts as a license file;
// 10. the output order changes from one build to the next.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectNpmNotices, renderNpmNotices } from '../scripts/third-party-npm.mjs';

// The real builtins, not `import 'node:fs'` (CONTRIBUTING.md, "Write a test that reads files").
const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');

let root: string;
let overrides: string;
const nm = () => path.join(root, 'node_modules');

function pkg(dir: string, json: Record<string, unknown>, files: Record<string, string> = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return path.join(dir, 'index.js');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-554-'));
  overrides = path.join(root, 'overrides');
  fs.mkdirSync(overrides);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('collectNpmNotices', () => {
  it('reads the license file of a package (1)', () => {
    const id = pkg(path.join(nm(), 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'MIT text alpha' });
    expect(collectNpmNotices([id], overrides)).toEqual([{ name: 'alpha', version: '1.0.0', license: 'MIT', text: 'MIT text alpha' }]);
  });

  it('finds LICENCE, LICENSE.md and COPYING, and ignores a "licenses" directory (9)', () => {
    const a = pkg(path.join(nm(), 'a'), { name: 'a', version: '1.0.0', license: 'ISC' }, { 'LICENCE.md': 'a text' });
    const b = pkg(path.join(nm(), 'b'), { name: 'b', version: '1.0.0', license: 'GPL-2.0' }, { COPYING: 'b text' });
    const c = pkg(path.join(nm(), 'c'), { name: 'c', version: '1.0.0', license: 'MIT' });
    fs.mkdirSync(path.join(nm(), 'c', 'licenses'));
    expect(() => collectNpmNotices([a, b, c], overrides)).toThrow(/c@1\.0\.0/);
    fs.writeFileSync(path.join(overrides, 'c@1.0.0.txt'), 'c override');
    expect(collectNpmNotices([a, b, c], overrides).map((e) => e.text)).toEqual(['a text', 'b text', 'c override']);
  });

  it('uses the override for the exact version when the package has no license file (2)', () => {
    const id = pkg(path.join(nm(), 'bare'), { name: 'bare', version: '2.0.0', license: 'ISC' });
    fs.writeFileSync(path.join(overrides, 'bare@2.0.0.txt'), 'ISC override text\n');
    expect(collectNpmNotices([id], overrides)).toEqual([{ name: 'bare', version: '2.0.0', license: 'ISC', text: 'ISC override text\n' }]);
  });

  it('fails and names every package with no license file and no override (3)', () => {
    const a = pkg(path.join(nm(), 'bare'), { name: 'bare', version: '2.0.0', license: 'ISC' });
    const b = pkg(path.join(nm(), '@scope', 'naked'), { name: '@scope/naked', version: '0.1.0' });
    expect(() => collectNpmNotices([a, b], overrides)).toThrow(/@scope\/naked@0\.1\.0[\s\S]*bare@2\.0\.0/);
  });

  it('does not use an override for another version (4)', () => {
    const id = pkg(path.join(nm(), 'bare'), { name: 'bare', version: '2.0.1', license: 'ISC' });
    fs.writeFileSync(path.join(overrides, 'bare@2.0.0.txt'), 'old override');
    expect(() => collectNpmNotices([id], overrides)).toThrow(/bare@2\.0\.1/);
  });

  it('keeps two versions of one package apart, and reads a package once for many modules (5, 6)', () => {
    const top = pkg(path.join(nm(), 'dup'), { name: 'dup', version: '2.0.0', license: 'MIT' }, { LICENSE: 'v2' });
    const nested = pkg(path.join(nm(), 'host', 'node_modules', 'dup'), { name: 'dup', version: '1.0.0', license: 'MIT' }, { LICENSE: 'v1' });
    const host = pkg(path.join(nm(), 'host'), { name: 'host', version: '1.0.0', license: 'MIT' }, { LICENSE: 'host' });
    const ids = [top, path.join(nm(), 'dup', 'lib', 'other.js'), nested, host, top];
    expect(collectNpmNotices(ids, overrides).map((e) => `${e.name}@${e.version}:${e.text}`)).toEqual(['dup@1.0.0:v1', 'dup@2.0.0:v2', 'host@1.0.0:host']);
  });

  it('resolves scoped names, "\\0" prefixes and "?query" suffixes, and skips app modules (7, 8)', () => {
    const scoped = pkg(path.join(nm(), '@babel', 'runtime'), { name: '@babel/runtime', version: '7.0.0', license: 'MIT' }, { LICENSE: 'babel' });
    const ids = [`\0${path.join(nm(), '@babel', 'runtime', 'helpers', 'x.js')}?commonjs-proxy`, path.join(root, 'src', 'App.jsx'), `\0vite/preload-helper`, scoped];
    expect(collectNpmNotices(ids, overrides)).toEqual([{ name: '@babel/runtime', version: '7.0.0', license: 'MIT', text: 'babel' }]);
  });

  it('names a scoped override file with "+" in place of "/"', () => {
    const id = pkg(path.join(nm(), '@scope', 'naked'), { name: '@scope/naked', version: '0.1.0', license: 'MIT' });
    fs.writeFileSync(path.join(overrides, '@scope+naked@0.1.0.txt'), 'scoped override');
    expect(collectNpmNotices([id], overrides)[0].text).toBe('scoped override');
  });

  it('gives the same order for any module order (10)', () => {
    const a = pkg(path.join(nm(), 'zed'), { name: 'zed', version: '1.0.0', license: 'MIT' }, { LICENSE: 'z' });
    const b = pkg(path.join(nm(), '@a', 'b'), { name: '@a/b', version: '1.0.0', license: 'MIT' }, { LICENSE: 'b' });
    const c = pkg(path.join(nm(), 'mid'), { name: 'mid', version: '1.0.0', license: 'MIT' }, { LICENSE: 'm' });
    const one = renderNpmNotices(collectNpmNotices([a, b, c], overrides));
    const two = renderNpmNotices(collectNpmNotices([c, a, b], overrides));
    expect(one).toBe(two);
    expect(one.indexOf('@a/b')).toBeLessThan(one.indexOf('mid'));
    expect(one.indexOf('mid')).toBeLessThan(one.indexOf('zed'));
  });
});

describe('renderNpmNotices', () => {
  it('shows the name, the version, the license name and the full text of each entry', () => {
    const md = renderNpmNotices([{ name: 'alpha', version: '1.0.0', license: 'MIT', text: 'line one\n```\nline three' }]);
    expect(md).toContain('alpha');
    expect(md).toContain('1.0.0');
    expect(md).toContain('MIT');
    expect(md).toContain('line one\n```\nline three');
  });
});
