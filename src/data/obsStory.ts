import type { ServerApi } from './serverApi';
import type { BurritoStore, ResourcesFile, ResourcePin, Story } from './burritoStore';
import { installedPathFor, type InstalledMap } from './installed';
import { resolveObsSetSlot } from './resolve';
import {
  DEFAULT_OBS_IMAGES,
  DEFAULT_OBS_IMAGES_LOCAL,
  obsImagePackFromMetadata,
  obsImagePackFromPaths,
  resolveObsImage,
  type ObsImageAsset,
  type ObsImagePack,
  type ObsImageResolution,
} from './obsImages';
import { parseStory, storyIpath } from './journal/runtime';
import { obsFrameSetMismatch } from './obsFrameSet';

export interface ObsStoryPresentation {
  story: Story;
  sourceStory: Story | null;
  /** Why the gateway story is absent or unusable, or null when it was read
   * and matches. The screen renders each kind through the catalog.
   * `not-installed` is the only kind that earns a download prompt: a missing
   * ingredient, malformed bytes, or a transport error needs an error message,
   * not a misleading Get source. `mismatch` keeps `sourceStory` (the story was
   * read) so each frame keeps its gateway text. */
  source: ObsSourceState | null;
  images: Record<string, ObsImageResolution>;
  /** One report per picture pack consulted, bundled default last. */
  imagePacks: ObsImagePackReport[];
  /** Why no frame of this story has a picture, when the story has image lines
   * and none resolved: how many image lines wanted a picture, and the packs
   * consulted. Null whenever at least one frame resolved, or the story carries
   * no image line at all. A missing picture is never a frame-level error
   * (#289); the screen renders this once, through the i18n catalog. */
  imageNote: ObsImageNote | null;
}

export interface ObsImageNote {
  wanted: number;
  packs: ObsImagePackReport[];
}

export type ObsSourceState =
  | { kind: 'no-pin' }
  | { kind: 'not-installed'; pin: ResourcePin }
  | { kind: 'mismatch'; message: string }
  | { kind: 'error'; message: string };

export interface ObsImagePackReport {
  pin: ResourcePin;
  /** The local repository the pack was read from; null when the pin is not
   * installed on this machine (pinned packs only — the default has a fixed path). */
  localPath: string | null;
  /** Where the filename map came from: the real file listing, the metadata
   * ingredient table (listing unreadable), or nothing (both unreadable). */
  via: 'paths' | 'metadata' | null;
  /** Image files found in the pack. */
  files: number;
  error: string | null;
}

const safeMetadata = async (api: ServerApi, repoPath: string) => {
  try { return await api.getMetadataRaw(repoPath); } catch { return { ingredients: {} }; }
};

/** Read one pack's filename map. The REAL file listing is the oracle: it walks
 * the tree on disk, so an archive whose committed `metadata.json` carries no
 * ingredient table (a commit archive, not a DCS export; the default pack is
 * fetched that way) still yields its pictures. The table is the fallback when
 * the listing cannot be read. Never throws: a pack that cannot be read reports
 * why and contributes no candidate, so a frame falls through to the next rung. */
const readPack = async (
  api: ServerApi,
  pin: ResourcePin,
  local: string,
): Promise<{ pack: ObsImagePack; report: ObsImagePackReport }> => {
  const uriFor = (ipath: string) => api.ingredientBytesUrl(local, ipath);
  const count = (pack: ObsImagePack) => Object.keys(pack.images).length;
  let listingError: string | null = null;
  try {
    const pack = obsImagePackFromPaths(pin, await api.listPaths(local), uriFor);
    return { pack, report: { pin, localPath: local, via: 'paths', files: count(pack), error: null } };
  } catch (error: unknown) {
    listingError = String((error as Error)?.message || error);
  }
  try {
    const pack = obsImagePackFromMetadata(pin, await api.getMetadataRaw(local), uriFor);
    return { pack, report: { pin, localPath: local, via: 'metadata', files: count(pack), error: listingError } };
  } catch (error: unknown) {
    const metadataError = String((error as Error)?.message || error);
    return {
      pack: { pin, images: {} },
      report: { pin, localPath: local, via: null, files: 0, error: `${listingError}; ${metadataError}` },
    };
  }
};

const pinnedPack = async (
  api: ServerApi,
  installed: InstalledMap,
  pin: ResourcePin,
): Promise<{ pack: ObsImagePack | null; report: ObsImagePackReport }> => {
  const local = installedPathFor(installed, pin);
  if (!local) return { pack: null, report: { pin, localPath: null, via: null, files: 0, error: 'not installed' } };
  return readPack(api, pin, local);
};

/** The note for a story with image lines and no picture at all. */
const noteFor = (
  story: Story,
  images: Record<string, ObsImageResolution>,
  packs: ObsImagePackReport[],
): ObsImageNote | null => {
  const wanted = story.frames.filter((frame) => frame.image).length;
  if (wanted === 0) return null;
  if (Object.values(images).some((image) => image.uri)) return null;
  return { wanted, packs };
};

const projectImageIngredients = async (
  api: ServerApi,
  projectRepo: string,
): Promise<Record<string, ObsImageAsset>> => {
  const metadata = await safeMetadata(api, projectRepo);
  const out: Record<string, ObsImageAsset> = {};
  for (const [path, entry] of Object.entries(metadata.ingredients ?? {})) {
    if (entry.role !== 'x-obsimages' || !path.startsWith('ingredients/')) continue;
    const ipath = path.slice('ingredients/'.length);
    out[path] = { uri: api.ingredientBytesUrl(projectRepo, ipath), role: entry.role };
  }
  return out;
};

const sourceRepoFor = (installed: InstalledMap, pin: ResourcePin): string | null =>
  installedPathFor(installed, pin) ?? null;

/** Read one target story and its pinned gateway story, then resolve every image
 * at render time. No source or image bytes are written into the target story. */
export const readObsStoryPresentation = async ({
  api,
  store,
  projectRepo,
  storyNumber,
  resources,
  installed,
}: {
  api: ServerApi;
  store: BurritoStore;
  projectRepo: string;
  storyNumber: number;
  resources: ResourcesFile | null;
  installed: InstalledMap;
}): Promise<ObsStoryPresentation> => {
  const target = await store.readStory(storyNumber);
  let sourceStory: Story | null = null;
  let source: ObsSourceState | null = null;
  const sourcePin = resources ? resolveObsSetSlot(resources, 'obs').pin : null;
  if (sourcePin) {
    const sourceRepo = sourceRepoFor(installed, sourcePin);
    if (sourceRepo) {
      try {
        sourceStory = parseStory(await api.readIngredient(sourceRepo, storyIpath(storyNumber)));
        const mismatch = obsFrameSetMismatch([target.story], [sourceStory]);
        if (mismatch) source = { kind: 'mismatch', message: mismatch };
      } catch (error: unknown) {
        source = { kind: 'error', message: String((error as Error)?.message || error) };
      }
    } else {
      source = { kind: 'not-installed', pin: sourcePin };
    }
  } else {
    source = { kind: 'no-pin' };
  }

  const pins = (['primary', 'fallback'] as const)
    .map((rung) => resources?.languageSets?.[rung]?.['obs-images'])
    .filter((pin): pin is ResourcePin => !!pin);
  const packs: ObsImagePack[] = [];
  const reports: ObsImagePackReport[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    const key = `${pin.repoPath}|${pin.sha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { pack, report } = await pinnedPack(api, installed, pin);
    reports.push(report);
    if (pack) packs.push(pack);
  }
  const defaultLocal = installedPathFor(installed, DEFAULT_OBS_IMAGES) ?? DEFAULT_OBS_IMAGES_LOCAL;
  const { pack: bundled, report: bundledReport } = await readPack(api, DEFAULT_OBS_IMAGES, defaultLocal);
  reports.push(bundledReport);
  const projectIngredients = await projectImageIngredients(api, projectRepo);
  const images: Record<string, ObsImageResolution> = {};
  for (let i = 0; i < target.story.frames.length; i += 1) {
    images[String(i + 1)] = resolveObsImage(
      target.story.frames[i].image,
      resources ?? ({ schemaVersion: 2, languageSets: { primary: {}, fallback: {} }, resources: {} } as ResourcesFile),
      projectIngredients,
      packs,
      bundled,
    );
  }
  return {
    story: target.story,
    sourceStory,
    source,
    images,
    imagePacks: reports,
    imageNote: noteFor(target.story, images, reports),
  };
};
