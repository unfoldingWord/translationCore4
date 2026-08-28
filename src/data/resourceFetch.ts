// resourceFetch.ts — fetch a pinned resource and install it locally (C2.1).
//
// The pin path is the DCS sb-zip export [decided 2026-07-25 — D23(b),
// OPEN-QUESTIONS #24]: a pin is (repoPath, release tag, expected commit SHA),
// the import fetches `/sb/<tag>.zip`, and the export's declared revision is
// verified against the EXPECTED SHA before anything is installed. The expected
// SHA comes from an independent source — the pin on a re-install, or DCS's own
// tag→commit record on a first install — never from the archive being checked
// (that would let the archive self-certify). Never a default branch; never an
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
import { localRepoPathFromRepoPath } from './installed';
import { ServerApi } from './serverApi';

/** DCS serves the export cross-origin: a direct browser GET returns
 * `response.type === 'cors'` with a readable body [VERIFIED live 2026-08-03,
 * en_twl v86 = 1,841,386 bytes]. The platform has no fetch-this-URL endpoint,
 * so the client does the GET — but ONLY when the platform reports net enabled,
 * so the user's offline switch still governs (D30.4/D30.5). */
export const sbZipUrl = (pin: FetchPin & { version: string }): string => {
  const path = pin.repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  if (slash < 0) throw new Error(`pin repoPath is not <host>/<owner>/<repo>: ${pin.repoPath}`);
  return `https://${path.slice(0, slash)}/${path.slice(slash + 1)}/sb/${pin.version}.zip`;
};

/** The local repo a pin installs into. Delegates to the ONE canonical identity
 * (owner-qualified — B9), so fetch, discovery and the resolver never disagree
 * about where a repo lives. */
export const localRepoPathFor = (pin: Pick<FetchPin, 'repoPath'>): string =>
  localRepoPathFromRepoPath(pin.repoPath);

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

  return { files, revision: declaredRevision(files['metadata.json']) };
};

/** The commit SHA the export's own metadata declares, or null when it names
 * none. Throws on unparseable metadata — the archive is not installable. */
const declaredRevision = (metadataJson: Uint8Array): string | null => {
  try {
    const meta = JSON.parse(decoder.decode(metadataJson)) as {
      identification?: { primary?: { dcs?: Record<string, { revision?: string }> } };
    };
    const dcs = meta.identification?.primary?.dcs ?? {};
    return Object.values(dcs)[0]?.revision ?? null;
  } catch {
    throw new Error('the downloaded archive has an unreadable metadata.json');
  }
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

/** One DCS tag entry as the tags API lists it. */
interface DcsTag {
  name?: string;
  commit?: { sha?: string };
}

/** Walk the DCS tags listing PAGE BY PAGE until `match` finds an entry, the
 * listing ends, or a sanity bound is reached. The Gitea tags API paginates and
 * clamps `limit` to a server-configured page size (greptile review of PR #88:
 * a single `?limit=100` request misses any tag beyond the first page — the uW
 * helps repos carry ~90+ release tags, so a sha-only pin whose release was not
 * recent was falsely "untagged" and refused). The stop rule is clamp-robust:
 * the first non-empty page's length is taken as the server's EFFECTIVE page
 * size, and the walk continues only while pages come back full at that size —
 * an empty or short page is the end, whatever `limit` the server honored.
 * Returns null on any transport failure (callers already treat null as
 * "unidentified", never as evidence of absence). */
const TAG_PAGE_LIMIT = 50;
const TAG_PAGE_BOUND = 40; // sanity bound: 40 pages ~ 2000 tags, far beyond any real repo
const findDcsTag = async (
  repoPath: string,
  match: (tag: DcsTag) => boolean,
  fetchFn: typeof fetch,
): Promise<DcsTag | null> => {
  const path = repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  const base = `https://${path.slice(0, slash)}/api/v1/repos/${path.slice(slash + 1)}/tags`;
  let effectivePageSize: number | null = null;
  for (let page = 1; page <= TAG_PAGE_BOUND; page += 1) {
    // Catch-to-absence sweep (D30): null means DCS CONFIRMS no tag matches.
    // A transport failure or server error must PROPAGATE — swallowing it made
    // an identification read as "no tag exists", and the caller then claimed
    // an install both succeeded and contributes nothing.
    const response = await fetchFn(`${base}?limit=${TAG_PAGE_LIMIT}&page=${page}`);
    if (!response.ok) {
      if (response.status === 404) return null; // the repo/listing does not exist — conclusive
      throw new Error(`tags listing for ${repoPath} failed (HTTP ${response.status})`);
    }
    const tags = (await response.json()) as DcsTag[];
    if (!Array.isArray(tags) || tags.length === 0) return null; // the listing ended
    const hit = tags.find(match);
    if (hit) return hit;
    effectivePageSize ??= tags.length;
    if (tags.length < effectivePageSize) return null; // a short page is the last page
  }
  return null; // bound reached — refuse to walk forever; the caller reports "unidentified"
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
  const hit = await findDcsTag(repoPath, (tag) => tag.commit?.sha === localRevision, fetchFn);
  return hit?.name
    ? { repoPath, version: hit.name, sha: localRevision, flavor: '' }
    : null;
};

/** The git commit SHA that DCS records for a release tag. This is the
 * INDEPENDENT oracle a FIRST install verifies the export against (D23b): on a
 * first install the caller holds no prior pin, so the expected SHA cannot come
 * from the archive itself — otherwise the archive certifies its own revision.
 * Read from the same tags API `identifyExistingInstall` uses [VERIFIED shape,
 * 2026-08-03]. Returns null when DCS is unreachable or NO page of the tags
 * listing carries the tag (the lookup paginates — findDcsTag). */
export const releaseCommitSha = async (
  repoPath: string,
  tag: string,
  fetchFn: typeof fetch = ((...a: Parameters<typeof fetch>) => fetch(...a)),
): Promise<string | null> => {
  return (await findDcsTag(repoPath, (t) => t.name === tag, fetchFn))?.commit?.sha ?? null;
};

/** What a fetch needs: the DCS sb-zip endpoint serves releases BY TAG, so a
 * fetch request speaks the tag language even though pin IDENTITY is the sha
 * (D58). A sha-only pin is fetchable when DCS still lists a tag for that
 * commit; `fetchAndInstallPin` resolves it. */
export interface FetchPin {
  repoPath: string;
  version?: string;
  sha?: string;
  flavor: string;
}

/** The release tag DCS lists for a commit sha — the reverse lookup a sha-only
 * pin (D58) needs before it can be fetched via the tag-addressed sb-zip. */
export const tagForCommitSha = async (
  repoPath: string,
  sha: string,
  fetchFn: typeof fetch = ((...a: Parameters<typeof fetch>) => fetch(...a)),
): Promise<string | null> => {
  return (await findDcsTag(repoPath, (t) => t.commit?.sha === sha, fetchFn))?.name ?? null;
};

export type FetchStage = 'download' | 'verify' | 'install';

export interface FetchOptions {
  api: ServerApi;
  /** Injected for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  onStage?: (stage: FetchStage) => void;
  /** Install into this local repo path instead of the pin's canonical one.
   * Used when the canonical path is OCCUPIED by a different sha of the same
   * repo (round 20): the importer refuses an existing target, and deleting
   * the occupant could orphan another project pinned to it, so the exact
   * identity installs side by side. Reads resolve by identity, never by
   * recomputed path (B10), so the off-canonical path stays readable. */
  targetRepoPath?: string;
}

export interface FetchResult {
  repoPath: string;
  /** The SHA the export declared (equal to `pin.sha` when the pin carried one). */
  revision: string | null;
  bytes: number;
}

/** D23b — verify at EVERY import, against an expected SHA the archive did not
 * supply. A re-install carries the pin's own SHA; a first install has none,
 * so resolve the commit DCS records for this release tag (an independent
 * source) and require the export's declared revision to match it. Without
 * this, `pin.sha` is undefined, the old `pin.sha &&` guard never ran, and the
 * archive's self-declared revision became the pin — it self-certified (F4). */
const verifyExportRevision = async (
  pin: FetchPin,
  version: string,
  revision: string | null,
  doFetch: typeof fetch,
): Promise<void> => {
  const expectedSha = pin.sha ?? (await releaseCommitSha(pin.repoPath, version, doFetch));
  if (!expectedSha) {
    throw new Error(
      `cannot authenticate ${pin.repoPath} ${version}: DCS reported no commit for this ` +
        'release tag, so the download cannot be verified — not installed',
    );
  }
  if (!revision) {
    throw new Error(
      `the export for ${pin.repoPath} ${version} declares no revision, so its ` +
        'SHA cannot be verified — not installed',
    );
  }
  if (expectedSha !== revision) {
    throw new Error(
      `pin SHA mismatch for ${pin.repoPath} ${version}: expected ${expectedSha.slice(0, 12)}… ` +
        `(${pin.sha ? 'pinned' : 'DCS release tag'}), the export declares ${revision.slice(0, 12)}… ` +
        '— not installed',
    );
  }
};

/** Fetch one pinned resource and install it. Refuses rather than guessing:
 * a pin whose declared SHA does not match the export's own metadata is never
 * installed (D23b — "verify the SHA at each import"). */
export const fetchAndInstallPin = async (
  pin: FetchPin,
  opts: FetchOptions,
): Promise<FetchResult> => {
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  // The user's offline switch governs, even though the GET is client-side.
  if (!(await opts.api.getNetEnabled())) {
    throw new Error('the app is offline — go online to download resources');
  }

  // The sb-zip endpoint is tag-addressed. A sha-only pin (D58) resolves its
  // tag from DCS; a commit no tag names cannot be fetched this way — refuse
  // with the reason rather than downloading something else.
  const version =
    pin.version ?? (pin.sha ? await tagForCommitSha(pin.repoPath, pin.sha, doFetch) : null);
  if (!version) {
    throw new Error(
      `cannot fetch ${pin.repoPath}: the pin names no release tag and DCS lists no tag ` +
        `for its commit${pin.sha ? ` ${pin.sha.slice(0, 12)}…` : ''} — not installed`,
    );
  }

  opts.onStage?.('download');
  const url = sbZipUrl({ ...pin, version });
  const response = await doFetch(url);
  if (!response.ok) {
    throw new Error(`could not download ${url} (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  opts.onStage?.('verify');
  const { files, revision } = unwrapExport(bytes);
  await verifyExportRevision(pin, version, revision, doFetch);

  opts.onStage?.('install');
  const repoPath = opts.targetRepoPath ?? localRepoPathFor(pin);
  await opts.api.postZippedBurrito(repoPath, rezip(files));
  return { repoPath, revision, bytes: bytes.length };
};
