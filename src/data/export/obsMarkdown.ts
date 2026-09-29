// The story Markdown export (issue #360, J23, docs/ARCHITECTURE.md §7): the
// fifty story files of an OBS project as one zip, `content/` exactly as the
// project stores it. The server zips the repository directory (`GET
// /burrito/zipped`, BurritoStore.readZipped); this producer keeps the entries
// under `ingredients/content/`, byte for byte, as `content/…`, and drops every
// `*.bak` and every `.DS_Store` as the Scripture Burrito zip does. The stored
// project never changes.
import { zipSync } from 'fflate';
import { t } from '../../i18n';
import { excluded } from './burritoZip';
import { exportFilename, type ExportProducer } from './kernel';
import { unzipServerZip } from '../serverZip';

const CONTENT = 'ingredients/content/';

/** The server's zip of the repository → the zip of `content/`. */
export function storyMarkdownFromRepoZip(repoZip: Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(unzipServerZip(repoZip))) {
    if (!name.startsWith(CONTENT) || name.endsWith('/') || excluded(name)) continue;
    files[name.slice('ingredients/'.length)] = bytes;
  }
  return zipSync(files);
}

export const OBS_MARKDOWN: ExportProducer = {
  id: 'obs-markdown',
  label: t('cc.exportStoryMarkdown'),
  appliesTo: (project) => project.flavor === 'textStories',
  produce: async ({ store, project }) => ({
    bytes: storyMarkdownFromRepoZip(await store.readZipped()),
    filename: exportFilename(`${project.name}-stories`, 'zip'),
    mime: 'application/zip',
  }),
};
