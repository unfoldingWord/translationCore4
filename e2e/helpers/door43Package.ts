// #650: Door43 and its catalogue held still for ONE gateway package, served from the
// rig's resource cache (dev-env/resources-cache, filled with dev-env/scripts/cache-resource.zsh).
// The same routes as J13's mockSpanishAcademy, for every repository of the package:
//   - the platform's catalogue of the owner (GET /gitea/remote-repos/git.door43.org/<owner>),
//     listing only the cached repositories, each `tc-ready`, with the books it covers;
//   - Door43's latest release, its tags and the release's sb-zip, for each repository.
// Any other Door43 request is answered 404 "not mocked", so a route the app starts to use
// shows up as a failed download, never as a silent success.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { TC4_ROOT } from './root';

export interface CachedRepo {
  /** The repository name, e.g. `ar_tn`. */
  repo: string;
  /** The release tag that is cached, e.g. `v6.1`. */
  tag: string;
  /** The catalogue's flavor. By default the flavor the cached export declares in its metadata
   * (`x-bcvnotes` for tN): the app takes the role of tN from it, not from the name. */
  flavor?: string;
  /** The books the catalogue says the repository covers (book-scoped roles). */
  books?: string[];
}

/** The cached unwrapped zip of a release. */
export const cachedZip = (repo: string, tag: string): string =>
  path.join(TC4_ROOT, 'dev-env', 'resources-cache', `${repo}-${tag}-unwrapped.zip`);

/** The commit and the flavor a cached export declares in its metadata. */
function cachedIdentity(zip: string): { sha: string; flavor: string } {
  const files = unzipSync(new Uint8Array(fs.readFileSync(zip)), { filter: (f) => f.name === 'metadata.json' });
  const meta = JSON.parse(strFromU8(files['metadata.json'])) as {
    identification: { primary: { dcs: Record<string, { revision: string }> } };
    type: { flavorType: { flavor: { name: string } } };
  };
  return { sha: Object.values(meta.identification.primary.dcs)[0].revision, flavor: meta.type.flavorType.flavor.name };
}

/** Serve `owner`'s package from the cache. Returns a function that removes the routes. */
export async function mockDoor43Package(page: Page, owner: string, repos: CachedRepo[]): Promise<() => Promise<void>> {
  const cors = { 'access-control-allow-origin': '*' };
  const byName = new Map(repos.map((r) => {
    const zip = cachedZip(r.repo, r.tag);
    const own = cachedIdentity(zip);
    return [r.repo, { ...r, zip, sha: own.sha, flavor: r.flavor ?? own.flavor }];
  }));
  const catalogue = new RegExp(`/gitea/remote-repos/git\\.door43\\.org/${owner}$`);
  await page.route(catalogue, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([...byName.values()].map((r) => ({
      name: r.repo, description: '', flavor: r.flavor, flavor_type: '', topics: ['tc-ready'], book_codes: r.books ?? [],
    }))),
  }));
  const door43 = /^https:\/\/git\.door43\.org\//;
  const releases = new RegExp(`^/(?:api/v1/repos/)?${owner}/([^/]+)/(.*)$`);
  await page.context().route(door43, (route) => {
    const url = new URL(route.request().url());
    const m = releases.exec(url.pathname);
    const r = m ? byName.get(m[1]) : undefined;
    if (!m || !r) return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
    if (m[2] === 'releases/latest')
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ tag_name: r.tag }) });
    if (m[2].startsWith('tags')) {
      const p = Number(url.searchParams.get('page') ?? '1');
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(p === 1 ? [{ name: r.tag, commit: { sha: r.sha } }] : []) });
    }
    if (m[2] === `sb/${r.tag}.zip`)
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/zip', body: fs.readFileSync(r.zip) });
    return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
  });
  // A page that is closed already has no routes left to remove.
  return async () => {
    await page.unroute(catalogue).catch(() => {});
    await page.context().unroute(door43).catch(() => {});
  };
}
