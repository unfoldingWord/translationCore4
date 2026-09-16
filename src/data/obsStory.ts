import type { ServerApi } from './serverApi';
import type { BurritoStore, ResourcesFile, ResourcePin, Story } from './burritoStore';
import { installedPathFor, type InstalledMap } from './installed';
import { resolveObsSetSlot } from './resolve';
import {
  DEFAULT_OBS_IMAGES,
  DEFAULT_OBS_IMAGES_LOCAL,
  obsImagePackFromMetadata,
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
  sourceError: string | null;
  /** True only when the pinned gateway story is absent from this machine.
   * Other source failures (a missing ingredient, malformed bytes, or a
   * transport error) must remain distinct: those need a retry/error message,
   * not a misleading download prompt. */
  sourceMissing: boolean;
  images: Record<string, ObsImageResolution>;
}

const safeMetadata = async (api: ServerApi, repoPath: string) => {
  try { return await api.getMetadataRaw(repoPath); } catch { return { ingredients: {} }; }
};

const imagePack = async (
  api: ServerApi,
  installed: InstalledMap,
  pin: ResourcePin,
): Promise<ObsImagePack | null> => {
  const local = installedPathFor(installed, pin);
  if (!local) return null;
  const metadata = await safeMetadata(api, local);
  return obsImagePackFromMetadata(pin, metadata, (ipath) => api.ingredientBytesUrl(local, ipath));
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
  let sourceError: string | null = null;
  let sourceMissing = false;
  const sourcePin = resources ? resolveObsSetSlot(resources, 'obs').pin : null;
  if (sourcePin) {
    const sourceRepo = sourceRepoFor(installed, sourcePin);
    if (sourceRepo) {
      try {
        sourceStory = parseStory(await api.readIngredient(sourceRepo, storyIpath(storyNumber)));
        sourceError = obsFrameSetMismatch([target.story], [sourceStory]);
      } catch (error: unknown) {
        sourceError = String((error as Error)?.message || error);
      }
    } else {
      sourceMissing = true;
      sourceError = `OBS source ${sourcePin.repoPath}@${sourcePin.sha} is not installed`;
    }
  } else {
    sourceError = 'No pinned OBS gateway story is available';
  }

  const pins = (['primary', 'fallback'] as const)
    .map((rung) => resources?.languageSets?.[rung]?.['obs-images'])
    .filter((pin): pin is ResourcePin => !!pin);
  const packs: ObsImagePack[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    const key = `${pin.repoPath}|${pin.sha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pack = await imagePack(api, installed, pin);
    if (pack) packs.push(pack);
  }
  const defaultLocal = installedPathFor(installed, DEFAULT_OBS_IMAGES) ?? DEFAULT_OBS_IMAGES_LOCAL;
  const defaultMetadata = await safeMetadata(api, defaultLocal);
  const bundled = obsImagePackFromMetadata(
    DEFAULT_OBS_IMAGES,
    defaultMetadata,
    (ipath) => api.ingredientBytesUrl(defaultLocal, ipath),
  );
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
  return { story: target.story, sourceStory, sourceError, sourceMissing, images };
};
