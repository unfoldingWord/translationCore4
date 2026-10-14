// A fake pankosmia-web rig for the issue-#62 store suites: enough of the HTTP
// surface for JournalingStore's full lifecycle (create, scaffold, ingredient
// read/write/list, metadata read + rescan, add-and-commit), with verbatim
// response shapes (isNotFound needs the live 400 ENOENT reason text) and
// per-request FAILURE INJECTION for the crash/atomicity proofs.
//
// The platform behaviors emulated here are the [VERIFIED] ones the product
// code depends on (BURRITO-SPEC §6, PLATFORM-NOTES): whole-file writes, the
// paths listing walking the real tree, new-scripture-book regenerating
// currentScope, remake-ingredients rebuilding the table from disk, the temp
// upload and remake-from-zip of the import shell (#361), and (opt-in) the Bible
// create route's refusal of a code outside its bare-code table (PLATFORM-NOTES
// #43), which leaves the git-init debris of PLATFORM-NOTES #28.
import type { KvStore } from '../../src/data/journal/identity';
import { withLocalizedNames } from '../../scripts/fix-obs-template.mjs';
import { strToU8, unzipSync, zipSync } from 'fflate';

// Real node builtins via the runtime (the app's polyfill plugin aliases them).
const nodeFs = process.getBuiltinModule('node:fs');
const nodePath = process.getBuiltinModule('node:path');
const OBS_TEMPLATE = nodePath.resolve(process.cwd(), 'conformance/fixtures/text_stories');

/** Every ingredient of the vendored `text_stories` template, keyed by ipath. */
const obsTemplateFiles = (): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const ipath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(nodePath.join(dir, entry.name), ipath);
      else out[ipath] = nodeFs.readFileSync(nodePath.join(dir, entry.name), 'utf8');
    }
  };
  walk(nodePath.join(OBS_TEMPLATE, 'ingredients'), '');
  return out;
};

/** The template's metadata stamped the way new_obs_resource.rs stamps it: string
 * replacement of the placeholders. `fixed` models the tC4-served template
 * (scripts/fix-obs-template.mjs); unfixed, it is resource-core's, which the
 * server's own metadata struct cannot parse back (PLATFORM-NOTES #36). */
const obsMeta = (form: { content_abbr: string; content_name: string; content_language_code: string }, fixed: boolean): Record<string, unknown> => {
  let text = nodeFs.readFileSync(nodePath.join(OBS_TEMPLATE, 'metadata.json'), 'utf8');
  if (fixed) text = withLocalizedNames(text);
  text = text
    .replaceAll('%%ABBR%%', form.content_abbr)
    .replaceAll('%%CONTENT_NAME%%', form.content_name)
    .replaceAll('%%CREATED_TIMESTAMP%%', '2026-09-16T12:00:00.000Z')
    .replace('%%LANGUAGE%%', JSON.stringify({ tag: form.content_language_code, name: { en: form.content_language_code } }));
  return JSON.parse(text) as Record<string, unknown>;
};

export interface RigProject {
  files: Map<string, string>; // ipath -> text
  meta: Record<string, unknown>;
  commits: string[];
  /** ipaths written since the last add-and-commit — what GET /git/status lists (#183). */
  dirty: Set<string>;
  /** #676: the `origin` url, and the version of that fake remote this repository last cloned or pushed. */
  origin?: string;
  pulled?: number;
  /** #676: the checked-out branch (default 'main'). */
  branch?: string;
}

/** #676: a Door43 repository behind the git routes: `main` as files + metadata, and
 * its version (a push that does not start from it is not a fast-forward). */
export interface FakeRemote {
  files: Map<string, string>;
  meta: Record<string, unknown>;
  version: number;
  /** false: a push answers as Door43 does without write access ([PENDING — owner run, #673 step 4]). */
  writable: boolean;
  /** The branch its HEAD names, which a clone checks out (default 'main'). */
  defaultBranch?: string;
}

export interface FailureRule {
  /** Match a request about to run. `ipath` is set for ingredient reads/writes. */
  match: (ctx: { method: string; route: string; repo?: string; ipath?: string }) => boolean;
  /** How many matching requests fail before the rule expires (Infinity = always). */
  times: number;
}

const SERVER_SKELETON = (code: string): string =>
  [`\\id ${code} fake platform scaffold`, '\\c 1', '\\p', '\\v 1 ___', '\\v 2 ___', ''].join('\n');

export const FAKE_VRS = JSON.stringify({ maxVerses: { TIT: ['16', '15', '15'] }, mappedVerses: {} });

const baseMeta = (tag = 'es'): Record<string, unknown> => ({
  format: 'scripture burrito',
  languages: [{ tag, name: { en: tag } }],
  meta: { category: 'source', normalization: 'NFC' },
  type: { flavorType: { name: 'scripture', currentScope: {} as Record<string, string[]> } },
  localizedNames: {}, // the platform's Bible template carries it (PLATFORM-NOTES #36)
  ingredients: {},
});

/** The server parses metadata.json back through its own struct on every
 * registering write and rescan; a document without `localizedNames` fails
 * [VERIFIED — pankosmia-web 0.18.5, rig, 2026-09-15]. */
const unparseable = (project: RigProject): Response | null =>
  'localizedNames' in project.meta
    ? null
    : new Response(JSON.stringify({ is_good: false, reason: 'Could not parse metadata: missing field `localizedNames` at line 593 column 3' }), { status: 500 });

/** Rebuild currentScope + ingredients from the files on disk — what the
 * platform's rescan does (whole-book [] scope per book file). */
const rescan = (project: RigProject): void => {
  const scope: Record<string, string[]> = {};
  const ingredients: Record<string, unknown> = {};
  for (const ipath of [...project.files.keys()].sort()) {
    ingredients[`ingredients/${ipath}`] = { size: project.files.get(ipath)?.length ?? 0 };
    const book = /^([A-Z0-9]{3})\.usfm$/.exec(ipath)?.[1];
    if (book) scope[book] = [];
  }
  // The platform rebuilds currentScope from the USFM files on every registering
  // write and rescan — so an OBS project's table, which R-10.2.3 keeps verbatim,
  // EMPTIES (PLATFORM-NOTES #37 [VERIFIED live 0.18.5, 2026-09-16]). The store
  // therefore never registers or rescans an OBS project; this fake keeps the
  // platform's behavior so a test can tell.
  (project.meta.type as { flavorType: { currentScope: unknown } }).flavorType.currentScope = scope;
  project.meta.ingredients = ingredients;
};

const flavorOf = (meta: Record<string, unknown>): string => {
  const flavorType = (meta.type as { flavorType?: { flavor?: { name?: string } } } | undefined)?.flavorType;
  return flavorType?.flavor?.name ?? 'textTranslation';
};

export const journalingRig = () => {
  const repos = new Map<string, RigProject>();
  const writes: Array<{ repo: string; ipath: string; payload: string }> = [];
  const log: Array<{ method: string; route: string }> = [];
  const failures: FailureRule[] = [];
  const temps = new Map<string, Uint8Array>(); // POST /temp/bytes uploads, by uuid
  // #676: the git transport — Door43 repositories by url, and the net gate
  const remotes = new Map<string, FakeRemote>();
  let netEnabled = true;
  const setNet = (on: boolean): void => {
    netEnabled = on;
  };
  const copyOf = (project: RigProject): RigProject => ({
    files: new Map(project.files),
    meta: structuredClone(project.meta),
    commits: [...project.commits],
    dirty: new Set(project.dirty),
    origin: project.origin,
    pulled: project.pulled,
    branch: project.branch,
  });
  /** Share `repoPath` to a fake Door43 repository at `url`: its `main` is the project now. */
  const publish = (repoPath: string, url: string): FakeRemote => {
    const project = repos.get(repoPath);
    if (!project) throw new Error(`no such repo ${repoPath}`);
    const remote: FakeRemote = { files: new Map(project.files), meta: structuredClone(project.meta), version: 1, writable: true };
    remotes.set(url, remote);
    project.origin = url;
    project.pulled = 1;
    return remote;
  };
  /** A teammate pushes to `url`: `main` moves on (with `mutate`'s change, if any). */
  const teammatePush = (url: string, mutate?: (remote: FakeRemote) => void): void => {
    const remote = remotes.get(url);
    if (!remote) throw new Error(`no such remote ${url}`);
    mutate?.(remote);
    remote.version += 1;
  };
  /** Whether new-obs-resource stamps from the tC4-served (fixed) template. */
  let obsTemplateFixed = true;
  const serveUnfixedObsTemplate = (): void => {
    obsTemplateFixed = false;
  };

  /** Whether the create routes check the language code as the server does
   * (PLATFORM-NOTES #43): a tag whose first subtag is in the table, or an `x-`
   * tag with a name. The table has no `qaa`–`qtz` (reserved for local use).
   * The check runs before the repository exists. Opt-in: the older suites
   * create with codes the real table refuses. */
  let languageTable = false;
  const refuseUnknownLanguages = (): void => {
    languageTable = true;
  };
  const languageRefusal = (code: string, name: string | null | undefined): Response | null => {
    if (!languageTable) return null;
    const known = code.startsWith('x-') ? !!name : /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code) && !/^q[a-t][a-z]$/.test(code.split('-')[0]);
    return known ? null : ok({ is_good: false, reason: `Unable to find language name: ${code}` });
  };

  const failOn = (match: FailureRule['match'], times = 1): void => {
    failures.push({ match, times });
  };

  const createRepo = (
    repoPath: string,
    files: Record<string, string> = {},
    meta: Record<string, unknown> = baseMeta(),
  ): RigProject => {
    const project: RigProject = { files: new Map(Object.entries(files)), meta, commits: [], dirty: new Set() };
    // Creation builds the ingredient table but keeps the stamped scope: the
    // OBS route copies the template's 33-book table verbatim (its initial
    // commit carries it [VERIFIED live 0.18.5, 2026-09-16]); only a later
    // registering write or rescan rebuilds the scope from USFM files.
    const stamped = (meta.type as { flavorType: { currentScope: unknown } }).flavorType.currentScope;
    rescan(project);
    if (flavorOf(meta) === 'textStories')
      (project.meta.type as { flavorType: { currentScope: unknown } }).flavorType.currentScope = stamped;
    repos.set(repoPath, project);
    return project;
  };

  const maybeFail = (ctx: { method: string; route: string; repo?: string; ipath?: string }): void => {
    for (const rule of failures) {
      if (rule.times <= 0 || !rule.match(ctx)) continue;
      rule.times -= 1;
      throw new Error(`injected failure: ${ctx.method} ${ctx.route} ${ctx.ipath ?? ''}`);
    }
  };

  const ok = (body: unknown = { is_good: true, reason: 'ok' }): Response =>
    new Response(JSON.stringify(body), { status: 200 });
  const notFound = (reason: string): Response =>
    new Response(JSON.stringify({ is_good: false, reason }), { status: 400 });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const route = url.pathname;
    log.push({ method, route });

    const repoAt = (index: number): string => parts.slice(index, index + 3).map(decodeURIComponent).join('/');

    if (parts[1] === 'burrito' && parts[2] === 'ingredient' && parts[3] === 'raw') {
      const repo = repoAt(4);
      const ipath = decodeURIComponent(url.searchParams.get('ipath') ?? '');
      maybeFail({ method, route, repo, ipath });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      if (method === 'GET') {
        const text = project.files.get(ipath);
        if (text === undefined)
          return notFound('could not read ingredient content: No such file or directory (os error 2)');
        return new Response(text, { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { payload: string };
      if (url.searchParams.has('update_ingredients')) {
        const refused = unparseable(project);
        if (refused) return refused;
      }
      project.files.set(ipath, body.payload);
      project.dirty.add(ipath);
      writes.push({ repo, ipath, payload: body.payload });
      if (url.searchParams.has('update_ingredients')) rescan(project);
      return ok();
    }

    if (parts[1] === 'burrito' && parts[2] === 'ingredient' && parts[3] === 'delete') {
      const repo = repoAt(4);
      const ipath = decodeURIComponent(url.searchParams.get('ipath') ?? '');
      maybeFail({ method, route, repo, ipath });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      if (!project.files.has(ipath)) return notFound(`No such file: ${ipath}`);
      // The real server renames to `<name>.bak`, which /burrito/paths hides —
      // from the client's view the file is gone (0.18.5 post_delete_ingredient).
      project.files.delete(ipath);
      writes.push({ repo, ipath, payload: '<deleted>' });
      return ok();
    }

    if (parts[1] === 'burrito' && parts[2] === 'paths') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      // The real server lists a missing repository as `[]` with HTTP 200 [VERIFIED —
      // pankosmia-web 0.18.15 (a83725b, 2026-09-29), live rig 2026-10-13 and 2026-10-14:
      // GET /api/burrito/paths/_local_/_archive_/tc4-open--nothere → [] 200]. #677's
      // gate reads the scratch listing at every open, so the fake answers the same.
      if (!project) return ok([]);
      return ok([...project.files.keys()].sort());
    }

    if (parts[1] === 'burrito' && parts[2] === 'metadata' && parts[3] === 'raw') {
      const repo = repoAt(4);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      return ok(project.meta);
    }

    if (parts[1] === 'burrito' && parts[2] === 'metadata' && parts[3] === 'remake-ingredients') {
      const repo = repoAt(4);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      const refused = unparseable(project);
      if (refused) return refused;
      rescan(project);
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'new-obs-resource') {
      maybeFail({ method, route });
      const body = JSON.parse(String(init?.body)) as { content_abbr: string; content_name: string; content_language_code: string; content_language_name?: string | null };
      const repoPath = `_local_/_local_/${body.content_abbr}`;
      const refused = languageRefusal(body.content_language_code, body.content_language_name);
      if (refused) return refused;
      if (repos.has(repoPath)) return notFound(`Local content called '${body.content_abbr}' already exists`);
      // The template's ingredients, byte for byte, with the source's titles —
      // the seed form is the client's job (R-10.2.4).
      const project = createRepo(repoPath, obsTemplateFiles(), obsMeta(body, obsTemplateFixed));
      project.commits.push('Initial commit');
      return ok();
    }

    if (parts[1] === 'burrito' && parts[2] === 'metadata' && parts[3] === 'summary') {
      const repo = repoAt(4);
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      return ok(summaryOf(repo, project));
    }

    if (parts[1] === 'burrito' && parts[2] === 'metadata' && parts[3] === 'summaries') {
      const out: Record<string, unknown> = {};
      for (const [repoPath, project] of repos) out[repoPath] = summaryOf(repoPath, project);
      return ok(out);
    }

    if (parts[1] === 'git' && parts[2] === 'add-and-commit') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      const body = JSON.parse(String(init?.body)) as { commit_message: string };
      project.commits.push(body.commit_message); // the real platform commits on a clean tree too (PLATFORM-NOTES #9, #48)
      project.dirty.clear();
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'status') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      return ok([...project.dirty].sort().map((ipath) => ({ path: `ingredients/${ipath}`, change_type: 'modified' })));
    }

    if (parts[1] === 'git' && parts[2] === 'new-text-translation') {
      maybeFail({ method, route });
      const body = JSON.parse(String(init?.body)) as {
        content_abbr: string;
        content_language_code: string;
        content_language_name?: string | null;
        add_book: boolean;
        book_code?: string;
      };
      const repoPath = `_local_/_local_/${body.content_abbr}`;
      const refused = languageRefusal(body.content_language_code, body.content_language_name);
      if (refused) return refused;
      // Checked BEFORE the git init [VERIFIED — pankosmia-web 0.18.5, new_text_translation.rs]
      if (repos.has(repoPath)) return notFound(`Local content called '${body.content_abbr}' already exists`);
      const project = createRepo(repoPath, { 'vrs.json': FAKE_VRS }, baseMeta(body.content_language_code));
      if (body.add_book && body.book_code)
        project.files.set(`${body.book_code.toUpperCase()}.usfm`, SERVER_SKELETON(body.book_code.toUpperCase()));
      rescan(project);
      project.commits.push('Initial commit');
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'new-scripture-book') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      const body = JSON.parse(String(init?.body)) as { book_code: string };
      const code = body.book_code.toUpperCase();
      project.files.set(`${code}.usfm`, SERVER_SKELETON(code));
      rescan(project); // [VERIFIED live]: the endpoint regenerates the metadata
      return ok();
    }

    if (parts[1] === 'temp' && parts[2] === 'bytes') {
      maybeFail({ method, route });
      const file = (init?.body as FormData).get('file') as Blob;
      const uuid = `00000000-0000-4000-8000-${String(temps.size + 1).padStart(12, '0')}`;
      temps.set(uuid, new Uint8Array(await file.arrayBuffer()));
      return ok({ uuid });
    }

    if (parts[1] === 'burrito' && parts[2] === 'remake_burrito_from_zip') {
      const uuid = parts[3];
      const repo = repoAt(4);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound('Repo does not already exist');
      const zip = temps.get(uuid);
      if (!zip) return notFound(`Temp zip with UUID ${uuid} not found`);
      const entries = Object.entries(unzipSync(zip)).filter(([name]) => !name.endsWith('/'));
      // The handler strips one path level; a file at the zip root reaches a panic.
      if (entries.some(([name]) => !name.includes('/'))) return new Response('panic', { status: 500 });
      const unpacked = new Map(entries.map(([name, bytes]) => [name.slice(name.indexOf('/') + 1), new TextDecoder().decode(bytes)]));
      if (!unpacked.has('metadata.json') || ![...unpacked.keys()].some((k) => k.startsWith('ingredients/')))
        return notFound('Zip is not a burrito');
      project.files.clear();
      for (const [rel, text] of unpacked) if (rel.startsWith('ingredients/')) project.files.set(rel.slice('ingredients/'.length), text);
      project.meta = JSON.parse(unpacked.get('metadata.json')!) as Record<string, unknown>;
      project.dirty = new Set(project.files.keys());
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'list-local-repos') {
      // the platform skips these three folders [VERIFIED — pankosmia-web 0.18.15
      // (a83725b) src/endpoints/git2/list_local_repos.rs:48-50, source read 2026-10-14]
      const hidden = ['_local_/_quarantine_/', '_local_/_archive_/', '_local_/_updates_/'];
      return ok([...repos.keys()].filter((p) => !hidden.some((h) => p.startsWith(h))).sort());
    }

    if (parts[1] === 'net' && parts[2] === 'status') {
      return ok({ is_enabled: netEnabled });
    }

    // #676: the git transport of #673 (clone, copy, push) and the remotes
    if (parts[1] === 'git' && parts[2] === 'remotes') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return new Response(JSON.stringify({ is_good: false, reason: `Could not open repo: ${repo}` }), { status: 500 });
      return ok({ is_good: true, payload: { remotes: project.origin ? [{ name: 'origin', url: project.origin }] : [] } });
    }

    if (parts[1] === 'git' && parts[2] === 'branches') {
      const repo = repoAt(3);
      const project = repos.get(repo);
      if (!project) return new Response(JSON.stringify({ is_good: false, reason: `Could not open repo: ${repo}` }), { status: 500 });
      return ok({ is_good: true, payload: { branches: [{ name: project.branch ?? 'main', is_head: true }] } });
    }

    if (parts[1] === 'git' && parts[2] === 'clone-repo') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      if (!netEnabled) return new Response(JSON.stringify({ is_good: false, reason: 'offline mode' }), { status: 401 });
      if (repos.has(repo))
        return notFound(`could not clone repo: '${repo}' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)`);
      const url = `https://${repo}`;
      const remote = remotes.get(url);
      if (!remote) return notFound(`could not clone repo: unexpected http status code: 404; class=Http (34)`);
      repos.set(repo, { files: new Map(remote.files), meta: structuredClone(remote.meta), commits: ['clone'], dirty: new Set(), origin: url, pulled: remote.version, branch: remote.defaultBranch ?? 'main' });
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'copy') {
      const repo = repoAt(3);
      const target = url.searchParams.get('target_path') ?? '';
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound('Source repo not found or not a directory');
      if (repos.has(target)) return notFound('Target repo already exists');
      repos.set(target, copyOf(project));
      if (url.searchParams.get('delete_src') === 'true') repos.delete(repo);
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'push') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      if (!netEnabled) return new Response(JSON.stringify({ is_good: false, reason: 'offline mode' }), { status: 401 });
      const project = repos.get(repo);
      if (!project) return new Response(JSON.stringify({ is_good: false, reason: `Could not open repo: ${repo}` }), { status: 500 });
      const body = JSON.parse(String(init?.body)) as { remote: string };
      const remote = body.remote === 'origin' && project.origin ? remotes.get(project.origin) : undefined;
      if (!remote) return notFound(`Could not find remote ${body.remote}`);
      const fail = (reason: string) => new Response(JSON.stringify({ is_good: false, reason }), { status: 500 });
      if (!remote.writable) return fail('Could not push repo: unexpected http status code: 403; class=Http (34)');
      if (project.pulled !== remote.version)
        return fail('Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)');
      remote.files = new Map(project.files);
      remote.meta = structuredClone(project.meta);
      remote.version += 1;
      project.pulled = remote.version;
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'delete') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      repos.delete(repo);
      return ok();
    }

    // one ingredient directory as one zip, entry names relative to it. Only audio/
    // (#676): the journal suites keep the per-file read they were written for.
    if (parts[1] === 'burrito' && parts[2] === 'ingredient' && parts[3] === 'zipped' && url.searchParams.get('ipath') === 'audio') {
      const repo = repoAt(4);
      const dir = `${decodeURIComponent(url.searchParams.get('ipath') ?? '')}/`;
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
      const entries = Object.fromEntries([...project.files].filter(([p]) => p.startsWith(dir)).map(([p, text]) => [p.slice(dir.length), strToU8(text, true)]));
      if (!Object.keys(entries).length) return notFound('could not locate repo or ingredient directory');
      return new Response(zipSync(entries) as unknown as BodyInit, { status: 200 });
    }

    if (parts[1] === 'app-state' && parts[2] === 'current-project') {
      return ok();
    }

    return new Response(JSON.stringify({ is_good: false, reason: `no such route ${route}` }), {
      status: 404,
    });
  }) as typeof fetch;

  const summaryOf = (repoPath: string, project: RigProject): Record<string, unknown> => ({
    name: repoPath.split('/')[2],
    description: '',
    abbreviation: repoPath.split('/')[2],
    generated_date: '2026-08-19T00:00:00.000Z',
    // The summary's flavor fields are the metadata's; for an OBS project the
    // platform fills book_codes with the scope table's KEYS (the Bible books
    // the stories retell), not with stories [VERIFIED — pankosmia-web 0.18.5,
    // rig, 2026-09-15].
    flavor_type: (project.meta.type as { flavorType: { name: string } }).flavorType.name,
    flavor: flavorOf(project.meta),
    language_code: 'es',
    language_name: 'Español',
    script_direction: 'ltr',
    book_codes:
      flavorOf(project.meta) === 'textStories'
        ? Object.keys((project.meta.type as { flavorType: { currentScope: Record<string, unknown> } }).flavorType.currentScope).sort()
        : [...project.files.keys()]
            .map((p) => /^([A-Z0-9]{3})\.usfm$/.exec(p)?.[1])
            .filter((c): c is string => !!c)
            .sort(),
    timestamp: 0,
  });

  return { repos, writes, log, fetchFn, failOn, createRepo, serveUnfixedObsTemplate, refuseUnknownLanguages, remotes, publish, teammatePush, setNet };
};

export type JournalingRig = ReturnType<typeof journalingRig>;

/** Map-backed KvStore (same shape as the #61 suites). */
export const memKv = (): KvStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    setIfAbsent: async (key, value) => {
      const existing = map.get(key);
      if (existing !== undefined) return existing;
      map.set(key, value);
      return value;
    },
    keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key) => {
      map.delete(key);
    },
  };
};

/** A fixed physical clock tests can advance. */
export const tickingNow = (startIso: string): { now: () => number; advance: (ms: number) => number } => {
  let at = Date.parse(startIso);
  return { now: () => at, advance: (ms: number) => (at += ms) };
};
