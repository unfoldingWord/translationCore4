// OBS image selection (#288, D75). Selection is pure and read-only: the
// Markdown image line remains byte-identical and callers render the selected
// local asset without rewriting the story.
import type { ResourcePin, ResourcesFile, Rung } from './burritoStore';

export const DEFAULT_OBS_IMAGES: ResourcePin = {
  repoPath: 'git.door43.org/uW/obs_images_360',
  sha: '7146d5b504f6b63b9e11f7dc0b18c594d0ae179d',
  flavor: 'peripheral/x-obsimages',
};

export interface ObsImageAsset {
  /** Path or URL which the renderer can read. */
  uri: string;
  /** Burrito ingredient role. Required for project-ingredient precedence. */
  role?: string;
}

export interface ObsImagePack {
  pin: ResourcePin;
  /** Assets keyed by the basename used by the story's Markdown image URL. */
  images: Record<string, ObsImageAsset | string>;
}

export type ObsImageResolution =
  | { source: 'project'; uri: string; fileName: string; pin: null; rung: null }
  | { source: 'pin'; uri: string; fileName: string; pin: ResourcePin; rung: Rung }
  | { source: 'default'; uri: string; fileName: string; pin: ResourcePin; rung: null }
  | { source: 'missing'; uri: null; fileName: string | null; pin: null; rung: null };

/** Extract the asset basename from an OBS Markdown image line. */
export const obsImageFileName = (imageLine: string): string | null => {
  const match = imageLine.match(/^!\[[^\]]*\]\(([^\s)]+)(?:\s+['"][^'"]*['"])?\)\s*$/);
  if (!match) return null;
  try {
    const path = new URL(match[1], 'https://local.invalid/').pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || null;
  } catch {
    return null;
  }
};

const assetUri = (asset: ObsImageAsset | string | undefined): string | null =>
  typeof asset === 'string' ? asset : asset?.uri ?? null;

/** Resolve at render time: project ingredient → primary pin → fallback pin →
 * bundled default. Missing or incomplete candidates fall through. */
export const resolveObsImage = (
  imageLine: string,
  resources: ResourcesFile,
  projectIngredients: Record<string, ObsImageAsset>,
  packs: ObsImagePack[],
  defaultPack: ObsImagePack,
): ObsImageResolution => {
  const fileName = obsImageFileName(imageLine);
  if (!fileName) return { source: 'missing', uri: null, fileName: null, pin: null, rung: null };

  for (const asset of Object.values(projectIngredients)) {
    if (asset.role === 'x-obsimages' && assetUri(asset) && asset.uri.split(/[\\/]/).pop() === fileName)
      return { source: 'project', uri: asset.uri, fileName, pin: null, rung: null };
  }

  for (const rung of ['primary', 'fallback'] as const) {
    const pin = resources.languageSets?.[rung]?.['obs-images'];
    if (!pin) continue;
    const pack = packs.find((candidate) =>
      candidate.pin.sha === pin.sha && candidate.pin.repoPath.toLowerCase() === pin.repoPath.toLowerCase());
    const uri = assetUri(pack?.images[fileName]);
    if (uri) return { source: 'pin', uri, fileName, pin, rung };
  }

  const uri = assetUri(defaultPack.images[fileName]);
  return uri
    ? { source: 'default', uri, fileName, pin: defaultPack.pin, rung: null }
    : { source: 'missing', uri: null, fileName, pin: null, rung: null };
};
