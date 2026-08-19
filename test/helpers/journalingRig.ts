// A fake pankosmia-web rig for the issue-#62 store suites: enough of the HTTP
// surface for JournalingStore's full lifecycle (create, scaffold, ingredient
// read/write/list, metadata read + rescan, add-and-commit), with verbatim
// response shapes (isNotFound needs the live 400 ENOENT reason text) and
// per-request FAILURE INJECTION for the crash/atomicity proofs.
//
// The platform behaviors emulated here are the [VERIFIED] ones the product
// code depends on (BURRITO-SPEC §6, PLATFORM-NOTES): whole-file writes, the
// paths listing walking the real tree, new-scripture-book regenerating
// currentScope, remake-ingredients rebuilding the table from disk.
import type { KvStore } from '../../src/data/journal/identity';

export interface RigProject {
  files: Map<string, string>; // ipath -> text
  meta: Record<string, unknown>;
  commits: string[];
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

const baseMeta = (): Record<string, unknown> => ({
  format: 'scripture burrito',
  meta: { category: 'source', normalization: 'NFC' },
  type: { flavorType: { name: 'scripture', currentScope: {} as Record<string, string[]> } },
  ingredients: {},
});

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
  (project.meta.type as { flavorType: { currentScope: unknown } }).flavorType.currentScope = scope;
  project.meta.ingredients = ingredients;
};

export const journalingRig = () => {
  const repos = new Map<string, RigProject>();
  const writes: Array<{ repo: string; ipath: string; payload: string }> = [];
  const log: Array<{ method: string; route: string }> = [];
  const failures: FailureRule[] = [];

  const failOn = (match: FailureRule['match'], times = 1): void => {
    failures.push({ match, times });
  };

  const createRepo = (repoPath: string, files: Record<string, string> = {}): RigProject => {
    const project: RigProject = { files: new Map(Object.entries(files)), meta: baseMeta(), commits: [] };
    rescan(project);
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
      project.files.set(ipath, body.payload);
      writes.push({ repo, ipath, payload: body.payload });
      if (url.searchParams.has('update_ingredients')) rescan(project);
      return ok();
    }

    if (parts[1] === 'burrito' && parts[2] === 'paths') {
      const repo = repoAt(3);
      maybeFail({ method, route, repo });
      const project = repos.get(repo);
      if (!project) return notFound(`no such repo ${repo}`);
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
      rescan(project);
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
      project.commits.push(body.commit_message);
      return ok();
    }

    if (parts[1] === 'git' && parts[2] === 'new-text-translation') {
      maybeFail({ method, route });
      const body = JSON.parse(String(init?.body)) as {
        content_abbr: string;
        add_book: boolean;
        book_code?: string;
      };
      const repoPath = `_local_/_local_/${body.content_abbr}`;
      if (repos.has(repoPath)) return notFound(`repo ${repoPath} exists`);
      const project = createRepo(repoPath, { 'vrs.json': FAKE_VRS });
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

    if (parts[1] === 'git' && parts[2] === 'list-local-repos') {
      return ok([...repos.keys()].sort());
    }

    if (parts[1] === 'git' && parts[2] === 'delete') {
      const repo = repoAt(3);
      repos.delete(repo);
      return ok();
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
    flavor_type: 'scripture',
    flavor: 'textTranslation',
    language_code: 'es',
    language_name: 'Español',
    script_direction: 'ltr',
    book_codes: [...project.files.keys()]
      .map((p) => /^([A-Z0-9]{3})\.usfm$/.exec(p)?.[1])
      .filter((c): c is string => !!c)
      .sort(),
    timestamp: 0,
  });

  return { repos, writes, log, fetchFn, failOn, createRepo };
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
