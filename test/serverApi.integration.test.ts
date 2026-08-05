// serverApi integration tests — run against the LIVE pankosmia rig
// (http://127.0.0.1:19998, /api). The rig is detected up front; without it the
// live suite is skipped with a clear message (TEST-PLAN accepts rig-dependent
// integration rows — CI may not have the rig). Client-side sanitization tests
// need no rig and always run.
//
// The suite creates its own uniquely-named project and leaves it behind
// (the journey suite reseeds the rig later).
import { describe, expect, it } from 'vitest';
import {
  ServerApi,
  ServerApiError,
  type NewTextTranslationParams,
} from '../src/data/serverApi';

const BASE = 'http://127.0.0.1:19998/api';
const SLOW = 30_000;

const rigUp = await (async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
})();

if (!rigUp) {
  console.warn(
    `[serverApi.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped ` +
      '(rig-dependent integration rows are accepted by the TEST-PLAN; start the rig to run them).',
  );
}

// ---------------------------------------------------------------------------
// Client-side sanitization (no rig needed — requests are refused before fetch)
// ---------------------------------------------------------------------------

describe('serverApi client-side sanitization', () => {
  const api = new ServerApi({ baseUrl: BASE });

  it('rejects traversal, dot-prefixed, and special-character ipaths (PLATFORM-NOTES #6)', async () => {
    await expect(api.readIngredient('_local_/_local_/x', '../metadata.json')).rejects.toThrow(
      ServerApiError,
    );
    await expect(api.readIngredient('_local_/_local_/x', '.hidden/x.json')).rejects.toThrow(
      /unsafe path segment/,
    );
    await expect(api.readIngredient('_local_/_local_/x', 'a b.usfm')).rejects.toThrow(
      /unsafe path segment/,
    );
    await expect(api.readIngredient('_local_/_local_/x', 'a&b.usfm')).rejects.toThrow(
      ServerApiError,
    );
    await expect(api.readIngredient('_local_/_local_/x', 'a?b.usfm')).rejects.toThrow(
      ServerApiError,
    );
    await expect(api.readIngredient('_local_/_local_/x', 'a:b.usfm')).rejects.toThrow(
      ServerApiError,
    );
    await expect(api.readIngredient('_local_/_local_/x', 'checking//x.json')).rejects.toThrow(
      ServerApiError,
    );
  });

  it('rejects malformed repo paths', async () => {
    await expect(api.getSummary('_local_/only-two')).rejects.toThrow(/3 segments/);
    await expect(api.getSummary('_local_/_local_/../etc')).rejects.toThrow(ServerApiError);
    await expect(api.getSummary('_local_/_local_/name with space')).rejects.toThrow(
      ServerApiError,
    );
    await expect(api.getSummary('_local_/_local_/a?b')).rejects.toThrow(ServerApiError);
  });

  it('client-side refusals carry status 0 (never sent)', async () => {
    const error = await api
      .readIngredient('_local_/_local_/x', '../metadata.json')
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ServerApiError);
    expect((error as ServerApiError).status).toBe(0);
  });

  it('refuses a non-string ingredient payload before sending (PLATFORM-NOTES #6/#7)', async () => {
    await expect(
      api.writeIngredient(
        '_local_/_local_/x',
        'checking/settings.json',
        // @ts-expect-error -- deliberately wrong payload type: the endpoint requires {"payload": "<string>"}
        { schemaVersion: 1 },
        {},
      ),
    ).rejects.toThrow(/payload must be a string/);
  });

  it("requires add_cv to be a real boolean when add_book is true (a null crashes the server's request thread)", async () => {
    const params = {
      content_name: 'x',
      content_abbr: 'x_abbr',
      content_language_code: 'es',
      content_language_name: 'Spanish',
      add_book: true,
      book_code: 'TIT',
      book_title: 'Tito',
      book_abbr: 'Tit',
      add_cv: null,
      versification: 'eng',
    } as unknown as NewTextTranslationParams;
    await expect(api.newTextTranslation(params)).rejects.toThrow(/add_cv must be a real boolean/);
  });

  it("requires content_language_name for custom 'x-' language codes", async () => {
    await expect(
      api.newTextTranslation({
        content_name: 'x',
        content_abbr: 'x_abbr',
        content_language_code: 'x-mylang',
        content_language_name: null,
        add_book: false,
        versification: 'eng',
      }),
    ).rejects.toThrow(/content_language_name is REQUIRED/);
  });
});

// ---------------------------------------------------------------------------
// Live-rig suite
// ---------------------------------------------------------------------------

const RUN = Date.now();
const ABBR = `inc1sa_${RUN}`;
const REPO = `_local_/_local_/${ABBR}`;

const createParams: NewTextTranslationParams = {
  content_name: `Inc1 serverApi test ${RUN}`,
  content_abbr: ABBR,
  // NOTE: the server validates non-'x-' codes against its BCP47 lookup table;
  // 'es-419' is REJECTED at 0.18.5 while 'es' is accepted [VERIFIED live].
  content_language_code: 'es',
  content_language_name: 'Spanish',
  add_book: true,
  book_code: 'TIT',
  book_title: 'Tito',
  book_abbr: 'Tit',
  add_cv: true,
  versification: 'eng',
};

describe.skipIf(!rigUp)('serverApi against the live rig', () => {
  const api = new ServerApi({ baseUrl: BASE });

  it('GET /version reports the platform version', async () => {
    const version = await api.getVersion();
    expect(typeof version.pkg_version).toBe('string');
  });

  it(
    'new-text-translation scaffolds a conforming burrito (scope TIT; vrs.json + TIT.usfm registered)',
    async () => {
      await api.newTextTranslation(createParams);
      const metadata = await api.getMetadataRaw(REPO);
      expect(Object.keys(metadata.type.flavorType.currentScope)).toContain('TIT');
      const ingredientPaths = Object.keys(metadata.ingredients);
      expect(ingredientPaths).toContain('ingredients/TIT.usfm');
      expect(ingredientPaths).toContain('ingredients/vrs.json');
    },
    SLOW,
  );

  it('list-local-repos and the org-filtered summaries both carry the new repo', async () => {
    expect(await api.listLocalRepos()).toContain(REPO);
    const summaries = await api.getSummaries('_local_/_local_');
    expect(Object.keys(summaries)).toContain(REPO);
    // the org filter excludes the sideloaded resources server-side
    expect(Object.keys(summaries).some((k) => k.includes('_sideloaded_'))).toBe(false);
    expect(summaries[REPO].flavor).toBe('textTranslation');
    expect(summaries[REPO].book_codes).toContain('TIT');
  });

  it('reads the skeleton ingredient (platform ___ stubs; ipath relative to ingredients/)', async () => {
    const usfm = await api.readIngredient(REPO, 'TIT.usfm');
    expect(usfm).toContain('\\v 1 ___');
    expect(usfm).toContain('\\c 3'); // eng versification: Titus has 3 chapters
  });

  it('writeIngredient with presence-only flags round-trips the exact bytes', async () => {
    const payload = JSON.stringify({ schemaVersion: 1, probe: `serverApi ${RUN}` });
    await api.writeIngredient(REPO, 'checking/settings.json', payload, {
      updateIngredients: true,
      keepBak: false,
    });
    expect(await api.readIngredient(REPO, 'checking/settings.json')).toBe(payload);
    // update_ingredients registered the sidecar in the metadata
    const metadata = await api.getMetadataRaw(REPO);
    expect(Object.keys(metadata.ingredients)).toContain('ingredients/checking/settings.json');
  });

  it('a missing ingredient read throws a ServerApiError whose isNotFound is true', async () => {
    const error = await api
      .readIngredient(REPO, 'checking/does-not-exist.json')
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ServerApiError);
    const apiError = error as ServerApiError;
    // the server answers 400 + an ENOENT reason for missing files [VERIFIED live 0.18.5]
    expect(apiError.status).toBe(400);
    expect(apiError.isNotFound).toBe(true);
  });

  it(
    'duplicate create fails with a typed error carrying status 400 + the server reason (test 8)',
    async () => {
      const error = await api.newTextTranslation(createParams).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ServerApiError);
      const apiError = error as ServerApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.reason).toMatch(/already exists/);
    },
    SLOW,
  );

  it(
    'new-scripture-book scaffolds AND registers the book (metadata regenerated; NO commit — callers add-and-commit)',
    async () => {
      await api.newScriptureBook(REPO, {
        book_code: 'JON',
        book_title: 'Jonás',
        book_abbr: 'Jon',
        add_cv: true,
      });
      const metadata = await api.getMetadataRaw(REPO);
      expect(Object.keys(metadata.type.flavorType.currentScope).sort()).toEqual(['JON', 'TIT']);
      expect(Object.keys(metadata.ingredients)).toContain('ingredients/JON.usfm');
    },
    SLOW,
  );

  it(
    'add-and-commit succeeds, and an immediate re-commit with nothing pending also succeeds (test 7)',
    async () => {
      await expect(api.addAndCommit(REPO, 'inc1 serverApi checkpoint')).resolves.toBeUndefined();
      // Documented actual behavior [VERIFIED live 0.18.5]: an empty commit is
      // NOT an error — the endpoint answers {"is_good":true,"reason":"ok"}.
      await expect(
        api.addAndCommit(REPO, 'inc1 serverApi empty checkpoint'),
      ).resolves.toBeUndefined();
    },
    SLOW,
  );

  it('versifications: the list carries eng; the eng scheme covers TIT', async () => {
    expect(await api.getVersifications()).toContain('eng');
    const eng = await api.getVersification('eng');
    expect(Object.keys(eng.maxVerses)).toContain('TIT');
    expect(eng.maxVerses.TIT).toEqual(['16', '15', '15']);
  });

  it('app-state current-project accepts the repo path', async () => {
    await expect(api.setCurrentProject(REPO)).resolves.toBeUndefined();
  });
});
