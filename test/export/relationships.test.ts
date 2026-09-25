// The `relationships` mirror (issue #359, BURRITO-SPEC §3 rule 6): one function
// derives it from `checking/resources.json`, and the harness generator calls
// the same function, so the conformance sample's metadata is its output.
import { describe, expect, it } from 'vitest';
import { relationshipsFromPins } from '../../src/data/export/relationships';
import type { ResourcesFile } from '../../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(SAMPLE, p), 'utf8'));
const sampleResources = (): ResourcesFile => readJson('ingredients/checking/resources.json');

describe('relationshipsFromPins', () => {
  it("derives the conformance sample's relationships from its resources.json, row for row", () => {
    const rows = relationshipsFromPins(sampleResources());
    expect(rows).toEqual(readJson('metadata.json').relationships);
    expect(rows.map((r) => r.id)).toEqual([
      'dcs::unfoldingWord/el-x-koine_ugnt',
      'dcs::unfoldingWord/hbo_uhb',
      'dcs::unfoldingWord/en_ult',
      'dcs::unfoldingWord/en_ust',
      'dcs::es-419_gl/es-419_tn',
      'dcs::es-419_gl/es-419_tw',
      'dcs::es-419_gl/es-419_ta',
      'dcs::unfoldingWord/en_tn',
      'dcs::unfoldingWord/en_tw',
      'dcs::unfoldingWord/en_ta',
      'dcs::unfoldingWord/en_tq',
      'dcs::unfoldingWord/en_ugl',
      'dcs::unfoldingWord/en_uhl',
    ]);
  });

  it('maps the flavor type to the relation type and the version label to the revision', () => {
    const rows = relationshipsFromPins(sampleResources());
    expect(rows[0]).toEqual({ relationType: 'source', flavor: 'textTranslation', id: 'dcs::unfoldingWord/el-x-koine_ugnt', revision: 'v0.34' });
    expect(rows.find((r) => r.id.endsWith('/es-419_tn'))).toEqual({ relationType: 'parascriptural', flavor: 'x-bcvnotes', id: 'dcs::es-419_gl/es-419_tn', revision: 'v66' });
    expect(rows.find((r) => r.id.endsWith('/en_ta'))?.relationType).toBe('peripheral');
    // a sha-only pin (D58) has no revision
    expect(rows.at(-1)).toEqual({ relationType: 'peripheral', flavor: 'x-lexicon', id: 'dcs::unfoldingWord/en_uhl' });
  });

  it('gives the OBS source text (gloss/textStories) no row, and keeps the OBS helps', () => {
    const obs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../conformance/sample-burrito-obs/ingredients/checking/resources.json'), 'utf8'));
    const rows = relationshipsFromPins(obs);
    expect(rows.some((r) => r.id.endsWith('_obs'))).toBe(false);
    expect(rows.find((r) => r.id === 'dcs::unfoldingWord/en_obs-tq')).toEqual({ relationType: 'peripheral', flavor: 'x-obsquestions', id: 'dcs::unfoldingWord/en_obs-tq', revision: 'v10' });
  });
});
