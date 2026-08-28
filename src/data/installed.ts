// installed.ts — what THIS MACHINE has locally, and the coverage that follows.
//
// Two different things must not be confused:
//   * an INSTALL is machine-scoped — a resource lives once at
//     `_local_/_sideloaded_/<repo>` and is shared by every project;
//   * a PIN is project-scoped — `checking/resources.json` records which
//     (repoPath, version, sha) that project checks against (§5.3, D30.3).
// This module owns the machine side. The pin record is persisted through the
// platform's per-client settings (`/api/client-settings/<storage_id>`), which
// is exactly the "belongs to this machine, not to the project" store.
import type { ResourcePin } from './burritoStore';
import { pinKey, samePath } from './resolve';
import type { Coverage } from './resolve';
import type { RepoSummary, ServerApi } from './serverApi';

/** Key under which the installed-resource record lives in client settings. */
export const INSTALLED_KEY = 'installedResources';

/** local repo path -> the pin that produced it. */
export type InstalledMap = { [localRepoPath: string]: ResourcePin };

/** The local install directory for a DCS repo. Identity is the COMPLETE repo
 * (owner + name), NOT the bare name: two gateways can each publish a repo of
 * the same name (`Xenizo/fr_tn` and `MVHS/fr_tn`), and keying on the basename
 * alone collides them into one install — the second is skipped as "already
 * installed" and never becomes available (B9). Owner and name join with `--`
 * so the result stays ONE path segment under `_local_/_sideloaded_/`, which is
 * the shape the platform importer accepts. (No DCS owner or repo name contains
 * `--`, so the split back to owner/name is unambiguous — see `discoverOnDisk`.) */
export const localRepoPathFromRepoPath = (repoPath: string): string => {
  const parts = repoPath.replace(/^https?:\/\//, '').split('/').filter(Boolean);
  // Lowercase the identity segment so it is CANONICAL: `samePath` treats repo
  // paths case-insensitively, so `Es-419_gl/es-419_tn` and `es-419_gl/...` are
  // the same repo and MUST map to the same install dir. (The on-disk dir name
  // is arbitrary; the DCS fetch still uses the correctly-cased `pin.repoPath`.)
  const repo = (parts[parts.length - 1] ?? '').toLowerCase();
  const owner = (parts.length >= 2 ? parts[parts.length - 2] : '').toLowerCase();
  return `_local_/_sideloaded_/${owner ? `${owner}--${repo}` : repo}`;
};

/** The SB flavor string ("<flavorType>/<flavor>") from a burrito's metadata —
 * the factual value a pin's `flavor` field carries (§5.3). Empty when the
 * metadata does not state one; a pin needs a non-empty flavor to journal
 * (§8.5 schema, D57), so record it wherever the metadata is at hand. */
export const flavorOfMetadata = (meta: unknown): string => {
  const ft = (meta as { type?: { flavorType?: { name?: string; flavor?: { name?: string } } } })
    ?.type?.flavorType;
  if (!ft?.name || !ft?.flavor?.name) return '';
  return `${ft.name}/${ft.flavor.name}`;
};

export const readInstalled = async (api: ServerApi, storageId: string): Promise<InstalledMap> => {
  try {
    const settings = await api.getClientSettings(storageId);
    const raw = settings[INSTALLED_KEY];
    return raw && typeof raw === 'object' ? (raw as InstalledMap) : {};
  } catch {
    return {};
  }
};

/** Record one install. Merges, so two downloads never lose each other. */
export const recordInstalled = async (
  api: ServerApi,
  storageId: string,
  localRepoPath: string,
  pin: ResourcePin,
): Promise<InstalledMap> => {
  const settings = await api.getClientSettings(storageId).catch(() => ({}) as Record<string, unknown>);
  const current = (settings[INSTALLED_KEY] ?? {}) as InstalledMap;
  const next: InstalledMap = { ...current, [localRepoPath]: pin };
  await api.setClientSettings(storageId, { ...settings, [INSTALLED_KEY]: next });
  return next;
};

/** Resolve the org that currently publishes a repo of this name, or null when
 * the caller cannot say. Passed in so this module stays free of gateway config
 * (see `orgResolverFor` in the app for the GATEWAYS-backed implementation). */
export type OrgResolver = (repoName: string) => string | null;

/** Discover resources that are on disk but carry no install record — a
 * shipped install's bundled suite, a rig seed, anything sideloaded by hand.
 *
 * Identity comes from each burrito's OWN metadata revision, so this works
 * offline and without guessing a release tag. The entry carries `sha` (the
 * revision) and an empty `version`, which is exactly what it is: this machine
 * holds that commit, and nothing here claims to know which tag it was.
 * Recorded installs win, because they additionally know the tag.
 *
 * THE ORG IS NOT TAKEN FROM THE METADATA WHEN THE APP KNOWS BETTER (platform note
 * #30). A DCS export records the org name as it was at export time, so an org
 * rename leaves it stale — `Es-419_gl/es-419_tn` v66 still declares
 * `Idiomas-Puentes/es-419_tn`, and that org 404s today [VERIFIED live
 * 2026-08-04]. A stale org means the SHA→tag lookup fails AND the derived
 * repoPath matches no pin, so a resource that is on disk reads as not-local.
 * So: when exactly one configured gateway org publishes a repo of this name,
 * use that org — the address the app actually pins by. When the name is
 * ambiguous (two orgs both publish `fr_tn`) the metadata IS the only evidence,
 * and it is used. The revision always comes from the burrito itself. */
export const discoverOnDisk = async (
  api: ServerApi,
  summaries: Record<string, RepoSummary>,
  recorded: InstalledMap,
  orgFor: OrgResolver = () => null,
): Promise<InstalledMap> => {
  const found: InstalledMap = {};
  const sideloaded = Object.keys(summaries).filter((p) => p.includes('/_sideloaded_/'));
  await Promise.all(
    sideloaded.map(async (localPath) => {
      if (recorded[localPath]) return; // the record knows the tag; prefer it
      try {
        const meta = (await api.getMetadataRaw(localPath)) as unknown as {
          identification?: { primary?: { dcs?: Record<string, { revision?: string }> } };
        };
        const flavor = flavorOfMetadata(meta);
        const dcs = meta.identification?.primary?.dcs ?? {};
        const [key] = Object.keys(dcs);
        const revision = Object.values(dcs)[0]?.revision;
        if (!key || !revision) return;
        // The local segment is `<owner>--<repo>` for installs written by the
        // owner-qualified path; older installs are the bare `<repo>`. When the
        // owner is in the path we know the exact DCS identity and need neither
        // the resolver nor the (possibly stale) metadata org. Otherwise fall
        // back: a configured org for this name, else the metadata key.
        const seg = localPath.split('/').pop() as string;
        const sep = seg.indexOf('--');
        const ownerFromPath = sep > 0 ? seg.slice(0, sep) : null;
        const repoName = sep > 0 ? seg.slice(sep + 2) : seg;
        const org = ownerFromPath ?? orgFor(repoName);
        const repoPath = org ? `git.door43.org/${org}/${repoName}` : `git.door43.org/${key}`;
        // Both identity halves are factual — the burrito states its own
        // flavor and revision (D58: the sha IS the identity). No version:
        // nothing on disk knows the tag, and the label is optional.
        found[localPath] = { repoPath, sha: revision, flavor };
      } catch {
        /* unreadable metadata: contributes nothing, the safe direction */
      }
    }),
  );
  return { ...found, ...recorded };
};

/** Build the resolver's coverage map from what is actually on disk.
 *
 * `book_codes` comes from the platform's own summaries — UPPERCASE for local
 * repos [VERIFIED live 2026-08-03] — so coverage never requires scanning TSVs.
 * Keys are the exact pin identity (repoPath + sha, D58). The repo path retains
 * the casing DCS reports; `coverageFor()` tolerates a differently-cased path
 * without converting the stored identity. A different commit of the same repo
 * can contain a different set of books, so repoPath alone is not sufficient. */
export const coverageFromLocal = (
  summaries: Record<string, RepoSummary>,
  installed: InstalledMap,
): Coverage => {
  const coverage: Coverage = {};
  for (const [localPath, pin] of Object.entries(installed)) {
    const summary = summaries[localPath];
    if (!summary) continue;
    coverage[pinKey(pin)] = (summary.book_codes || []).map((c) => c.toUpperCase());
  }
  return coverage;
};

/** The installed entry whose repo IDENTITY matches this pin, found by the same
 * case-insensitive comparison `samePath` uses — NOT by recomputing a local
 * path. Existing/seeded installs live at legacy `<repo>` paths while fresh
 * installs use `<owner>--<repo>`; recomputing the path missed the legacy ones
 * and made every seeded resource invisible (B10). An identity search finds the
 * install wherever it actually lives, at whatever key. */
const installedEntry = (
  installed: InstalledMap,
  pin: ResourcePin,
): [string, ResourcePin] | undefined => {
  // Official review round 7: the entry must be the EXACT pin — (repoPath +
  // sha), the only identity (D58/D59). A same-repo install at another commit
  // is NOT this pin: resolving it as a read path would let the app read
  // different content while downstream records claim the requested sha. The
  // repoPath comparison stays case-insensitive and path-shape-blind (B10:
  // legacy `<repo>` and `<owner>--<repo>` keys both resolve).
  return Object.entries(installed).find(
    ([, p]) =>
      samePath(p.repoPath, pin.repoPath) && !!pin.sha && !!p.sha && pin.sha === p.sha,
  );
};

/** The same-repo entry regardless of sha — ONLY for `preferInstalledVersion`,
 * which REPLACES the pin's identity with the local install's (so "which
 * commit" is exactly what it is deciding). Never resolve a read through this.
 * Among coexisting installs (B16) an identified (sha-carrying) record wins. */
const installedRepoEntry = (
  installed: InstalledMap,
  pin: ResourcePin,
): [string, ResourcePin] | undefined => {
  const sameRepo = Object.entries(installed).filter(([, p]) => samePath(p.repoPath, pin.repoPath));
  // Round 8: among coexisting twins (B16) the EXACT requested sha wins first —
  // first-identified-wins would repoint a new project to a stale legacy twin
  // even when the exact install is present. Then any identified install, then
  // the bare first (which re-points nothing — a sha-less record never adopts).
  return (
    sameRepo.find(([, p]) => !!pin.sha && !!p.sha && pin.sha === p.sha) ??
    sameRepo.find(([, p]) => !!p.sha) ??
    sameRepo[0]
  );
};

/** The ACTUAL on-disk local path a pin resolves to, or null when not installed.
 * READ a resource through this — never recompute the path, which misses a
 * legacy- or differently-cased install (B10). Exact identity only: a same-repo
 * install at a different sha reads as NOT INSTALLED (round 7). */
export const installedPathFor = (installed: InstalledMap, pin: ResourcePin): string | null =>
  installedEntry(installed, pin)?.[0] ?? null;

/** Is this pin satisfied by what the machine holds?
 *
 * One way to be sure (D58/D59): the pin's expected commit SHA equals the
 * installed burrito's own declared revision. The version label is display
 * only — tags are unenforced upstream, so a label match proves nothing. An
 * install record without a sha satisfies no pin: the identifying fetch (which
 * records the export's declared revision) is the way back in. */
export const isPinLocal = (installed: InstalledMap, pin: ResourcePin): boolean =>
  installedEntry(installed, pin) !== undefined;

/** Re-point a pin at the version this machine actually has, when it has one.
 *
 * Why this exists: the shipped default names specific versions, but a machine
 * may hold a newer release of the same repo. Pinning the default blindly would
 * make a brand-new project demand a download for a resource that is already
 * present — technically correct (a pin is a pin) but a poor first run, and it
 * hides the resource the user just fetched. Identity is (repoPath, sha) — D58 —
 * so this REPLACES the identity rather than pretending the default matches;
 * the version label rides along only when the local record knows it (an empty
 * version must be OMITTED, the §5.3 grammar refuses ''). A local record
 * WITHOUT a sha re-points nothing (D59): adopting its label while keeping the
 * default's sha would fabricate a pin whose sha and version describe
 * different releases. */
export const preferInstalledVersion = (installed: InstalledMap, pin: ResourcePin): ResourcePin => {
  const local = installedRepoEntry(installed, pin)?.[1];
  if (!local?.sha) return pin;
  const next: ResourcePin = { ...pin, sha: local.sha };
  if (local.version) next.version = local.version;
  else delete next.version;
  return next;
};

/** Apply `preferInstalledVersion` across a whole §5.3 resources file. */
export const pinsPreferringInstalled = <T extends { languageSets?: Record<string, Record<string, unknown>> }>(
  resources: T,
  installed: InstalledMap,
): T => {
  if (!resources.languageSets) return resources;
  const slots = ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy',
    'translationQuestions', 'simplifiedText'];
  const languageSets: Record<string, Record<string, unknown>> = {};
  for (const [rung, set] of Object.entries(resources.languageSets)) {
    const next: Record<string, unknown> = { ...set };
    for (const slot of slots) {
      const pin = set[slot] as ResourcePin | undefined;
      if (pin?.repoPath) next[slot] = preferInstalledVersion(installed, pin);
    }
    languageSets[rung] = next;
  }
  return { ...resources, languageSets };
};

/** The §5.3 language set for one gateway org, built from what is installed.
 * Returns null when the org's tn / tw / tA are not all present — a set must be
 * coherent, so a partial suite is never written as a pin (§5.3).
 *
 * Every pin must carry its IDENTITY — a sha — and a flavor (D58): the §8.5
 * journal schema refuses a resource.pin.set entry without them. Both are in
 * the burrito's own metadata, so a disk-discovered suite qualifies; the
 * version tag is an optional display label and gates nothing. */
export const languageSetFromInstalled = (
  installed: InstalledMap,
  gateway: { id: string; org: string },
): {
  gatewayLanguage: { languageId: string; owner: string };
  translationNotes: ResourcePin;
  translationWordsLinks: ResourcePin;
  translationWords: ResourcePin;
  translationAcademy: ResourcePin;
  translationQuestions?: ResourcePin;
  simplifiedText?: ResourcePin;
} | null => {
  const org = gateway.org.toLowerCase();
  const ofOrg = Object.values(installed)
    .filter((p) => p.repoPath.toLowerCase().includes(`/${org}/`))
    .filter((p) => !!p.sha && !!p.flavor);
  // EVERY slot matches by the FULL `<languageId>_<suffix>` repo name, never
  // the bare suffix: a multi-language org (translationCore-Create-BCS holds
  // hi_*, bn_*, gu_*, …) would otherwise assemble a MIXED-language set —
  // e.g. Bengali tN pinned into a Hindi language set (2026-08-27 adversarial
  // round 3; the round-1 fix covered only the optional slots).
  const byName = (name: string) =>
    ofOrg.find((p) => {
      const base = p.repoPath.split('/').pop() ?? '';
      return base.toLowerCase() === name.toLowerCase();
    });
  const tn = byName(`${gateway.id}_tn`);
  const tw = byName(`${gateway.id}_tw`); // D34: one repo serves both tW slots
  const ta = byName(`${gateway.id}_ta`);
  if (!tn || !tw || !ta) return null;
  // §5.3 1.10 OPTIONAL slots (D64): included only when installed — a set
  // without them is still complete, so their absence never blocks the set.
  const tq = byName(`${gateway.id}_tq`);
  // English publishes `_ust`; other gateways publish `_gst` (evidence in
  // gateways.ts). Either name is the language's simplified text.
  const simplified = byName(`${gateway.id}_ust`) ?? byName(`${gateway.id}_gst`);
  return {
    gatewayLanguage: { languageId: gateway.id, owner: gateway.org },
    translationNotes: tn,
    translationWordsLinks: tw,
    translationWords: tw,
    translationAcademy: ta,
    ...(tq ? { translationQuestions: tq } : {}),
    ...(simplified ? { simplifiedText: simplified } : {}),
  };
};
