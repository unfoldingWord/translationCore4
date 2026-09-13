// upgrade.ts — a newer release of a project's help resources (J12, D72 point 5;
// epic #40, issue #256).
//
// The rules, from D72: discovery is on demand and online only; one offer per
// language set; the set's pins move only after every resource of the release
// is installed and sha-verified, so a failed download changes nothing; carry-
// over follows D36 (the resource is the primary key). Help resources only —
// the original-language texts and the gateway Bibles are #258.
//
// This module is the pure part: which repos a set pins, what DCS says is the
// newest release, which of those differ from the pin, and what the set looks
// like once it points at the new release. Installing and journaling live in
// state.jsx, on the same code the gateway change uses.
import type { LanguageSet, ResourcePin, ResourcesFile, Rung } from './burritoStore';
import { releaseCommitSha } from './resourceFetch';
import { samePath } from './resolve';

/** The HELP slots of a language set, in display order. tW's two slots name
 * one repo (D34), so `reposOfSet` folds them. `simplifiedText` is the
 * language's simplified Bible — a gateway Bible, not a help resource — so it
 * is never offered here (D72 point 5: texts are #258, Increment 7). */
export const SET_SLOTS = [
  'translationNotes',
  'translationWordsLinks',
  'translationWords',
  'translationAcademy',
  'translationQuestions',
] as const;
export type SetSlotName = (typeof SET_SLOTS)[number];

export interface SetRepo {
  repoPath: string;
  pin: ResourcePin;
  slots: SetSlotName[];
}

/** One entry per distinct repo a set pins, with every slot that names it. */
export const reposOfSet = (set: LanguageSet): SetRepo[] => {
  const out: SetRepo[] = [];
  for (const slot of SET_SLOTS) {
    const pin = set[slot];
    if (!pin?.repoPath) continue;
    const hit = out.find((r) => samePath(r.repoPath, pin.repoPath));
    if (hit) hit.slots.push(slot);
    else out.push({ repoPath: pin.repoPath, pin, slots: [slot] });
  }
  return out;
};

/** What DCS reports as a repo's newest release: the tag, the commit it names
 * (the D58 identity), and when it was published. */
export interface ReleaseInfo {
  tag: string;
  sha: string;
  publishedAt: string | null;
}

/** Ask DCS for a repo's latest release. `releases/latest` gives the tag and the
 * date; the commit comes from the tags listing, the same oracle a first
 * install verifies against (D23b). Throws when the repo has no release or the
 * tag names no commit — an unanswerable offer is stated, never guessed. */
export const latestRelease = async (
  repoPath: string,
  fetchFn: typeof fetch = ((...a: Parameters<typeof fetch>) => fetch(...a)),
): Promise<ReleaseInfo> => {
  const path = repoPath.replace(/^https?:\/\//, '');
  const slash = path.indexOf('/');
  const url = `https://${path.slice(0, slash)}/api/v1/repos/${path.slice(slash + 1)}/releases/latest`;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`${repoPath}: no published release (HTTP ${response.status})`);
  const body = (await response.json()) as { tag_name?: string; published_at?: string };
  if (!body.tag_name) throw new Error(`${repoPath}: the latest release has no tag`);
  const sha = await releaseCommitSha(repoPath, body.tag_name, fetchFn);
  if (!sha) throw new Error(`${repoPath}: DCS names no commit for release ${body.tag_name}`);
  return { tag: body.tag_name, sha, publishedAt: body.published_at ?? null };
};

/** One repo of a set that has a newer release than the pin. `to` is the pin
 * the set will carry: the new identity, the pin's own flavor, and no recorded
 * `books` (the caller backfills coverage from the installed copy). */
export interface RepoUpgrade {
  repoPath: string;
  slots: SetSlotName[];
  from: ResourcePin;
  to: ResourcePin;
  publishedAt: string | null;
}

export interface SetOffer {
  rung: Rung;
  upgrades: RepoUpgrade[];
  /** Repos already at the newest release. */
  current: string[];
}

/** Compute one set's offer from what DCS reported per repo. A repo is offered
 * when the newest release names a commit other than the pinned one (D58: the
 * sha is the identity; the label is display). A repo DCS said nothing about
 * is neither offered nor current — the caller reported that failure. */
export const offerForSet = (
  rung: Rung,
  set: LanguageSet,
  latest: Record<string, ReleaseInfo>,
): SetOffer => {
  const upgrades: RepoUpgrade[] = [];
  const current: string[] = [];
  for (const repo of reposOfSet(set)) {
    const key = Object.keys(latest).find((k) => samePath(k, repo.repoPath));
    const info = key ? latest[key] : undefined;
    if (!info) continue;
    if (info.sha === repo.pin.sha) {
      current.push(repo.repoPath);
      continue;
    }
    upgrades.push({
      repoPath: repo.repoPath,
      slots: repo.slots,
      from: repo.pin,
      to: { repoPath: repo.pin.repoPath, version: info.tag, sha: info.sha, flavor: repo.pin.flavor },
      publishedAt: info.publishedAt,
    });
  }
  return { rung, upgrades, current };
};

/** The set with every offered repo re-pinned to its new release. Slots the
 * offer does not name keep their pins byte-for-byte. */
export const upgradedSet = (set: LanguageSet, offer: SetOffer): LanguageSet => {
  const next = { ...set };
  for (const u of offer.upgrades) for (const slot of u.slots) (next as Record<string, unknown>)[slot] = u.to;
  return next;
};

/** The pin file with ONE rung upgraded. The other rung, the `resources`
 * groups and `extraScripture` are the same objects as before — the other set
 * and the text pins are never touched by a help-set upgrade (D72). */
export const applyUpgrade = (resources: ResourcesFile, offer: SetOffer): ResourcesFile => ({
  ...resources,
  schemaVersion: 2,
  languageSets: {
    ...resources.languageSets,
    [offer.rung]: upgradedSet(resources.languageSets[offer.rung], offer),
  },
});

/** True when an offer no longer describes this set: some slot it would move
 * does not hold the pin the offer was computed FROM (Codex review round 1 —
 * an offer computed in one project must never be applied in another, nor
 * after the pins changed under it). Identity is the sha (D58). */
export const offerIsStale = (offer: SetOffer, set: LanguageSet | undefined): boolean =>
  offer.upgrades.some((u) =>
    u.slots.some((slot) => {
      const current = set?.[slot];
      return !current || !samePath(current.repoPath, u.from.repoPath) || current.sha !== u.from.sha;
    }));

/** A short label for the release a repo moves to, for the offer row. */
export const releaseDateLabel = (publishedAt: string | null): string =>
  publishedAt ? publishedAt.slice(0, 10) : '';
