// The Scripture Burrito parser (issue #196, journey J9d, docs/ARCHITECTURE.md
// §8): one burrito zip → one ImportBundle that uploads the burrito as it is
// (`archive`, D80 point 2). It checks the files the shell will store (the same
// `unwrapExport`) with tC4's own check module, not the platform audit (D80
// point 6, PLATFORM-NOTES #44). A burrito with `ingredients/checking/` is a tC4
// burrito: its alignments and decisions are read for the review page, and its
// journal and sidecars arrive byte for byte in the archive. Any other burrito
// imports text only, and a details finding says so.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { unzipSync } from 'fflate';
import { t } from '../../i18n';
import { unwrapExport } from '../resourceFetch';
import { checkBurrito, compileSbValidator, flavorKind, type CheckFailure, type MetadataValidator } from './burritoCheck.mjs';
import type { AlignmentRecord, DecisionRecord, ImportBundle, ImportFile, ImportParser } from './types';

const decoder = new TextDecoder();
const SB_SCHEMA = '../../../conformance/sb-schema/';
const SCHEMAS = import.meta.glob('../../../conformance/sb-schema/**/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

let validator: MetadataValidator | null = null;
/** The bundled schema, compiled once on first use. */
const sbValidator = (): MetadataValidator => {
  validator ??= compileSbValidator(Ajv, addFormats, Object.entries(SCHEMAS).map(([key, text]) => [key.slice(SB_SCHEMA.length), text]));
  if (!validator) throw new Error('the bundled Scripture Burrito schema did not compile');
  return validator;
};

type Finding = ImportBundle['findings'][number];
type Files = Record<string, Uint8Array>;
const damagedBundle = (findings: Finding[]): ImportBundle => ({ kind: 'bible', facts: { language: '', name: '' }, books: [], findings });
const damaged = (text: string, code?: string): Finding => ({ kind: 'damaged', text, warn: true, ...(code ? { code: code as Finding['code'] } : {}) });

const json = (bytes: Uint8Array) => JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;

/** The §5.1 records of one alignment sidecar, in chapter and verse order. */
const alignmentRecords = (file: { chapters?: Record<string, Record<string, AlignmentRecord>> }): AlignmentRecord[] =>
  Object.keys(file.chapters ?? {})
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((c) => Object.keys(file.chapters![c]).sort((a, b) => Number(a) - Number(b)).map((v) => file.chapters![c][v]));

/** The burrito's files as the shell will store them (`unwrapExport`), checked;
 * or the damaged bundle that refuses the zip. */
function unpack(file: ImportFile): { root: Files; meta: ReturnType<typeof checkBurrito>['meta'] } | { refused: ImportBundle } {
  let entries: Files;
  try {
    entries = unzipSync(file.bytes);
  } catch {
    return { refused: damagedBundle([damaged(`${file.name} is not a complete zip file.`, 'import.damaged.truncated')]) };
  }
  const refuse = (failures: CheckFailure[]) => ({ refused: damagedBundle(failures.map((f) => damaged(`${file.name}: ${f.text}`, f.code))) });
  // unwrapExport refuses a zip with no metadata.json, or one that does not parse,
  // but without the check's name and code: those two checks run first.
  const metaName = Object.keys(entries).find((n) => /^([^/]+\/)?metadata\.json$/.test(n));
  if (!metaName) return refuse(checkBurrito({}, sbValidator()).failures);
  const parses = checkBurrito({ 'metadata.json': entries[metaName] }, sbValidator()).failures.filter((f) => f.check === 'metadataParses');
  if (parses.length) return refuse(parses);
  let root: Files;
  try {
    root = unwrapExport(file.bytes).files;
  } catch (error) {
    return { refused: damagedBundle([damaged(`${file.name}: ${(error as Error).message}.`)]) };
  }
  const { meta, failures } = checkBurrito(root, sbValidator());
  return failures.length ? refuse(failures) : { root, meta };
}

/** The books (read from the `\id` line) and the stories (`content/NN.md`) of a checked burrito. */
const contents = (root: Files) => ({
  books: Object.entries(root)
    .filter(([rel]) => /^ingredients\/[^/]+\.usfm$/.test(rel))
    .map(([, bytes]) => {
      const usfm = decoder.decode(bytes);
      return { code: /^\\id ([A-Z0-9]{3})/m.exec(usfm)?.[1] ?? '', usfm };
    })
    .sort((a, b) => a.code.localeCompare(b.code)),
  stories: Object.entries(root)
    .map(([rel, bytes]) => ({ n: Number(/^ingredients\/content\/(\d\d)\.md$/.exec(rel)?.[1]), markdown: decoder.decode(bytes) }))
    .filter((s) => s.n > 0)
    .sort((a, b) => a.n - b.n),
});

/** A tC4 burrito's alignments and decisions, read from its sidecars (the
 * journal stays in the archive); a foreign burrito's details finding. */
function addCarried(root: Files, bundle: ImportBundle): void {
  const sidecars = Object.keys(root).filter((rel) => rel.startsWith('ingredients/checking/')).sort();
  if (sidecars.length === 0) {
    bundle.findings.push({ kind: 'details', text: t('importer.review.textOnly'), warn: false });
    return;
  }
  const alignments: Record<string, AlignmentRecord[]> = {};
  const decisions: DecisionRecord[] = [];
  for (const rel of sidecars) {
    if (!rel.endsWith('.json') || rel.startsWith('ingredients/checking/journal/')) continue;
    const book = /^ingredients\/checking\/alignments\/([A-Z0-9]{3})\.json$/.exec(rel)?.[1];
    const sidecar = json(root[rel]);
    if (book) alignments[book] = alignmentRecords(sidecar);
    else if (Array.isArray(sidecar.decisions)) decisions.push(...(sidecar.decisions as DecisionRecord[]));
  }
  Object.assign(bundle, { alignments, decisions });
}

async function parse(files: ImportFile[]): Promise<ImportBundle> {
  const unpacked = unpack(files[0]);
  if ('refused' in unpacked) return unpacked.refused;
  const { root, meta } = unpacked;
  const kind = flavorKind(meta)!;
  const { books, stories } = contents(root);
  const facts: ImportBundle['facts'] = { language: meta.languages?.[0]?.tag ?? '', name: Object.values(meta.identification?.name ?? {})[0] as string ?? '' };
  const bundle: ImportBundle = { kind, facts, books, ...(kind === 'obs' ? { stories } : {}), archive: files[0].bytes, findings: [] };
  addCarried(root, bundle);
  return bundle;
}

export const BURRITO_PARSER: ImportParser = {
  id: 'burrito',
  accepts: (files) => files.length === 1 && files[0].name.toLowerCase().endsWith('.zip'),
  parse,
};
