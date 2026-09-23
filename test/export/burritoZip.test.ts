// The Scripture Burrito zip producer (issue #359): the server's zip of the
// repository minus `.git/`, `*.bak` and `.DS_Store`; every other entry byte for
// byte; `metadata.json` gains the relationships mirror and the `dcs` authority.
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BURRITO_ZIP, burritoFromRepoZip } from '../../src/data/export/burritoZip';
import { relationshipsFromPins } from '../../src/data/export/relationships';
import type { BurritoStore, ProjectSummary } from '../../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito');
const sampleFile = (p: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(SAMPLE, p)));
const RESOURCES = 'ingredients/checking/resources.json';

/** A repository zip the way the server makes one: directory entries, `.git/`, backups, Finder files. */
const serverZip = (metadata: Record<string, unknown> = JSON.parse(strFromU8(sampleFile('metadata.json')))) =>
  zipSync({
    '.DS_Store': strToU8('finder'),
    '.git/': new Uint8Array(0),
    '.git/HEAD': strToU8('ref: refs/heads/main\n'),
    '.git/objects/ab/cdef': strToU8('object'),
    '.gitignore': strToU8('**/*.bak\n'),
    'metadata.json': strToU8(JSON.stringify(metadata)),
    'ingredients/': new Uint8Array(0),
    'ingredients/TIT.usfm': sampleFile('ingredients/TIT.usfm'),
    'ingredients/TIT.usfm.bak': strToU8('old'),
    'ingredients/checking/': new Uint8Array(0),
    'ingredients/checking/.DS_Store': strToU8('finder'),
    [RESOURCES]: sampleFile(RESOURCES),
  });

describe('burritoFromRepoZip', () => {
  it('removes .git/, every *.bak and every .DS_Store, and keeps every other entry byte-identical', () => {
    const repo = unzipSync(serverZip());
    const out = unzipSync(burritoFromRepoZip(serverZip()));
    expect(Object.keys(out).sort()).toEqual(['.gitignore', 'ingredients/', 'ingredients/TIT.usfm', 'ingredients/checking/', RESOURCES, 'metadata.json']);
    for (const name of ['.gitignore', 'ingredients/TIT.usfm', RESOURCES]) expect(Buffer.from(out[name]).equals(Buffer.from(repo[name]))).toBe(true);
  });

  it('keeps the ingredients/ directory entry the server importer requires', () => {
    expect(Object.keys(unzipSync(burritoFromRepoZip(serverZip())))).toContain('ingredients/');
  });

  it('writes the relationships mirror of resources.json and the dcs id authority into metadata.json', () => {
    const { relationships, idAuthorities, ...rest } = JSON.parse(strFromU8(sampleFile('metadata.json')));
    const stored = { ...rest, idAuthorities: { local: idAuthorities.local } }; // an app-created project: no mirror yet
    const meta = JSON.parse(strFromU8(unzipSync(burritoFromRepoZip(serverZip(stored)))['metadata.json']));
    expect(meta.relationships).toEqual(relationshipsFromPins(JSON.parse(strFromU8(sampleFile(RESOURCES)))));
    expect(meta.relationships).toEqual(relationships);
    expect(meta.idAuthorities).toEqual(idAuthorities);
    expect({ ...meta, relationships: undefined, idAuthorities: undefined }).toEqual({ ...rest, relationships: undefined, idAuthorities: undefined });
  });

  it("keeps a Bible project's stored ingredients table (the server's own rescan, with roles and scopes)", () => {
    const stored = JSON.parse(strFromU8(sampleFile('metadata.json')));
    const meta = JSON.parse(strFromU8(unzipSync(burritoFromRepoZip(serverZip()))['metadata.json']));
    expect(meta.ingredients).toEqual(stored.ingredients);
  });

  it("rebuilds an OBS project's ingredients table from the zipped files: prefixed keys, md5, size, mimeType, sidecars listed", () => {
    const crypto = process.getBuiltinModule('node:crypto');
    const story = strToU8('# 1. La Creación\n\n![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)\n\nAsí fue.\n');
    const resources = sampleFile(RESOURCES);
    const zip = zipSync({
      '.git/HEAD': strToU8('ref'),
      // the platform's creation-time table (PLATFORM-NOTES #37): no ingredients/ prefix, stale md5
      'metadata.json': strToU8(JSON.stringify({ type: { flavorType: { name: 'gloss', flavor: { name: 'textStories' } } }, ingredients: { 'content/01.md': { checksum: { md5: 'stale' }, mimeType: 'text/markdown', size: 1 } } })),
      'ingredients/': new Uint8Array(0),
      'ingredients/content/01.md': story,
      'ingredients/content/01.md.bak': strToU8('old'),
      [RESOURCES]: resources,
    });
    const meta = JSON.parse(strFromU8(unzipSync(burritoFromRepoZip(zip))['metadata.json']));
    const md5 = (b: Uint8Array) => crypto.createHash('md5').update(b).digest('hex');
    expect(meta.ingredients).toEqual({
      'ingredients/checking/resources.json': { checksum: { md5: md5(resources) }, mimeType: 'application/json', size: resources.byteLength },
      'ingredients/content/01.md': { checksum: { md5: md5(story) }, mimeType: 'text/markdown', size: story.byteLength },
    });
    expect(meta.relationships.length).toBeGreaterThan(0);
  });

  it('leaves metadata.json byte-identical when the project has no resources.json', () => {
    const zip = zipSync({ 'metadata.json': strToU8('{"format":"scripture burrito"}'), 'ingredients/': new Uint8Array(0) });
    expect(strFromU8(unzipSync(burritoFromRepoZip(zip))['metadata.json'])).toBe('{"format":"scripture burrito"}');
  });
});

describe('the burrito-zip producer', () => {
  const project = (flavor: ProjectSummary['flavor']) => ({ id: '_local_/_local_/x', name: 'Muestra', languageTag: 'es', scriptDirection: 'ltr', flavor, bookCodes: [] }) as ProjectSummary;

  it('is in the export menu for Bible and OBS projects', () => {
    expect(BURRITO_ZIP.label).toBe('Scripture Burrito (.zip)');
    expect(BURRITO_ZIP.appliesTo(project('textTranslation'))).toBe(true);
    expect(BURRITO_ZIP.appliesTo(project('textStories'))).toBe(true);
  });

  it('reads the zip through the store and names the file <project>-<YYYY-MM-DD>.zip', async () => {
    const store = { readZipped: async () => serverZip() } as unknown as BurritoStore;
    const file = await BURRITO_ZIP.produce({ store, project: project('textTranslation') });
    expect(file.filename).toMatch(/^Muestra-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(file.mime).toBe('application/zip');
    expect(Object.keys(unzipSync(file.bytes))).not.toContain('.git/HEAD');
  });
});
