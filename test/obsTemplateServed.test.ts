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
import { validateObsTemplate, withLocalizedNames } from '../scripts/fix-obs-template.mjs';
import { parseStory } from '../journal/story.mjs';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const os = process.getBuiltinModule('node:os');

const SERVED = path.resolve(
  process.cwd(),
  'dev-env/app-resources/templates/content_templates/text_stories/metadata.json',
);
const VENDORED = path.resolve(process.cwd(), 'conformance/fixtures/text_stories/metadata.json');
const TEMPLATE_FIXTURE = path.resolve(process.cwd(), 'conformance/fixtures/text_stories');

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

describe('prepared OBS template byte validation (#347)', () => {
  it('accepts the pinned fixture and rejects CRLF, lone-CR, ordinary-byte, and content-set mutations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4 obs template '));
    try {
      const templates = path.join(root, 'content_templates', 'text_stories');
      fs.mkdirSync(path.dirname(templates), { recursive: true });
      fs.cpSync(TEMPLATE_FIXTURE, templates, { recursive: true });
      const metadata = path.join(templates, 'metadata.json');
      fs.writeFileSync(metadata, withLocalizedNames(fs.readFileSync(metadata, 'utf8')));
      expect(validateObsTemplate(root).storyCount).toBe(50);

      const story = path.join(templates, 'ingredients', 'content', '01.md');
      const bytes = fs.readFileSync(story);
      const crlf = Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
      fs.writeFileSync(story, crlf);
      expect(() => validateObsTemplate(root)).toThrow(/carriage return/);
      expect(() => parseStory(crlf.toString('utf8'))).toThrow(/carriage return/);

      const loneCr = Buffer.concat([bytes.subarray(0, 1), Buffer.from([0x0d]), bytes.subarray(1)]);
      fs.writeFileSync(story, loneCr);
      expect(() => validateObsTemplate(root)).toThrow(/carriage return/);
      expect(() => parseStory(loneCr.toString('utf8'))).toThrow(/carriage return/);

      fs.writeFileSync(story, bytes);
      fs.writeFileSync(story, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes[bytes.length - 1] ^ 1])]));
      expect(() => validateObsTemplate(root)).toThrow(/bytes differ/);

      fs.writeFileSync(story, bytes);
      const front = path.join(templates, 'ingredients', 'content', 'front', 'intro.md');
      const frontBytes = fs.readFileSync(front);
      fs.writeFileSync(front, Buffer.concat([frontBytes, Buffer.from([0x20])]));
      expect(() => validateObsTemplate(root)).toThrow(/content bytes differ/);
      fs.writeFileSync(front, frontBytes);
      fs.writeFileSync(path.join(templates, 'ingredients', 'content', '51.md'), bytes);
      expect(() => validateObsTemplate(root)).toThrow(/content set mismatch/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
