// The OBS template the rig serves carries `localizedNames` (#344, PLATFORM-NOTES
// #36): `scripts/fix-obs-template.mjs` adds the key on every route that serves
// the template (the pins rig route, the assembled-build rig route, and the
// packaged installer). This proof reads the served file itself, so a silent
// no-op of the fix script fails instead of passing. Without an assembled rig
// the suite skips with a clear message (rig-dependent rows are accepted; the
// `rig` CI job assembles via the pins route and runs them).
//
// The negative control reads the vendored fixture, which stays byte-for-byte
// upstream (no `localizedNames`): the same assertion shape fails on it, so the
// positive assertion is not vacuous.
import { describe, expect, it } from 'vitest';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SERVED = path.resolve(
  process.cwd(),
  'dev-env/app-resources/templates/content_templates/text_stories/metadata.json',
);
const VENDORED = path.resolve(process.cwd(), 'conformance/fixtures/text_stories/metadata.json');

const servedPresent = fs.existsSync(SERVED);

if (!servedPresent) {
  console.warn(
    '[obsTemplateServed] no served OBS template at dev-env/app-resources/templates ' +
      '(run zsh dev-env/scripts/setup-from-pins.zsh to assemble the rig) — the served-template proof is skipped.',
  );
}

describe.skipIf(!servedPresent)('served OBS template carries localizedNames (#344)', () => {
  it('metadata.json the rig serves contains the localizedNames key (PLATFORM-NOTES #36)', () => {
    // String match, not JSON.parse: the served file is a stamp template with
    // %%PLACEHOLDERS%% the platform replaces at creation (new_obs_resource.rs).
    const text = fs.readFileSync(SERVED, 'utf8');
    expect(text.includes('"localizedNames"')).toBe(true);
    expect(text.indexOf('"localizedNames"') < text.indexOf('"ingredients"')).toBe(true);
  });
});

describe('served OBS template proof is not vacuous (#344)', () => {
  it('negative control: the vendored byte-for-byte fixture lacks the key, so the assertion fails on unfixed input', () => {
    const text = fs.readFileSync(VENDORED, 'utf8');
    expect(text.includes('"localizedNames"')).toBe(false);
  });
});
