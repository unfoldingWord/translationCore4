// The OBS template's missing `localizedNames` (J20, #287; PLATFORM-NOTES #36).
//
// pankosmia's `text_stories` content template (`resource-core` 54802be) has no
// `localizedNames`, while the server's own `BurritoMetadata` struct requires
// the field [VERIFIED — pankosmia-web 0.18.5 (99fd9be), `src/structs.rs`,
// 2026-09-16]. `POST /git/new-obs-resource` stamps `metadata.json` from that
// template by string replacement, so every project it creates fails the
// server's own parse: `update_ingredients` writes and `remake-ingredients`
// answer "Could not parse metadata: missing field `localizedNames`". The
// Bible template carries `"localizedNames": {}`; this adds the same key to
// the OBS template wherever tC4 serves it (both rig routes and the packaged
// installer). Idempotent. The vendored conformance fixture is left
// byte-for-byte (its README); `generate-obs.mjs` adds the key to the sample.
//
// Usage: node scripts/fix-obs-template.mjs <templates dir>
//   (the directory that holds content_templates/text_stories/metadata.json)
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const MARKER = '"localizedNames"';
const STORY_COUNT = 50;
const fileURLToPath = process.getBuiltinModule('node:url').fileURLToPath;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REFERENCE_INGREDIENTS = path.resolve(
  SCRIPT_DIR,
  '../conformance/fixtures/text_stories/ingredients',
);

/** The template text with `"localizedNames": {}` before `"ingredients"`, or unchanged. */
export const withLocalizedNames = (text) => {
  if (text.includes(MARKER)) return text;
  const at = text.search(/^[ \t]*"ingredients":/m);
  if (at < 0) throw new Error('OBS template metadata has no "ingredients" key');
  const indent = /^[ \t]*/.exec(text.slice(at))[0];
  return `${text.slice(0, at)}${indent}"localizedNames": {},\n${text.slice(at)}`;
};

/**
 * Validate the prepared story files against the pinned, byte-for-byte fixture.
 * The validator never rewrites story content; assembly must fail if any input
 * was converted, truncated, added, or removed.
 */
export const validateObsTemplate = (
  templatesDir,
  referenceIngredients = DEFAULT_REFERENCE_INGREDIENTS,
) => {
  const metadataFile = path.join(templatesDir, 'content_templates', 'text_stories', 'metadata.json');
  if (!fs.existsSync(metadataFile)) throw new Error(`OBS metadata is missing: ${metadataFile}`);
  const metadata = fs.readFileSync(metadataFile, 'utf8');
  if (!metadata.includes(MARKER)) throw new Error(`OBS metadata is missing ${MARKER}: ${metadataFile}`);
  const target = path.join(templatesDir, 'content_templates', 'text_stories', 'ingredients', 'content');
  const reference = path.join(referenceIngredients, 'content');
  const expectedNames = Array.from({ length: STORY_COUNT }, (_, index) => `${String(index + 1).padStart(2, '0')}.md`);
  if (!fs.existsSync(target)) throw new Error(`OBS story directory is missing: ${target}`);
  if (!fs.existsSync(reference)) throw new Error(`OBS reference story directory is missing: ${reference}`);

  const expectedContentEntries = [...expectedNames, 'back', 'front'].sort();
  const actualNames = fs.readdirSync(target).sort();
  if (actualNames.length !== expectedContentEntries.length || actualNames.some((name, index) => name !== expectedContentEntries[index])) {
    throw new Error(`OBS content set mismatch at ${target}: expected ${expectedContentEntries.join(', ')}, found ${actualNames.join(', ')}`);
  }

  for (const name of expectedNames) {
    const targetFile = path.join(target, name);
    const referenceFile = path.join(reference, name);
    if (!fs.existsSync(referenceFile)) throw new Error(`OBS reference story is missing: ${referenceFile}`);
    const actual = fs.readFileSync(targetFile);
    const expected = fs.readFileSync(referenceFile);
    if (actual.includes(0x0d)) throw new Error(`OBS story contains carriage return: ${targetFile}`);
    if (!actual.equals(expected)) throw new Error(`OBS story bytes differ from the pinned fixture: ${targetFile}`);
  }
  for (const name of ['front/title.md', 'front/intro.md', 'back/intro.md']) {
    const targetFile = path.join(target, name);
    const referenceFile = path.join(reference, name);
    const actual = fs.readFileSync(targetFile);
    const expected = fs.readFileSync(referenceFile);
    if (actual.includes(0x0d)) throw new Error(`OBS content contains carriage return: ${targetFile}`);
    if (!actual.equals(expected)) throw new Error(`OBS content bytes differ from the pinned fixture: ${targetFile}`);
  }
  for (const [directory, expectedFiles] of [['front', ['intro.md', 'title.md']], ['back', ['intro.md']]]) {
    const targetDir = path.join(target, directory);
    const actualFiles = fs.readdirSync(targetDir).sort();
    if (actualFiles.length !== expectedFiles.length || actualFiles.some((name, index) => name !== expectedFiles[index])) {
      throw new Error(`OBS ${directory} content set mismatch at ${targetDir}`);
    }
  }
  return { target, storyCount: STORY_COUNT };
};

// Run-as-CLI guard: `fileURLToPath` (not a URL-pathname comparison, which never
// matches on Windows and mangles spaces as %20). Resolved through the runtime
// instead of a static `node:url` import: the Vite polyfill aliases `node:url`
// to a browser proxy that crashes, and this module is imported by the test rig
// (`test/helpers/journalingRig.ts`) — same escape hatch as CONTRIBUTING's
// "Write a test that reads files".
const isCli =
  !!process.argv[1] &&
  path.resolve(process.argv[1]) ===
    process.getBuiltinModule('node:url').fileURLToPath(import.meta.url);

if (isCli) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/fix-obs-template.mjs <templates dir>');
    process.exit(2);
  }
  const file = path.join(dir, 'content_templates', 'text_stories', 'metadata.json');
  const before = fs.readFileSync(file, 'utf8');
  const after = withLocalizedNames(before);
  if (after !== before) fs.writeFileSync(file, after);
  const result = validateObsTemplate(dir);
  console.log(`${file}: ${after !== before ? 'localizedNames added' : 'already carries localizedNames'}`);
  console.log(`${result.target}: ${result.storyCount} story files validated byte-for-byte`);
}
