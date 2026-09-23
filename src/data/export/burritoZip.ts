// The Scripture Burrito zip export (issue #359, J7 and J23, docs/ARCHITECTURE.md
// §7): the whole project as one zip that any Scripture Burrito tool can open.
// The server zips the repository directory with no filter (`GET
// /burrito/zipped`, BurritoStore.readZipped); this producer removes `.git/`,
// every `*.bak` and every `.DS_Store`, and keeps every other entry byte for
// byte. Only `metadata.json` changes: it gains the `relationships` mirror of
// `checking/resources.json` (BURRITO-SPEC §3 rule 6) and the `dcs` id
// authority that rule 2 requires beside it. An OBS project's `ingredients`
// table is also rebuilt from the zipped files: the platform creates it with
// keys that lack the `ingredients/` prefix, and tC4 never rescans an OBS
// project (PLATFORM-NOTES #37), so the stored table names no real path, lists
// no sidecar and carries stale md5s. A Bible project's stored table is the
// server's own rescan and stays. The stored project never changes (no HTTP
// route writes `metadata.json`; stage rule S-1 keeps `resources.json`
// authoritative).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { t } from '../../i18n';
import type { ResourcesFile } from '../burritoStore';
import { exportFilename, type ExportProducer } from './kernel';
import { relationshipsFromPins } from './relationships';
import { md5Bytes } from '../../../journal/md5.mjs';

const RESOURCES = 'ingredients/checking/resources.json';
const DCS_AUTHORITY = { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } };

type Metadata = Record<string, unknown> & {
  idAuthorities?: Record<string, unknown>;
  type?: { flavorType?: { flavor?: { name?: string } } };
};

/** The §3 rule 5 table of every file under `ingredients/`, as conformance/generate-obs.mjs builds it. */
const ingredientsTable = (files: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.keys(files)
      .filter((name) => name.startsWith('ingredients/') && !name.endsWith('/'))
      .sort()
      .map((name) => [
        name,
        { checksum: { md5: md5Bytes(files[name]) as string }, mimeType: name.endsWith('.md') ? 'text/markdown' : 'application/json', size: files[name].byteLength },
      ]),
  );

/** True for a zip entry that stays out of the export. */
const excluded = (name: string): boolean => {
  const segments = name.replace(/\/$/, '').split('/');
  return segments[0] === '.git' || segments.at(-1) === '.DS_Store' || name.endsWith('.bak');
};

/** The exported `metadata.json`: the `relationships` mirror of the pins and,
 * for an OBS project, the rebuilt `ingredients` table. Byte-identical when
 * neither applies. */
const exportedMetadata = (files: Record<string, Uint8Array>): Uint8Array => {
  const meta = JSON.parse(strFromU8(files['metadata.json'])) as Metadata;
  const relationships = files[RESOURCES] ? relationshipsFromPins(JSON.parse(strFromU8(files[RESOURCES])) as ResourcesFile) : [];
  const obs = meta.type?.flavorType?.flavor?.name === 'textStories';
  if (relationships.length === 0 && !obs) return files['metadata.json'];
  const out: Metadata = { ...meta };
  if (obs) out.ingredients = ingredientsTable(files);
  if (relationships.length > 0) Object.assign(out, { idAuthorities: { ...meta.idAuthorities, dcs: DCS_AUTHORITY }, relationships });
  return strToU8(`${JSON.stringify(out, null, 2)}\n`);
};

/** The server's zip of the repository → the Scripture Burrito zip. */
export function burritoFromRepoZip(repoZip: Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(unzipSync(repoZip))) if (!excluded(name)) files[name] = bytes;
  if (files['metadata.json']) files['metadata.json'] = exportedMetadata(files);
  return zipSync(files);
}

export const BURRITO_ZIP: ExportProducer = {
  id: 'burrito-zip',
  label: t('cc.exportBurritoZip'),
  appliesTo: () => true, // Bible and OBS projects
  produce: async ({ store, project }) => ({
    bytes: burritoFromRepoZip(await store.readZipped()),
    filename: exportFilename(project.name, 'zip'),
    mime: 'application/zip',
  }),
};
