// ServerApi — typed fetch wrappers over the pankosmia-web HTTP surface
// (checklist C3.1; routes per docs/ARCHITECTURE.md §3.1, all [VERIFIED] live at
// pankosmia-web 0.18.5 (99fd9be, 2026-07-30) against the dev rig).
//
// This module encodes the platform write policy ONCE (BURRITO-SPEC §6 W-1..W-3):
//   - Writes are POST /burrito/ingredient/raw/<repoPath>?ipath=…&<flags> with
//     body {"payload": "<string>"}. The payload is ALWAYS a string — JSON
//     sidecars are stringified by the caller. Never send a missing or
//     non-string payload (PLATFORM-NOTES #6/#7).
//   - `update_ingredients` and `no_bak` are PRESENCE-ONLY query flags. They are
//     appended bare (never `=true`).
//   - `no_bak` presence SKIPS the `.bak` backup. The handler's own doc-comment
//     describes the inverse [VERIFIED — pankosmia-web 0.18.5 (99fd9be), 2026-08-04;
//     PLATFORM-NOTES #8]. So `keepBak: true` maps to OMITTING the flag.
//     The `.bak` file is the only undo.
//
// The base path defaults to '/api': the dev server proxies it to the rig
// (vite.config.js), and the built client is served same-origin by the platform.
// Tests inject an absolute base (no vite proxy under vitest/node).

export interface PostResult {
  is_good: boolean;
  reason: string;
}

/** One entry of GET /burrito/metadata/summaries (server field names verbatim). */
export interface RepoSummary {
  name: string;
  description: string;
  abbreviation: string;
  generated_date: string;
  flavor_type: string;
  flavor: string;
  language_code: string;
  language_name: string;
  /** May be "?" — app-created projects carry no readable direction [VERIFIED live 0.18.5]. */
  script_direction: string;
  book_codes: string[];
  timestamp: number;
}

/** One repo as the platform's gitea catalog reports it
 * (`GET /gitea/remote-repos/<server>/<org>`) [VERIFIED live 2026-08-03 against
 * git.door43.org/unfoldingword: 66 repos, 17 carrying the `tc-ready` topic].
 * `book_codes` is the platform-supplied per-book coverage — the input the
 * (tool, book) resolver needs, with no TSV scanning. `branch_or_tag` is the
 * catalog's default ref (`master`), NOT a release tag: pins come from the
 * release tag + SHA (D23b), so never pin `branch_or_tag`. */
export interface RemoteRepo {
  name: string;
  abbreviation: string;
  description: string;
  flavor: string;
  flavor_type: string;
  language_code: string;
  script_direction: string;
  branch_or_tag: string;
  released: string;
  clone_url: string;
  updated_at: string;
  latest_zip: string;
  metadata_types: string;
  topics: string[];
  book_codes: string[];
}

/** The DCS topic that marks a repo as usable by translationCore-family tools.
 * Pankosmia's own download UI filters on this plus `pushing2sb` [VERIFIED —
 * core-client-rcl PanDownload default `topicsFilter`]. */
export const TC_READY_TOPIC = 'tc-ready';

/** Loosely-typed Scripture Burrito metadata.json (only the fields tC4 reads). */
export interface BurritoMetadata {
  ingredients: Record<
    string,
    {
      checksum?: { md5?: string };
      size?: number;
      mimeType?: string;
      role?: string;
      scope?: Record<string, string[]>;
    }
  >;
  type: {
    flavorType: {
      name: string;
      currentScope: Record<string, string[]>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** GET /content-utils/versification/<name> (platform vrs-to-JSON shape). */
export interface VersificationScheme {
  maxVerses: Record<string, string[]>;
  mappedVerses?: Record<string, unknown>;
  excludedVerses?: unknown;
  partialVerses?: unknown;
  [key: string]: unknown;
}

export interface ServerVersionInfo {
  pkg_version: string;
  [key: string]: unknown;
}

/** POST /git/new-text-translation payload (docs/ARCHITECTURE.md §3.1, D25). */
export interface NewTextTranslationParams {
  content_name: string;
  /** Becomes the repo directory name under _local_/_local_/ — validated as a path segment. */
  content_abbr: string;
  content_language_code: string;
  /** REQUIRED non-null only when content_language_code starts with 'x-'.
   * Non-custom codes must exist in the server's BCP47 lookup table — e.g.
   * 'es-419' is REJECTED at 0.18.5; 'es' is accepted [VERIFIED live]. */
  content_language_name?: string | null;
  add_book: boolean;
  book_code?: string;
  book_title?: string;
  book_abbr?: string;
  /** MUST be a real boolean whenever add_book is true: the server unwraps it,
   * and a null crashes the request thread. */
  add_cv?: boolean;
  /** tC4 default 'eng'; list from GET /content-utils/versifications (D25). */
  versification: string;
}

/** POST /git/new-scripture-book/<repoPath> payload. This endpoint does NOT
 * commit (verified against source — the upstream code comment is misleading):
 * callers must add-and-commit at their next checkpoint (W-4). It DOES
 * regenerate the metadata (the new book is registered) [VERIFIED live]. */
export interface NewScriptureBookParams {
  book_code: string;
  book_title: string;
  book_abbr: string;
  add_cv: boolean;
  vrs_name?: string;
}

export interface WriteIngredientFlags {
  /** Presence-only `update_ingredients`: registers the file and refreshes its
   * recorded md5 via a full rescan. NOTE the rescan wipes all `x-` roles —
   * the accepted condition (D28 addendum; no metadata-write route exists). */
  updateIngredients?: boolean;
  /** true (default) OMITS `no_bak` so the write keeps the `.bak` undo;
   * false appends `no_bak`, which SKIPS the backup (PLATFORM-NOTES #8, W-3). */
  keepBak?: boolean;
}

/** Typed failure for every server interaction. `status` 0 means the request
 * was refused client-side (sanitization) and never sent. */
export class ServerApiError extends Error {
  readonly route: string;
  readonly status: number;
  readonly reason: string;

  constructor(route: string, status: number, reason: string) {
    super(`${route} failed (HTTP ${status}): ${reason}`);
    this.name = 'ServerApiError';
    this.route = route;
    this.status = status;
    this.reason = reason;
  }

  /** True when the failure means "this ingredient file does not exist".
   * The server answers HTTP 400 with an ENOENT reason [VERIFIED live 0.18.5]:
   * {"is_good":false,"reason":"could not read ingredient content: No such
   * file or directory (os error 2)"}. 404 is accepted too, defensively. */
  get isNotFound(): boolean {
    return (
      (this.status === 400 || this.status === 404) &&
      /No such file or directory/i.test(this.reason)
    );
  }
}

// ---------------------------------------------------------------------------
// Path sanitization (client-side, before any request is built).
// The server's own sanitizer rejects dot-prefixed segments and many special
// characters (PLATFORM-NOTES #6, BURRITO-SPEC §2); we refuse the same class of input
// here so a bad path is a typed client error, never a surprise server 500.
// ---------------------------------------------------------------------------

const FORBIDDEN_SEGMENT_CHARS = /[\s&?:#%\\*"'<>|]/;

const assertSafeSegment = (segment: string, where: string): void => {
  if (segment.length === 0 || segment.startsWith('.') || FORBIDDEN_SEGMENT_CHARS.test(segment)) {
    throw new ServerApiError(where, 0, `unsafe path segment ${JSON.stringify(segment)}`);
  }
};

/** Validate a repo path (`_local_/_local_/<abbr>` app-created,
 * `_local_/_sideloaded_/<name>` sideloaded) and return its segments. */
export const assertRepoPath = (repoPath: string): string[] => {
  const segments = repoPath.split('/');
  if (segments.length !== 3) {
    throw new ServerApiError(
      repoPath,
      0,
      `repo path must have exactly 3 segments (<src>/<org>/<name>), got ${JSON.stringify(repoPath)}`,
    );
  }
  for (const segment of segments) assertSafeSegment(segment, `repo path ${JSON.stringify(repoPath)}`);
  return segments;
};

/** Validate an ingredient path (relative to ingredients/) and return its segments. */
export const assertIpath = (ipath: string): string[] => {
  const segments = ipath.split('/');
  for (const segment of segments) assertSafeSegment(segment, `ipath ${JSON.stringify(ipath)}`);
  return segments;
};

const encodeSegments = (segments: string[]): string => segments.map(encodeURIComponent).join('/');

const encodeRepoPath = (repoPath: string): string => encodeSegments(assertRepoPath(repoPath));

const encodeIpath = (ipath: string): string => encodeSegments(assertIpath(ipath));

const reasonFromBody = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { reason?: unknown };
    if (parsed && typeof parsed.reason === 'string') return parsed.reason;
  } catch {
    // not a JSON body — fall through to the raw text
  }
  return text.slice(0, 200) || '(empty body)';
};

export interface ServerApiInit {
  /** Default '/api' (same-origin / dev proxy). Tests pass the rig's absolute base. */
  baseUrl?: string;
  /** Injectable fetch for tests/mocks; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export class ServerApi {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(init: ServerApiInit = {}) {
    this.base = (init.baseUrl ?? '/api').replace(/\/+$/, '');
    // Wrap the global fetch so it is never invoked unbound (browsers throw).
    this.fetchFn = init.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  // ---- transport core -----------------------------------------------------

  private async requestText(route: string, init?: RequestInit): Promise<string> {
    const response = await this.fetchFn(`${this.base}${route}`, init);
    const text = await response.text();
    if (!response.ok) throw new ServerApiError(route, response.status, reasonFromBody(text));
    return text;
  }

  private async requestJson<T>(route: string, init?: RequestInit): Promise<T> {
    return JSON.parse(await this.requestText(route, init)) as T;
  }

  /** POST and enforce the verified success shape {"is_good": true, "reason": "ok"}:
   * throws ServerApiError on !ok AND on is_good:false, carrying status + reason. */
  private async post(route: string, body?: unknown): Promise<void> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const text = await this.requestText(route, init);
    let result: PostResult;
    try {
      result = JSON.parse(text) as PostResult;
    } catch {
      throw new ServerApiError(route, 200, `unparseable POST response body: ${text.slice(0, 200)}`);
    }
    if (!result.is_good) throw new ServerApiError(route, 200, result.reason ?? 'is_good: false');
  }

  // ---- read surface --------------------------------------------------------

  /** GET /version — also the tests' rig-liveness probe. */
  getVersion(): Promise<ServerVersionInfo> {
    return this.requestJson('/version');
  }

  /** GET /git/list-local-repos → repo paths like _local_/_local_/<abbr>. */
  listLocalRepos(): Promise<string[]> {
    return this.requestJson('/git/list-local-repos');
  }

  /** POST /git/delete/<repoPath>. Used ONLY to clean up a repo this client
   * itself just failed to create (PLATFORM-NOTES #28: new-text-translation
   * git-inits BEFORE it validates, so a rejected creation leaves debris that
   * blocks a retry with the same name). Callers MUST guard on
   * did-not-exist-before-our-attempt. */
  async deleteRepo(repoPath: string): Promise<void> {
    await this.post(`/git/delete/${encodeRepoPath(repoPath)}`);
  }

  /** GET /burrito/metadata/summaries[?org=<org>] → { "<repoPath>": summary }.
   * The org filter works server-side [VERIFIED live: org=_local_/_local_
   * excludes the _sideloaded_ resources]. */
  async getSummaries(org?: string): Promise<Record<string, RepoSummary>> {
    let query = '';
    if (org !== undefined) {
      const segments = org.split('/');
      for (const segment of segments) assertSafeSegment(segment, `org ${JSON.stringify(org)}`);
      query = `?org=${encodeSegments(segments)}`;
    }
    return this.requestJson(`/burrito/metadata/summaries${query}`);
  }

  /** GET /burrito/metadata/summary/<repoPath>. */
  async getSummary(repoPath: string): Promise<RepoSummary> {
    return this.requestJson(`/burrito/metadata/summary/${encodeRepoPath(repoPath)}`);
  }

  /** GET /burrito/metadata/raw/<repoPath> — the full metadata.json. */
  async getMetadataRaw(repoPath: string): Promise<BurritoMetadata> {
    return this.requestJson(`/burrito/metadata/raw/${encodeRepoPath(repoPath)}`);
  }

  /** GET /burrito/ingredient/raw/<repoPath>?ipath=<p> — always returned as the
   * file's exact text; JSON callers parse it themselves. A missing file throws
   * a ServerApiError whose isNotFound is true. */
  async readIngredient(repoPath: string, ipath: string): Promise<string> {
    return this.requestText(
      `/burrito/ingredient/raw/${encodeRepoPath(repoPath)}?ipath=${encodeIpath(ipath)}`,
    );
  }

  /** GET /burrito/paths/<repoPath> — every FILE under the repo's ingredients/
   * directory as ingredient-relative paths (not the indexed ingredients table,
   * so files written without update_ingredients DO appear). Hidden files/dirs
   * and .bak files are skipped by the server. [VERIFIED — source read,
   * pankosmia-web 0.18.5 (99fd9be, 2026-07-30),
   * src/endpoints/burrito2/get_repo_file_paths.rs: WalkDir over
   * <repo>/ingredients/, returns a JSON array; live-rig behavior is exercised
   * by test/journalStore.integration.test.ts.] */
  async listPaths(repoPath: string): Promise<string[]> {
    return this.requestJson(`/burrito/paths/${encodeRepoPath(repoPath)}`);
  }

  // ---- write surface (W-1..W-3 encoded here, once) --------------------------

  /** POST /burrito/ingredient/raw/<repoPath>?ipath=…&<presence-only flags>,
   * body {"payload": string}. See the module header for the flag semantics. */
  async writeIngredient(
    repoPath: string,
    ipath: string,
    payload: string,
    flags: WriteIngredientFlags = {},
  ): Promise<void> {
    if (typeof payload !== 'string') {
      // PLATFORM-NOTES #6/#7: the endpoint requires {"payload": "<string>"}; JSON is
      // stringified by the caller. Refuse anything else before it leaves the client.
      throw new ServerApiError(
        `/burrito/ingredient/raw/…?ipath=${ipath}`,
        0,
        `payload must be a string (got ${typeof payload}) — stringify JSON sidecars before writing`,
      );
    }
    const queryParts = [`ipath=${encodeIpath(ipath)}`];
    if (flags.updateIngredients) queryParts.push('update_ingredients'); // presence-only, never =true
    if (flags.keepBak === false) queryParts.push('no_bak'); // presence SKIPS the .bak (PLATFORM-NOTES #8)
    await this.post(
      `/burrito/ingredient/raw/${encodeRepoPath(repoPath)}?${queryParts.join('&')}`,
      { payload },
    );
  }

  /** POST /burrito/ingredient/delete/<repoPath>?ipath=… — remove one file.
   * The server RENAMES the file to `<name>.bak` rather than unlinking it
   * [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30):
   * `endpoints/burrito2/post_delete_ingredient.rs`], and `.bak` files are
   * hidden from `/burrito/paths` (see listPaths above) — so a delete is
   * complete from the client's point of view and the `.bak` is the undo. */
  async deleteIngredient(repoPath: string, ipath: string): Promise<void> {
    await this.post(
      `/burrito/ingredient/delete/${encodeRepoPath(repoPath)}?ipath=${encodeIpath(ipath)}`,
    );
  }

  /** POST /burrito/metadata/remake-ingredients/<repoPath> — full rescan.
   * NOTE: wipes every `x-` role, permanently, by design (D28/W-2). */
  async remakeIngredients(repoPath: string): Promise<void> {
    await this.post(`/burrito/metadata/remake-ingredients/${encodeRepoPath(repoPath)}`);
  }

  /** POST /git/add-and-commit/<repoPath> — sweeps ALL pending changes (W-4).
   * A commit with nothing pending also succeeds [VERIFIED live 0.18.5]. */
  async addAndCommit(repoPath: string, commitMessage: string): Promise<void> {
    await this.post(`/git/add-and-commit/${encodeRepoPath(repoPath)}`, {
      commit_message: commitMessage,
    });
  }

  /** POST /git/new-text-translation — stamps the template repo, writes
   * ingredients/vrs.json from `versification`, scaffolds the book from
   * maxVerses when add_book, and makes the initial commit (D25). */
  async newTextTranslation(params: NewTextTranslationParams): Promise<void> {
    assertSafeSegment(params.content_abbr, `content_abbr ${JSON.stringify(params.content_abbr)}`);
    if (params.content_language_code.startsWith('x-') && !params.content_language_name) {
      throw new ServerApiError(
        '/git/new-text-translation',
        0,
        "content_language_name is REQUIRED (non-null) when content_language_code starts with 'x-'",
      );
    }
    if (params.add_book) {
      if (typeof params.add_cv !== 'boolean') {
        // The server unwraps add_cv when add_book is true; a null crashes the
        // request thread. Refuse client-side.
        throw new ServerApiError(
          '/git/new-text-translation',
          0,
          'add_cv must be a real boolean whenever add_book is true',
        );
      }
      if (!params.book_code) {
        throw new ServerApiError(
          '/git/new-text-translation',
          0,
          'book_code is required when add_book is true',
        );
      }
    }
    await this.post('/git/new-text-translation', {
      content_name: params.content_name,
      content_abbr: params.content_abbr,
      content_language_code: params.content_language_code,
      content_language_name: params.content_language_name ?? null,
      add_book: params.add_book,
      book_code: params.book_code ?? '',
      book_title: params.book_title ?? '',
      book_abbr: params.book_abbr ?? '',
      add_cv: params.add_cv ?? false,
      versification: params.versification,
      branch_name: null,
    });
  }

  /** POST /git/new-scripture-book/<repoPath> — scaffolds the book and
   * regenerates the metadata, but does NOT commit (see NewScriptureBookParams). */
  async newScriptureBook(repoPath: string, params: NewScriptureBookParams): Promise<void> {
    await this.post(`/git/new-scripture-book/${encodeRepoPath(repoPath)}`, params);
  }

  /** GET /content-utils/versifications — the six scheme names (eng is the tC4 default). */
  getVersifications(): Promise<string[]> {
    return this.requestJson('/content-utils/versifications');
  }

  /** GET /content-utils/versification/<name> — one full scheme. */
  async getVersification(name: string): Promise<VersificationScheme> {
    assertSafeSegment(name, `versification name ${JSON.stringify(name)}`);
    return this.requestJson(`/content-utils/versification/${encodeURIComponent(name)}`);
  }

  /** POST /app-state/current-project/<repoPath> — how the shell learns which
   * project is open. */
  async setCurrentProject(repoPath: string): Promise<void> {
    await this.post(`/app-state/current-project/${encodeRepoPath(repoPath)}`);
  }

  /** GET /client-settings/<storage_id> — per-client USER-MACHINE storage
   * (0.18.4; inside the Increment-1 pin — D31). Used for UI state that
   * belongs to this machine, never to the project (e.g. last-used ordering).
   * Returns {} when nothing is stored. Requires the client to ship a
   * storage_id.json in its rig registration. */
  async getClientSettings(storageId: string): Promise<Record<string, unknown>> {
    assertSafeSegment(storageId, `storage id ${JSON.stringify(storageId)}`);
    return this.requestJson(`/client-settings/${encodeURIComponent(storageId)}`);
  }

  /** POST /client-settings/<storage_id> body {"settings": {...}} — the value
   * must be a JSON object (verified server contract, clients.rs 0.18.5). */
  async setClientSettings(storageId: string, settings: Record<string, unknown>): Promise<void> {
    assertSafeSegment(storageId, `storage id ${JSON.stringify(storageId)}`);
    await this.post(`/client-settings/${encodeURIComponent(storageId)}`, { settings });
  }

  // ---- net gate + remote catalog (Increment 2 / J3) -------------------------

  /** GET /net/status → whether the platform will make outbound requests.
   * The rig boots net-DISABLED (`NET_IS_ENABLED` defaults false), and every
   * gitea route answers `{"is_good":false,"reason":"offline mode"}` until it is
   * on [VERIFIED live 2026-08-03]. This is the offline signal D30.4/D30.5 read:
   * pinned-but-absent + online → fetch; + offline → first-class unavailable. */
  async getNetEnabled(): Promise<boolean> {
    // Response shape is {"is_enabled": bool} [VERIFIED live 0.18.5, 2026-08-03].
    const body = await this.requestJson<{ is_enabled: boolean }>('/net/status');
    return Boolean(body.is_enabled);
  }

  /** POST /net/enable — user-initiated only. Going online is the user's
   * choice, never a side effect of opening a screen. */
  async enableNet(): Promise<void> {
    await this.post('/net/enable');
  }

  /** POST /net/disable. */
  async disableNet(): Promise<void> {
    await this.post('/net/disable');
  }

  /** POST /burrito/zipped/<repo_path> (multipart field `file`) — the GENERAL
   * burrito import [VERIFIED — PLATFORM-NOTES #22/#26]. Contract, all verified:
   * the target MUST start with `_local_/_sideloaded_/`; the target MUST NOT
   * already exist (400 otherwise — delete the local copy first); the archive
   * MUST be UNWRAPPED (metadata.json at the zip root) — the DCS export is
   * wrapped, so callers strip the wrapper. A real sb-zip also needs the
   * deployment's Rocket multipart limits raised (`ROCKET_LIMITS`), or the
   * upload fails at catcher level with an opaque error. */
  async postZippedBurrito(repoPath: string, zipBytes: Uint8Array): Promise<void> {
    const segments = assertRepoPath(repoPath);
    if (segments[1] !== '_sideloaded_') {
      throw new ServerApiError(
        repoPath,
        0,
        `burrito zip import requires a _local_/_sideloaded_/ target, got ${repoPath}`,
      );
    }
    const form = new FormData();
    // Copy into a fresh ArrayBuffer so a Uint8Array view over a larger buffer
    // never uploads its neighbours.
    const copy = new Uint8Array(zipBytes.length);
    copy.set(zipBytes);
    form.append('file', new Blob([copy], { type: 'application/zip' }), 'burrito.zip');
    const text = await this.requestText(`/burrito/zipped/${encodeRepoPath(repoPath)}`, {
      method: 'POST',
      body: form,
    });
    let result: PostResult;
    try {
      result = JSON.parse(text) as PostResult;
    } catch {
      throw new ServerApiError(
        `/burrito/zipped/${repoPath}`,
        200,
        `unparseable import response: ${text.slice(0, 200)}`,
      );
    }
    if (!result.is_good) {
      throw new ServerApiError(`/burrito/zipped/${repoPath}`, 200, result.reason ?? 'is_good: false');
    }
  }

  /** GET /gitea/remote-repos/<server>/<org> — the platform's catalog for ONE
   * organization. There is no catalog-wide search route on 0.18.5, so callers
   * supply the org (see `data/gateways.ts` for why that list is config).
   * Net-gated: throws when the platform is offline. */
  async remoteRepos(server: string, org: string): Promise<RemoteRepo[]> {
    assertSafeSegment(server, `gitea server ${JSON.stringify(server)}`);
    assertSafeSegment(org, `gitea org ${JSON.stringify(org)}`);
    const body = await this.requestJson<RemoteRepo[] | { is_good: false; reason: string }>(
      `/gitea/remote-repos/${encodeURIComponent(server)}/${encodeURIComponent(org)}`,
    );
    if (!Array.isArray(body)) {
      throw new ServerApiError(
        `/gitea/remote-repos/${server}/${org}`,
        200,
        body?.reason ?? 'unexpected catalog response',
      );
    }
    return body;
  }
}
