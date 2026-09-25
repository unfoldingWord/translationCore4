// #347: the prepared OBS template byte validation in scripts/fix-obs-template.mjs.
import { describe, expect, it } from 'vitest';
import { validateObsTemplate, withLocalizedNames } from '../scripts/fix-obs-template.mjs';
import { parseStory } from '../journal/story.mjs';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const os = process.getBuiltinModule('node:os');

const TEMPLATE_FIXTURE = path.resolve(process.cwd(), 'conformance/fixtures/text_stories');

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
