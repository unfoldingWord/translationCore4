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
import { samePath } from './resolve';
import type { Coverage } from './resolve';
import type { RepoSummary, ServerApi } from './serverApi';

/** Key under which the installed-resource record lives in client settings. */
export const INSTALLED_KEY = 'installedResources';

/** local repo path -> the pin that produced it. */
export type InstalledMap = { [localRepoPath: string]: ResourcePin };

export const localRepoPathFromRepoPath = (repoPath: string): string =>
  `_local_/_sideloaded_/${repoPath.split('/').pop()}`;

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
        const dcs = meta.identification?.primary?.dcs ?? {};
        const [key] = Object.keys(dcs);
        const revision = Object.values(dcs)[0]?.revision;
        if (!key || !revision) return;
        const repoName = localPath.split('/').pop() as string;
        const configuredOrg = orgFor(repoName);
        const repoPath = configuredOrg
          ? `git.door43.org/${configuredOrg}/${repoName}`
          : `git.door43.org/${key}`;
        found[localPath] = { repoPath, version: '', sha: revision, flavor: '' };
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
 * Keys are the repo path exactly as DCS reports it (owner ruling 2026-08-04);
 * `covers()` tolerates a differently-cased pin without converting anything.
 * Keyed by repoPath, not by (repoPath, version): one version of a repo is
 * installed at a time, and version identity is enforced separately by
 * `isPinLocal`. Keying by version here would silently zero the coverage of a
 * resource that is present but recorded under a different tag. */
export const coverageFromLocal = (
  summaries: Record<string, RepoSummary>,
  installed: InstalledMap,
): Coverage => {
  const coverage: Coverage = {};
  for (const [localPath, pin] of Object.entries(installed)) {
    const summary = summaries[localPath];
    if (!summary) continue;
    coverage[pin.repoPath] = (summary.book_codes || []).map((c) => c.toUpperCase());
  }
  return coverage;
};

/** Is this pin satisfied by what the machine holds?
 *
 * Two ways to be sure, in order of strength:
 *   1. the pin's expected commit SHA equals the installed burrito's own
 *      declared revision — the strongest possible match, and the one that
 *      works for a bundled install with no recorded tag;
 *   2. the recorded release tag equals the pin's version.
 * A different version of the same repo is NOT this pin. */
export const isPinLocal = (installed: InstalledMap, pin: ResourcePin): boolean => {
  const local = installed[localRepoPathFromRepoPath(pin.repoPath)];
  if (!local || !samePath(local.repoPath, pin.repoPath)) return false;
  if (pin.sha && local.sha) return pin.sha === local.sha;
  return !!local.version && local.version === pin.version;
};

/** Re-point a pin at the version this machine actually has, when it has one.
 *
 * Why this exists: the shipped default names specific versions, but a machine
 * may hold a newer release of the same repo. Pinning the default blindly would
 * make a brand-new project demand a download for a resource that is already
 * present — technically correct (a pin is a pin) but a poor first run, and it
 * hides the resource the user just fetched. Identity is (repoPath, version),
 * so this REPLACES the version rather than pretending the default matches. */
export const preferInstalledVersion = (installed: InstalledMap, pin: ResourcePin): ResourcePin => {
  const local = installed[localRepoPathFromRepoPath(pin.repoPath)];
  if (!local || !samePath(local.repoPath, pin.repoPath)) return pin;
  return { ...pin, version: local.version, ...(local.sha ? { sha: local.sha } : {}) };
};

/** Apply `preferInstalledVersion` across a whole §5.3 resources file. */
export const pinsPreferringInstalled = <T extends { languageSets?: Record<string, Record<string, unknown>> }>(
  resources: T,
  installed: InstalledMap,
): T => {
  if (!resources.languageSets) return resources;
  const slots = ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
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
 * coherent, so a partial suite is never written as a pin (§5.3). */
export const languageSetFromInstalled = (
  installed: InstalledMap,
  gateway: { id: string; org: string },
): {
  gatewayLanguage: { languageId: string; owner: string };
  translationNotes: ResourcePin;
  translationWordsLinks: ResourcePin;
  translationWords: ResourcePin;
  translationAcademy: ResourcePin;
} | null => {
  const org = gateway.org.toLowerCase();
  const ofOrg = Object.values(installed)
    .filter((p) => p.repoPath.toLowerCase().includes(`/${org}/`));
  const bySuffix = (suffix: string) => ofOrg.find((p) => p.repoPath.endsWith(suffix));
  const tn = bySuffix('_tn');
  const tw = bySuffix('_tw'); // D34: one repo serves both tW slots
  const ta = bySuffix('_ta');
  if (!tn || !tw || !ta) return null;
  return {
    gatewayLanguage: { languageId: gateway.id, owner: gateway.org },
    translationNotes: tn,
    translationWordsLinks: tw,
    translationWords: tw,
    translationAcademy: ta,
  };
};
