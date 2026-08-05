// resourceFetch.ts — fetch a pinned resource and install it locally (C2.1).
//
// The pin path is the DCS sb-zip export [decided 2026-07-25 — D23(b),
// OPEN-QUESTIONS #24]: a pin is (repoPath, release tag, expected commit SHA),
// the import fetches `/sb/<tag>.zip`, and the SHA is verified from the export's
// OWN metadata before anything is installed. Never a default branch; never an
// RC tag with a local conversion.
//
// Three verified platform facts shape this module (PLATFORM-NOTES #26, re-checked
// 2026-08-03):
//   1. `POST /burrito/zipped/<repo_path>` is the general import. The target
//      MUST start with `_local_/_sideloaded_/` and MUST NOT already exist.
//   2. That endpoint requires the UNWRAPPED shape (metadata.json at the zip
//      root), but the DCS export is WRAPPED in one `<repo>/` directory — so the
//      wrapper is stripped here, in the client, before upload.
//   3. Rocket's default multipart limits reject real sb-zips; the deployment
//      must raise them (the rig's run.zsh sets ROCKET_LIMITS).
import { unzipSync, zipSync } from 'fflate';
import type { ResourcePin } from './burritoStore';
import { ServerApi } from './serverApi';

/** DCS serves the export cross-origin: a direct browser GET returns
 * `response.type === 'cors'` with a readable body [VERIFIED live 2026-08-03,
 * en_twl v86 = 1,841,386 bytes]. The platform has no fetch-this-URL endpoint,
 * so the client does the GET — but ONLY when the platform reports net enabled,
 * so the user's offline switch still governs (D30.4/D30.5). */
export const sbZipUrl = (pin: ResourcePin): string => {
  const path = pin.repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  if (slash < 0) throw new Error(`pin repoPath is not <host>/<owner>/<repo>: ${pin.repoPath}`);
  return `https://${path.slice(0, slash)}/${path.slice(slash + 1)}/sb/${pin.version}.zip`;
};

/** The local repo a pin installs into: `_local_/_sideloaded_/<repo name>`. */
export const localRepoPathFor = (pin: ResourcePin): string =>
  `_local_/_sideloaded_/${pin.repoPath.split('/').pop()}`;

/** The platform's catalog reports `branch_or_tag: "master"`, never a release
 * tag, so the tag comes from DCS itself. Reachable cross-origin the same way
 * the export is [VERIFIED live 2026-08-03: `type: 'cors'`, en_tn → v89].
 * A resource with no release cannot be pinned (D23b bans untagged refs). */
export const latestReleaseTag = async (
  repoPath: string,
  fetchFn: typeof fetch = ((...a: Parameters<typeof fetch>) => fetch(...a)),
): Promise<string> => {
  const path = repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  const url = `https://${path.slice(0, slash)}/api/v1/repos/${path.slice(slash + 1)}/releases/latest`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`${repoPath} has no published release, so it cannot be pinned`);
  }
  const body = (await response.json()) as { tag_name?: string };
  if (!body.tag_name) throw new Error(`${repoPath} has no release tag, so it cannot be pinned`);
  return body.tag_name;
};

const decoder = new TextDecoder();

export interface UnwrappedBurrito {
  files: Record<string, Uint8Array>;
  /** The commit SHA the export records for the tag it was generated from. */
  revision: string | null;
}

/** Strip the DCS export's single top-level directory and read the revision the
 * export records. Throws when the archive is not a burrito (no root
 * metadata.json / no ingredients), which is also what the platform would
 * reject — better to fail here with a clear message. */
export const unwrapExport = (zipBytes: Uint8Array): UnwrappedBurrito => {
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
  if (names.length === 0) throw new Error('the downloaded archive is empty');

  // Every path should share one top directory; strip exactly that.
  const tops = new Set(names.map((n) => n.split('/')[0]));
  const wrapped = tops.size === 1 && !names.includes('metadata.json');
  const prefix = wrapped ? `${[...tops][0]}/` : '';

  const files: Record<string, Uint8Array> = {};
  for (const name of names) {
    const rel = wrapped ? name.slice(prefix.length) : name;
    // The export ships .git and .DS_Store; neither belongs in an install.
    if (rel === '' || rel.startsWith('.git/') || rel.endsWith('.DS_Store')) continue;
    files[rel] = entries[name];
  }

  if (!files['metadata.json']) {
    throw new Error('the downloaded archive has no root metadata.json — not a burrito');
  }
  if (!Object.keys(files).some((n) => n.startsWith('ingredients/'))) {
    throw new Error('the downloaded archive has no ingredients/ — not a burrito');
  }

  let revision: string | null = null;
  try {
    const meta = JSON.parse(decoder.decode(files['metadata.json'])) as {
      identification?: { primary?: { dcs?: Record<string, { revision?: string }> } };
    };
    const dcs = meta.identification?.primary?.dcs ?? {};
    revision = Object.values(dcs)[0]?.revision ?? null;
  } catch {
    throw new Error('the downloaded archive has an unreadable metadata.json');
  }
  return { files, revision };
};

/** Re-zip the unwrapped tree for `POST /burrito/zipped`.
 *
 * The importer's `check_burrito_zip` requires TWO things [VERIFIED — source
 * read of `endpoints/burrito2/post_zipped_repo.rs` at 0.18.5, after a live 400
 * "Zip does not look like a burrito"]: a FILE entry named exactly
 * `metadata.json`, and a **DIRECTORY** entry named `ingredients/` or
 * `ingredients`. A zip that contains `ingredients/TIT.tsv` but no explicit
 * directory entry FAILS the check — file paths alone are not enough, so the
 * directory entries are written explicitly here. */
export const rezip = (files: Record<string, Uint8Array>): Uint8Array => {
  const withDirs: Record<string, Uint8Array> = {};
  const dirs = new Set<string>();
  for (const name of Object.keys(files)) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  for (const dir of [...dirs].sort()) withDirs[dir] = new Uint8Array(0);
  for (const [name, bytes] of Object.entries(files)) withDirs[name] = bytes;
  return zipSync(withDirs, { level: 0 });
};

/** Identify a resource that is ALREADY on disk but carries no install record —
 * the rig's seeded sources, or anything installed before the record existed.
 *
 * Identification is by evidence, never by assumption: read the revision the
 * installed burrito's own metadata declares, then ask DCS which release tag
 * points at that commit. A revision that matches no tag stays unidentified, so
 * the resource simply contributes no coverage rather than being pinned to a
 * version nobody verified. */
export const identifyExistingInstall = async (
  repoPath: string,
  localRevision: string,
  fetchFn: typeof fetch = ((...a: Parameters<typeof fetch>) => fetch(...a)),
): Promise<ResourcePin | null> => {
  if (!localRevision) return null;
  const path = repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  const url = `https://${path.slice(0, slash)}/api/v1/repos/${path.slice(slash + 1)}/tags?limit=100`;
  const response = await fetchFn(url).catch(() => null);
  if (!response?.ok) return null;
  const tags = (await response.json()) as Array<{ name?: string; commit?: { sha?: string } }>;
  const hit = tags.find((tag) => tag.commit?.sha === localRevision);
  return hit?.name
    ? { repoPath, version: hit.name, sha: localRevision, flavor: '' }
    : null;
};

export type FetchStage = 'download' | 'verify' | 'install';

export interface FetchOptions {
  api: ServerApi;
  /** Injected for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  onStage?: (stage: FetchStage) => void;
}

export interface FetchResult {
  repoPath: string;
  /** The SHA the export declared (equal to `pin.sha` when the pin carried one). */
  revision: string | null;
  bytes: number;
}

/** Fetch one pinned resource and install it. Refuses rather than guessing:
 * a pin whose declared SHA does not match the export's own metadata is never
 * installed (D23b — "verify the SHA at each import"). */
export const fetchAndInstallPin = async (
  pin: ResourcePin,
  opts: FetchOptions,
): Promise<FetchResult> => {
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  // The user's offline switch governs, even though the GET is client-side.
  if (!(await opts.api.getNetEnabled())) {
    throw new Error('the app is offline — go online to download resources');
  }

  opts.onStage?.('download');
  const url = sbZipUrl(pin);
  const response = await doFetch(url);
  if (!response.ok) {
    throw new Error(`could not download ${url} (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  opts.onStage?.('verify');
  const { files, revision } = unwrapExport(bytes);
  if (pin.sha && revision && pin.sha !== revision) {
    throw new Error(
      `pin SHA mismatch for ${pin.repoPath} ${pin.version}: pinned ${pin.sha.slice(0, 12)}…, ` +
        `the export declares ${revision.slice(0, 12)}… — not installed`,
    );
  }
  if (pin.sha && !revision) {
    throw new Error(
      `the export for ${pin.repoPath} ${pin.version} declares no revision, so the pinned ` +
        'SHA cannot be verified — not installed',
    );
  }

  opts.onStage?.('install');
  const repoPath = localRepoPathFor(pin);
  await opts.api.postZippedBurrito(repoPath, rezip(files));
  return { repoPath, revision, bytes: bytes.length };
};
