// The Scripture Burrito parser (issue #196, J9d): the kind comes from the
// flavor; a tC4 burrito carries its alignments and decisions, and a round trip
// through the Scripture Burrito zip export (#359) keeps them record for record;
// a foreign burrito imports text only; flat and wrapped zips give one bundle;
// a failed check is a damaged finding with the check's name and code.
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { BURRITO_PARSER } from '../../src/data/import/burrito';
import { CHECKS } from '../../src/data/import/burritoCheck.mjs';
import { burritoFromRepoZip } from '../../src/data/export/burritoZip';
import type { ImportFile } from '../../src/data/import/types';
import { fixtureFile, readManifest } from '../helpers/import';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const SAMPLE = path.resolve(process.cwd(), 'conformance/sample-burrito');
const decoder = new TextDecoder();
const sidecar = (rel: string) => JSON.parse(fs.readFileSync(path.join(SAMPLE, 'ingredients/checking', rel), 'utf8'));

/** The original records, read straight from the sample's sidecars. */
const ORIGINAL = {
  alignments: {
    TIT: Object.entries(sidecar('alignments/TIT.json').chapters as Record<string, Record<string, unknown>>).flatMap(([, verses]) => Object.values(verses)),
  },
  decisions: [...sidecar('translationNotes/TIT.json').decisions, ...sidecar('translationWords/TIT.json').decisions],
};

const parse = (file: ImportFile) => BURRITO_PARSER.parse([file]);
const zipFile = (name: string, entries: Record<string, Uint8Array>): ImportFile => ({ name, bytes: zipSync(entries) });
const { bytes: sampleZip } = fixtureFile('../../sample-burrito');

describe('#196 the burrito parser', () => {
  it('accepts one .zip only', () => {
    expect(BURRITO_PARSER.accepts([fixtureFile('../../sample-burrito')])).toBe(true);
    expect(BURRITO_PARSER.accepts([fixtureFile('../../sample-burrito'), fixtureFile('burrito/foreign')])).toBe(false);
    expect(BURRITO_PARSER.accepts([{ name: 'TIT.usfm', bytes: new Uint8Array() }])).toBe(false);
  });

  it('a Bible burrito: kind from the flavor, the es-419 tag, the books, the archive as it is, the carried records', async () => {
    const file = fixtureFile('../../sample-burrito');
    const bundle = await parse(file);
    expect(bundle.findings).toEqual([]);
    expect(bundle.kind).toBe('bible');
    expect(bundle.facts).toEqual({ language: 'es-419', name: 'Equipo Ejemplo — Tito y Jonás' });
    expect(bundle.books.map((b) => b.code)).toEqual(['JON', 'TIT']);
    expect(bundle.books[1].usfm).toBe(fs.readFileSync(path.join(SAMPLE, 'ingredients/TIT.usfm'), 'utf8'));
    expect(bundle.archive).toBe(file.bytes);
    expect(bundle.alignments).toEqual(ORIGINAL.alignments);
    expect(bundle.decisions).toEqual(ORIGINAL.decisions);
  });

  it('an OBS burrito: kind obs from gloss/textStories, the stories, no books', async () => {
    const bundle = await parse(fixtureFile('../../sample-burrito-obs'));
    expect(bundle.findings).toEqual([]);
    expect(bundle.kind).toBe('obs');
    expect(bundle.facts.language).toBe('es-419');
    expect(bundle.books).toEqual([]);
    expect(bundle.stories?.map((s) => s.n)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('the round trip: a tC4 export of the sample re-imports its alignments and decisions record for record', async () => {
    // The export producer reads the server's zip of the repository; `.git/` is what it drops.
    const repoZip = zipSync({ ...unzipSync(sampleZip), '.git/HEAD': new TextEncoder().encode('ref: refs/heads/main\n') });
    const exported = await parse({ name: 'export.zip', bytes: burritoFromRepoZip(repoZip) });
    expect(exported.findings).toEqual([]);
    expect(exported.alignments).toEqual(ORIGINAL.alignments);
    expect(exported.decisions).toEqual(ORIGINAL.decisions);
    expect(exported.alignments!.TIT.length).toBeGreaterThan(0);
    expect(exported.decisions!.length).toBeGreaterThan(0);
  });

  it('the manifest tC4 export (with its journal) carries the same records as the original', async () => {
    const entry = readManifest().find((e) => e.parser === 'burrito' && e.file === 'burrito/tc4-export.zip')!;
    const bundle = await parse(fixtureFile(entry.file as string));
    expect(bundle.findings).toEqual([]);
    expect(bundle.alignments).toEqual(ORIGINAL.alignments);
    expect(bundle.decisions).toEqual(ORIGINAL.decisions);
  });

  it('a foreign burrito imports text only, and a details finding says so', async () => {
    const bundle = await parse(fixtureFile('burrito/foreign', 'es-419_foreign'));
    expect(bundle.books.map((b) => b.code)).toEqual(['JON']);
    expect(bundle.alignments).toBeUndefined();
    expect(bundle.decisions).toBeUndefined();
    expect(bundle.findings).toMatchObject([{ kind: 'details', warn: false, text: expect.stringContaining('Only the text is imported') }]);
  });

  it('flat (the server export) and wrapped (a DCS sb-zip) give one bundle', async () => {
    const flat = await parse(fixtureFile('../../sample-burrito'));
    const wrapped = await parse(fixtureFile('../../sample-burrito', 'es-419_sample'));
    expect({ ...wrapped, archive: undefined }).toEqual({ ...flat, archive: undefined });
  });

  it('refuse: each failed check is a damaged finding that names the check and carries its code', async () => {
    const noMeta = await parse(fixtureFile('damaged/burrito-no-metadata'));
    expect(noMeta.findings).toMatchObject([{ kind: 'damaged', code: 'import.damaged.no-metadata', text: expect.stringContaining(CHECKS.metadataPresent) }]);
    const mismatch = await parse(fixtureFile('damaged/burrito-checksum-mismatch'));
    expect(mismatch.findings).toMatchObject([{ kind: 'damaged', code: 'import.damaged.checksum-mismatch', text: expect.stringContaining('ingredients/JON.usfm') }]);
    const unparseable = await parse(zipFile('unparseable.zip', { ...unzipSync(sampleZip), 'metadata.json': new TextEncoder().encode('{"format": ') }));
    expect(unparseable.findings).toMatchObject([{ kind: 'damaged', code: 'import.damaged.no-metadata', text: expect.stringContaining(CHECKS.metadataParses) }]);
    // the parse check reads the metadata.json unwrapExport keeps, never one under .git/
    const gitMeta = await parse(zipFile('git.zip', { '.git/metadata.json': new TextEncoder().encode('{'), ...unzipSync(sampleZip) }));
    expect(gitMeta.findings).toEqual([]);
    const cut = await parse({ name: 'cut.zip', bytes: sampleZip.slice(0, sampleZip.length / 2) });
    expect(cut.findings).toMatchObject([{ kind: 'damaged', code: 'import.damaged.truncated' }]);
    const files = unzipSync(sampleZip);
    const meta = JSON.parse(decoder.decode(files['metadata.json']));
    meta.type.flavorType.flavor = { name: 'x-thing' };
    const custom = await parse(zipFile('custom.zip', { ...files, 'metadata.json': new TextEncoder().encode(JSON.stringify(meta)) }));
    expect(custom.findings.some((f) => f.kind === 'damaged' && f.text.includes(CHECKS.flavor))).toBe(true);
  });
});
