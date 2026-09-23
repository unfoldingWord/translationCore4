// The Scripture Burrito check module (issue #196): the conformance sample and
// the OBS sample pass every check, and each check has one failing case.
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { CHECKS, checkBurrito, compileSbValidator, flavorKind, type MetadataValidator } from '../../src/data/import/burritoCheck.mjs';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const CONFORMANCE = path.resolve(process.cwd(), 'conformance');
const encoder = new TextEncoder();

/** Every file under `dir` as path relative to it → bytes. */
const burritoFiles = (dir: string): Record<string, Uint8Array> => {
  const out: Record<string, Uint8Array> = {};
  const walk = (at: string): void => {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
};

const schemaRoot = path.join(CONFORMANCE, 'sb-schema');
const schemaFiles = (fs.readdirSync(schemaRoot, { recursive: true }) as string[])
  .filter((rel) => rel.endsWith('.json'))
  .map((rel) => [rel.split(path.sep).join('/'), fs.readFileSync(path.join(schemaRoot, rel), 'utf8')] as [string, string]);
const validate = compileSbValidator(Ajv, addFormats, schemaFiles) as MetadataValidator;

const sample = () => burritoFiles(path.join(CONFORMANCE, 'sample-burrito'));
const meta = (files: Record<string, Uint8Array>) => JSON.parse(new TextDecoder().decode(files['metadata.json']));
type Meta = { meta?: unknown; ingredients: Record<string, { size: number }>; type: { flavorType: { flavor: unknown } } };
const withMeta = (files: Record<string, Uint8Array>, edit: (m: Meta) => void) => {
  const m = meta(files);
  edit(m);
  return { ...files, 'metadata.json': encoder.encode(JSON.stringify(m)) };
};
const failed = (files: Record<string, Uint8Array>) => checkBurrito(files, validate).failures;

describe('#196 burritoCheck', () => {
  it('the bundled schema compiles; the Bible and OBS samples pass every check', () => {
    expect(validate).toBeTypeOf('function');
    expect(failed(sample())).toEqual([]);
    expect(failed(burritoFiles(path.join(CONFORMANCE, 'sample-burrito-obs')))).toEqual([]);
    expect(flavorKind(meta(sample()))).toBe('bible');
    expect(flavorKind(meta(burritoFiles(path.join(CONFORMANCE, 'sample-burrito-obs'))))).toBe('obs');
  });

  it(`fails: ${CHECKS.metadataPresent}`, () => {
    const files = sample();
    delete files['metadata.json'];
    expect(failed(files)).toMatchObject([{ check: 'metadataPresent', code: 'import.damaged.no-metadata' }]);
  });

  it(`fails: ${CHECKS.metadataParses}`, () => {
    expect(failed({ ...sample(), 'metadata.json': encoder.encode('{"format": ') })).toMatchObject([{ check: 'metadataParses', code: 'import.damaged.no-metadata' }]);
  });

  it(`fails: ${CHECKS.schema}`, () => {
    const out = failed(withMeta(sample(), (m) => delete m.meta));
    expect(out).toMatchObject([{ check: 'schema' }]);
    expect(out[0].text).toContain(CHECKS.schema);
  });

  it(`fails: ${CHECKS.ingredientPresent}`, () => {
    const files = sample();
    delete files['ingredients/JON.usfm'];
    expect(failed(files)).toMatchObject([{ check: 'ingredientPresent', code: 'import.damaged.checksum-mismatch' }]);
    expect(failed(files)[0].text).toContain('ingredients/JON.usfm');
  });

  it(`fails: ${CHECKS.ingredientChecksum} (md5, then size)`, () => {
    const files = sample();
    const edited = encoder.encode(new TextDecoder().decode(files['ingredients/JON.usfm']).replace('\\v 1 ', '\\v 1 x'));
    expect(failed({ ...files, 'ingredients/JON.usfm': edited })).toMatchObject([{ check: 'ingredientChecksum', code: 'import.damaged.checksum-mismatch' }]);
    const wrongSize = withMeta(files, (m) => (m.ingredients['ingredients/JON.usfm'].size += 1));
    expect(failed(wrongSize)).toMatchObject([{ check: 'ingredientChecksum' }]);
  });

  it(`fails: ${CHECKS.flavor}`, () => {
    // scripture/x-thing is schema-valid (a custom x- flavor): only the flavor check refuses it.
    const custom = withMeta(sample(), (m) => (m.type.flavorType.flavor = { name: 'x-thing' }));
    const out = failed(custom);
    expect(out.map((f) => f.check)).toEqual(['flavor']);
    expect(out.find((f) => f.check === 'flavor')?.code).toBeUndefined();
  });
});
