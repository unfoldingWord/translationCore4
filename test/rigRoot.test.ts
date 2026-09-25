import { describe, expect, it } from 'vitest';
import { TC4_ROOT } from '../e2e/helpers/rig';

// #396: the journeys use this repository's own dev-env/ and sample project,
// never a folder beside the repository.
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

describe('#396 — the journey rig root', () => {
  it('is the repository root: it holds this package.json', () => {
    expect(path.resolve(TC4_ROOT)).toBe(path.resolve(process.cwd()));
    const pkg = JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('uw-tc4');
  });

  it('holds the sample project that resetSeededChecking reads', () => {
    const source = path.join(TC4_ROOT, 'conformance', 'sample-burrito', 'ingredients');
    for (const rel of ['TIT.usfm', 'JON.usfm', 'checking']) {
      expect(fs.existsSync(path.join(source, rel)), rel).toBe(true);
    }
  });
});
