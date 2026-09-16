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
// the OBS template wherever tC4 serves it (the rig's app resources and the
// packaged installer). Idempotent. The vendored conformance fixture is left
// byte-for-byte (its README); `generate-obs.mjs` adds the key to the sample.
//
// Usage: node scripts/fix-obs-template.mjs <templates dir>
//   (the directory that holds content_templates/text_stories/metadata.json)
import fs from 'node:fs';
import path from 'node:path';

const MARKER = '"localizedNames"';

/** The template text with `"localizedNames": {}` before `"ingredients"`, or unchanged. */
export const withLocalizedNames = (text) => {
  if (text.includes(MARKER)) return text;
  const at = text.search(/^[ \t]*"ingredients":/m);
  if (at < 0) throw new Error('OBS template metadata has no "ingredients" key');
  const indent = /^[ \t]*/.exec(text.slice(at))[0];
  return `${text.slice(0, at)}${indent}"localizedNames": {},\n${text.slice(at)}`;
};

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/fix-obs-template.mjs <templates dir>');
    process.exit(2);
  }
  const file = path.join(dir, 'content_templates', 'text_stories', 'metadata.json');
  const before = fs.readFileSync(file, 'utf8');
  const after = withLocalizedNames(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`${file}: ${after !== before ? 'localizedNames added' : 'already carries localizedNames'}`);
}
