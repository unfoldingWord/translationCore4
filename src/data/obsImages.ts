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
  /** A loader can mark bytes it could not decode. Such a candidate falls
   * through without changing the stored pin. */
  decodable?: boolean;
}

export interface ObsImagePack {
  pin: ResourcePin;
  /** Assets keyed by the basename used by the story's Markdown image URL. */
  /** Metadata-derived candidates keyed by the source image basename. More
   * than one candidate is ambiguous and therefore unusable. */
  images: Record<string, ObsImageAsset | string | Array<ObsImageAsset | string>>;
}

/** Build the filename map from a list of ingredient-relative file paths — the
 * shape `GET /burrito/paths/<repo>` returns, which walks the REAL tree (files a
 * sideloaded archive carries without an indexed ingredient entry still appear).
 * Sorted, so the map never depends on listing order. */
export const obsImagePackFromPaths = (
  pin: ResourcePin,
  paths: readonly string[],
  uriFor: (ipath: string) => string,
): ObsImagePack => {
  const grouped: Record<string, ObsImageAsset[]> = {};
  for (const ipath of [...paths].sort()) {
    const name = ipath.slice(ipath.lastIndexOf('/') + 1);
    if (!/\.(?:jpe?g|png|webp)$/i.test(name)) continue;
    (grouped[name] ??= []).push({ uri: uriFor(ipath), role: 'x-obsimages' });
  }
  return { pin, images: grouped };
};

/** Build the filename map from the pack's Scripture Burrito ingredient table.
 * The table is only as complete as the last rescan that wrote it; a pack whose
 * `metadata.json` lists no image files yields an empty map here, so callers
 * prefer the real file listing (obsImagePackFromPaths) and use this as the
 * fallback when that listing cannot be read. */
export const obsImagePackFromMetadata = (
  pin: ResourcePin,
  metadata: { ingredients?: Record<string, { mimeType?: string }> },
  uriFor: (ipath: string) => string,
): ObsImagePack => {
  const paths = Object.keys(metadata.ingredients ?? {})
    .filter((path) => path.startsWith('ingredients/'))
    .map((path) => path.slice('ingredients/'.length));
  return obsImagePackFromPaths(pin, paths, uriFor);
};

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

const assetUri = (asset: ObsImageAsset | string | undefined): string | null => {
  if (!asset || (typeof asset !== 'string' && asset.decodable === false)) return null;
  return typeof asset === 'string' ? asset : asset.uri;
};

/** The bundled default uses an identity-qualified store path. A pre-existing
 * copy of the same repository at another revision therefore cannot be read as
 * this pin or be replaced during first-run seeding. */
export const DEFAULT_OBS_IMAGES_LOCAL =
  `_local_/_sideloaded_/uw--obs_images_360--${DEFAULT_OBS_IMAGES.sha.slice(0, 12)}`;

const oneCandidate = (
  asset: ObsImageAsset | string | Array<ObsImageAsset | string> | undefined,
): string | null => {
  const candidates = Array.isArray(asset) ? asset : asset === undefined ? [] : [asset];
  if (candidates.length !== 1) return null;
  return assetUri(candidates[0]);
};

const basename = (uri: string): string | null => {
  try {
    const url = new URL(uri, 'https://local.invalid/');
    // Binary ingredient URLs carry the real filename in `ipath`, while the
    // route pathname ends at the repository identity. Prefer that query path
    // when present so project ingredients participate in the same basename
    // precedence as local/file URLs. URLSearchParams has already decoded it
    // once; a second decode would throw on a filename with a literal `%`.
    const ingredientPath = url.searchParams.get('ipath');
    if (ingredientPath) return ingredientPath.slice(ingredientPath.lastIndexOf('/') + 1) || null;
    const path = url.pathname === '/' || url.pathname === '' ? url.hostname : url.pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || null;
  } catch {
    return null;
  }
};

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

  const projectMatches = Object.values(projectIngredients)
    .filter((asset) => asset.role === 'x-obsimages' && basename(asset.uri) === fileName);
  const projectUri = projectMatches.length === 1 ? assetUri(projectMatches[0]) : null;
  if (projectUri) return { source: 'project', uri: projectUri, fileName, pin: null, rung: null };

  for (const rung of ['primary', 'fallback'] as const) {
    const pin = resources.languageSets?.[rung]?.['obs-images'];
    if (!pin) continue;
    const pack = packs.find((candidate) =>
      candidate.pin.sha === pin.sha && candidate.pin.repoPath.toLowerCase() === pin.repoPath.toLowerCase());
    const uri = oneCandidate(pack?.images[fileName]);
    if (uri) return { source: 'pin', uri, fileName, pin, rung };
  }

  const uri = oneCandidate(defaultPack.images[fileName]);
  return uri
    ? { source: 'default', uri, fileName, pin: defaultPack.pin, rung: null }
    : { source: 'missing', uri: null, fileName, pin: null, rung: null };
};
