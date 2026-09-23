// The import shell (issue #361, D79 point 7, D80 points 2 and 4,
// docs/ARCHITECTURE.md §8): the one layer every importer sits on. A parser
// turns the dropped files into one ImportBundle; the shell makes a NEW project
// from it through the platform's own primitive — create, upload one wrapped
// zip, remake, seed the journal, commit — and owns the all-or-nothing rollback.
import { zipSync } from 'fflate';
import { JournalingStore } from '../journal/journalingStore';
import { Refusal, failedReport, okReport, storyIpath, type Report } from '../journal/runtime';
import { unwrapExport } from '../resourceFetch';
import { ServerApi } from '../serverApi';
import type { ImportBundle, ImportFile, ImportParser } from './types';

const APP_ORG = '_local_/_local_';
const encoder = new TextEncoder();

/** The facts of an import Report: which parser, the new project, what it holds. */
export type ImportFacts = { parser: ImportParser['id']; repoPath?: string; books?: string[]; seedSource?: string; rolledBack?: boolean };

export type ImportDeps = { api?: ServerApi; store?: JournalingStore };

/** The seed source of the imported records (BURRITO-SPEC §8.8). tC3 has its
 * own; the other kinds take the universal seed's default until the
 * specification names theirs (`out-of-band-usfm` may not seed a versification
 * frame, R-8.5.19). */
const seedSourceOf = (parser: ImportParser) =>
  parser.id === 'tc3' ? ('tc3-import' as const) : ('sidecar-migration' as const);

/** The code the create route takes: `new-text-translation` accepts only a bare
 * language code, so `es-419` is sent as `es`; remake then writes the bundle's
 * own metadata.json with the full tag (D80 point 4, PLATFORM-NOTES #43). A
 * private-use `x-` tag is sent whole. */
export const primarySubtag = (tag: string): string => (tag.startsWith('x-') ? tag : tag.split('-')[0].toLowerCase());

/** The new repository's folder name: the New Bible wizard's rule. */
export const importAbbr = (name: string, language: string): string => {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug(name) || slug(language);
};

/** The finding that refuses a bundle on the review page, or undefined. */
export const damagedFinding = (bundle: ImportBundle) => bundle.findings.find((f) => f.kind === 'damaged');

/** The bundle's facts with the review page's edits laid over them. */
export const editedFacts = (bundle: ImportBundle, edits: Partial<ImportBundle['facts']>): ImportBundle['facts'] => {
  const out = { ...bundle.facts };
  for (const [key, value] of Object.entries(edits)) if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  return out;
};

/** One zip with every path under a single top-level folder: the shape remake needs. */
const wrap = (folder: string, files: Record<string, Uint8Array>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([rel, bytes]) => [`${folder}/${rel}`, bytes])));

/** A Scripture Burrito as it is (D80 point 2): every file's bytes unchanged,
 * under one top-level folder. */
const archiveZip = (archive: Uint8Array, folder: string): Uint8Array => wrap(folder, unwrapExport(archive).files);

/** The new project's own files (the created repository's metadata.json and
 * ingredients, for example vrs.json) with the bundle's books or stories over
 * them. The metadata gets the bundle's full language tag back (D80 point 4). */
async function bundleZip(api: ServerApi, repoPath: string, bundle: ImportBundle, language: string, folder: string): Promise<Uint8Array> {
  const meta = await api.getMetadataRaw(repoPath);
  const languages = meta.languages as Array<{ tag: string }> | undefined;
  if (languages?.[0]) languages[0].tag = language;
  const files: Record<string, Uint8Array> = { 'metadata.json': encoder.encode(JSON.stringify(meta, null, 2)) };
  for (const ipath of await api.listPaths(repoPath)) files[`ingredients/${ipath}`] = encoder.encode(await api.readIngredient(repoPath, ipath));
  for (const book of bundle.books) files[`ingredients/${book.code}.usfm`] = encoder.encode(book.usfm);
  for (const story of bundle.stories ?? []) files[`ingredients/${storyIpath(story.n)}`] = encoder.encode(story.markdown);
  return wrap(folder, files);
}

/** Parse, then make one new project from the bundle: create the repository
 * (primary language subtag) → upload one wrapped zip → remake → seed the
 * journal (not for an archive) → commit. A failure after the repository exists deletes it and
 * returns `import.write-failed`; a failure before it creates nothing. */
export async function runImport(
  parser: ImportParser,
  files: ImportFile[],
  edits: Partial<ImportBundle['facts']>,
  deps: ImportDeps = {},
): Promise<Report> {
  const startedAt = new Date().toISOString();
  const api = deps.api ?? new ServerApi();
  const store = deps.store ?? new JournalingStore({ api });
  const facts: ImportFacts = { parser: parser.id };
  let created = false;
  const fail = (error: unknown): Report => {
    const refusal = created
      ? new Refusal('import.write-failed', `${String((error as Error)?.message ?? error)}; the partly written project was removed`)
      : error;
    return failedReport('import', startedAt, new Date().toISOString(), refusal, facts);
  };
  try {
    const bundle = await parser.parse(files);
    const damaged = damagedFinding(bundle);
    if (damaged) throw damaged.code ? new Refusal(damaged.code, damaged.text) : new Error(damaged.text);
    if (!bundle.archive && (bundle.alignments || bundle.decisions?.length || bundle.pins?.length))
      throw new Error('the shell writes books and stories only; alignments, decisions and pins arrive with the tC3 import (#21)');
    const { name, language } = editedFacts(bundle, edits);
    const abbr = importAbbr(name, language);
    if (!abbr) throw new Error('the project needs a name');
    const repoPath = `${APP_ORG}/${abbr}`;
    facts.repoPath = repoPath;
    // Never create over an existing path (PLATFORM-NOTES #28): the create route
    // git-inits before it validates, so the rollback below may delete only a
    // path this listing proved absent.
    if ((await api.listLocalRepos()).includes(repoPath))
      throw new Refusal('import.name-exists', `a project folder named "${abbr}" already exists`, { repoPath });
    const code = primarySubtag(language);
    try {
      if (bundle.kind === 'obs') await api.newObsResource({ content_name: name, content_abbr: abbr, content_language_code: code });
      else
        await api.newTextTranslation({
          content_name: name,
          content_abbr: abbr,
          content_language_code: code,
          content_language_name: code.startsWith('x-') ? name : null,
          add_book: false,
          versification: 'eng',
        });
    } catch (error) {
      // The routes refuse an existing folder BEFORE their git init: another
      // creator made it after the listing, so it is not ours to delete.
      if (/already exists/.test((error as { reason?: string }).reason ?? ''))
        throw new Refusal('import.name-exists', `a project folder named "${abbr}" already exists`, { repoPath });
      created = true; // any other refusal may leave git-init debris (PLATFORM-NOTES #28)
      throw error;
    }
    created = true;
    const zip = bundle.archive ? archiveZip(bundle.archive, abbr) : await bundleZip(api, repoPath, bundle, language, abbr);
    await api.remakeBurritoFromZip(await api.uploadTempBytes(zip), repoPath);
    // Register the new books and their scope. Never for an archive (its
    // metadata.json stays byte for byte) or an OBS project (a rescan empties
    // the template's scope table, PLATFORM-NOTES #37).
    if (!bundle.archive && bundle.kind === 'bible') await api.remakeIngredients(repoPath);
    const message = `Import ${name} (tC4)`;
    if (bundle.archive) {
      // Stored as exported (D80 point 2), so neither opened nor checkpointed:
      // both rescan the ingredients, and a rescan rewrites metadata.json (W-2).
      // The first open seeds what its journal does not hold, with the same source.
      facts.books = (await api.getSummary(repoPath)).book_codes;
      await api.addAndCommit(repoPath, message);
    } else {
      const seedSource = seedSourceOf(parser);
      facts.seedSource = seedSource;
      facts.books = (await store.openImported(repoPath, seedSource)).bookCodes;
      await store.commit(message);
    }
    return okReport('import', startedAt, new Date().toISOString(), facts);
  } catch (error) {
    if (created && facts.repoPath) {
      await api.deleteRepo(facts.repoPath).catch(() => {});
      facts.rolledBack = true;
    }
    return fail(error);
  } finally {
    if (!deps.store) store.dispose();
  }
}

