// The Scripture Burrito checks (issue #196, docs/ARCHITECTURE.md §8): what
// "valid" means for a burrito tC4 imports. One implementation: the burrito
// parser (./burrito.ts) calls it in the app, and the conformance harness
// (conformance/validate.mjs, Stage-1) imports its schema and ingredient checks.
// It is `.mjs`, not `.ts`, so that Node runs it with no build step, as it runs
// journal/*.mjs. Pure: no fs, no crypto; Ajv comes from the caller, because
// the app and the harness each carry their own copy.
import { md5Bytes } from '../../../journal/md5.mjs';

const decoder = new TextDecoder();

/** The check names. A failed check is a damaged finding whose text names it. */
export const CHECKS = {
  metadataPresent: 'metadata.json is present',
  metadataParses: 'metadata.json parses',
  schema: 'metadata.json matches the Scripture Burrito schema',
  ingredientPresent: 'every listed ingredient is present',
  ingredientChecksum: 'every listed ingredient has its md5 and size',
  flavor: 'the flavor is textTranslation or gloss/textStories',
};

/** The refusal code of each check, where the closed table (journal/report.mjs) has one. */
const CODES = {
  metadataPresent: 'import.damaged.no-metadata',
  metadataParses: 'import.damaged.no-metadata',
  ingredientPresent: 'import.damaged.checksum-mismatch',
  ingredientChecksum: 'import.damaged.checksum-mismatch',
};

/** @typedef {{ check: keyof typeof CHECKS, text: string, code?: string }} CheckFailure */
/** @typedef {((meta: unknown) => boolean) & { errors?: unknown[] | null }} MetadataValidator */

/** Compile the bundled Scripture Burrito schema (conformance/sb-schema/) into
 * one validator for `source_metadata.schema.json`. `schemas` is every schema
 * file as [path relative to sb-schema/, text]. One bundle file has a trailing
 * comma, so trailing commas are stripped before the strict parse; each `$id` is
 * re-keyed under one base URI so that bare, subfolder and `../` references all
 * resolve (the bundle ships the root with `$id` "." and relies on a lenient
 * resolver). Returns null when the root schema does not resolve.
 * @param {any} Ajv @param {any} addFormats @param {Array<[string, string]>} schemas
 * @returns {MetadataValidator | null} */
export function compileSbValidator(Ajv, addFormats, schemas) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const BASE = 'https://sb.local/';
  for (const [rel, text] of schemas) {
    let schema;
    try {
      schema = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      continue;
    }
    schema.$id = BASE + rel;
    try {
      ajv.addSchema(schema);
    } catch {
      /* duplicate $id: the first wins */
    }
  }
  return ajv.getSchema(BASE + 'source_metadata.schema.json') || null;
}

/** The schema check. @param {unknown} meta @param {MetadataValidator} validate
 * @returns {CheckFailure | null} */
export function checkSchema(meta, validate) {
  if (validate(meta)) return null;
  return fail('schema', JSON.stringify((validate.errors ?? []).slice(0, 3)));
}

/** The ingredient checks: every ingredient `meta` lists is present in `files`
 * (path relative to the burrito root → bytes) with its md5 and size.
 * @param {{ ingredients?: Record<string, { checksum?: { md5?: string }, size?: number }> }} meta
 * @param {Record<string, Uint8Array>} files @returns {CheckFailure[]} */
export function checkIngredients(meta, files) {
  const out = [];
  for (const [rel, entry] of Object.entries(meta.ingredients ?? {})) {
    const bytes = files[rel];
    if (!bytes) out.push(fail('ingredientPresent', rel));
    else if (entry.checksum?.md5 !== md5Bytes(bytes) || entry.size !== bytes.byteLength) out.push(fail('ingredientChecksum', rel));
  }
  return out;
}

/** The project kind the flavor names, or null for any other flavor.
 * @param {any} meta @returns {'bible' | 'obs' | null} */
export function flavorKind(meta) {
  const type = meta?.type?.flavorType;
  if (type?.name === 'scripture' && type.flavor?.name === 'textTranslation') return 'bible';
  if (type?.name === 'gloss' && type.flavor?.name === 'textStories') return 'obs';
  return null;
}

/** Every check on a burrito's files (path relative to the burrito root →
 * bytes). Returns the parsed metadata and the failures; no failure means valid.
 * @param {Record<string, Uint8Array>} files @param {MetadataValidator} validate
 * @returns {{ meta: any, failures: CheckFailure[] }} */
export function checkBurrito(files, validate) {
  if (!files['metadata.json']) return { meta: null, failures: [fail('metadataPresent')] };
  let meta;
  try {
    meta = JSON.parse(decoder.decode(files['metadata.json']));
  } catch (error) {
    return { meta: null, failures: [fail('metadataParses', String(/** @type {Error} */ (error).message))] };
  }
  // The later checks read the shape the schema proves, so a schema failure stops here.
  const schema = checkSchema(meta, validate);
  if (schema) return { meta, failures: [schema] };
  const failures = [...checkIngredients(meta, files), flavorKind(meta) ? null : fail('flavor', JSON.stringify(meta.type.flavorType))];
  return { meta, failures: failures.filter((f) => f !== null) };
}

/** @param {keyof typeof CHECKS} check @param {string} [detail] @returns {CheckFailure} */
const fail = (check, detail) => ({ check, text: `Check failed: ${CHECKS[check]}${detail ? ` (${detail})` : ''}.`, ...(check in CODES ? { code: CODES[/** @type {keyof typeof CODES} */ (check)] } : {}) });
