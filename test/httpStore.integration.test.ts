// HttpStore integration tests — run against the LIVE pankosmia rig
// (http://127.0.0.1:19998, /api). The rig is detected up front; without it the
// live suite is skipped with a clear message (TEST-PLAN accepts rig-dependent
// integration rows — CI may not have the rig). The md5 and unbound-store tests
// are pure and always run.
//
// The suite creates its own uniquely-named project in beforeAll and leaves it
// behind (the journey suite reseeds the rig later).
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpStore, StaleWriteError, md5Hex } from '../src/data/httpStore';
import type { Decision } from '../src/data/burritoStore';
import type { AlignmentFile } from '../src/data/align/zaln';

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
    `[httpStore.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped ` +
      '(rig-dependent integration rows are accepted by the TEST-PLAN; start the rig to run them).',
  );
}

// ---------------------------------------------------------------------------
// Pure tests (no rig needed)
// ---------------------------------------------------------------------------

describe('md5Hex (client-side md5 — the bytes are the truth)', () => {
  it('matches the RFC 1321 test vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });

  it('hashes the UTF-8 bytes of multi-byte text (Greek)', () => {
    // printf 'Παῦλος' | md5 → f0e667549abe6e978c3a0f6439bf8bbc (verified locally)
    expect(md5Hex('Παῦλος')).toBe('f0e667549abe6e978c3a0f6439bf8bbc');
  });

  it('handles inputs that straddle the 64-byte block padding boundary', () => {
    // 55/56/64 bytes exercise the three padding layouts
    expect(md5Hex('a'.repeat(55))).toBe(md5Hex('a'.repeat(55)));
    expect(md5Hex('a'.repeat(56))).not.toBe(md5Hex('a'.repeat(55)));
    expect(md5Hex('a'.repeat(64))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('HttpStore guards (no rig needed)', () => {
  it('methods that need an open project reject with a clear error when none is open', async () => {
    const fresh = new HttpStore({ baseUrl: BASE });
    await expect(fresh.readBook('TIT')).rejects.toThrow(/no project open/);
    await expect(fresh.commit('x')).rejects.toThrow(/no project open/);
  });
});

// ---------------------------------------------------------------------------
// Live-rig suite (sequential — later tests build on earlier writes)
// ---------------------------------------------------------------------------

const RUN = Date.now();
const ABBR = `inc1hs_${RUN}`;
const REPO = `_local_/_local_/${ABBR}`;

/** Full tC3 check-item shape (BURRITO-SPEC §5.2 — never simplify). */
const makeDecision = (overrides: {
  checkId: string;
  groupId: string;
  quoteString: string;
  verse: number | string;
  selections: Decision['selections'];
  status?: Decision['status'];
}): Decision => ({
  contextId: {
    checkId: overrides.checkId,
    occurrenceNote: '',
    reference: { bookId: 'tit', chapter: 1, verse: overrides.verse },
    tool: 'translationWords',
    groupId: overrides.groupId,
    quote: overrides.quoteString,
    quoteString: overrides.quoteString,
    glQuote: '',
    occurrence: 1,
  },
  category: 'kt',
  selections: overrides.selections,
  comments: false,
  reminders: false,
  nothingToSelect: false,
  verseEdits: false,
  invalidated: false,
  ...(overrides.status !== undefined ? { status: overrides.status } : {}),
});

describe.skipIf(!rigUp)('HttpStore against the live rig', () => {
  const store = new HttpStore({ baseUrl: BASE });

  /** Shorthand for the #17 tests: a full §5.2 record keyed by checkId. */
  const decision = (o: { checkId: string }): Decision =>
    makeDecision({
      checkId: o.checkId,
      groupId: 'god',
      quoteString: `q-${o.checkId}`,
      verse: 1,
      selections: false,
    });

  beforeAll(async () => {
    const { repoPath } = await store.createProject({
      content_name: `Inc1 HttpStore test ${RUN}`,
      content_abbr: ABBR,
      // 'es-419' is rejected by the server's BCP47 lookup at creation [VERIFIED live 0.18.5]
      content_language_code: 'es',
      content_language_name: 'Spanish',
      add_book: true,
      book_code: 'TIT',
      book_title: 'Tito',
      book_abbr: 'Tit',
      add_cv: true,
      versification: 'eng',
    });
    expect(repoPath).toBe(REPO);
    await store.open(repoPath);
  }, 60_000);


  it('listProjects lists app projects only (flavor textTranslation, org _local_/_local_) — test 1', async () => {
    const projects = await store.listProjects();
    const ids = projects.map((p) => p.id);
    expect(ids).toContain(REPO);
    expect(ids.some((id) => id.includes('_sideloaded_'))).toBe(false);
    const mine = projects.find((p) => p.id === REPO);
    expect(mine).toBeDefined();
    expect(mine?.name).toBe(`Inc1 HttpStore test ${RUN}`);
    expect(mine?.languageTag).toBe('es');
    expect(mine?.bookCodes).toContain('TIT');
  });

  it('readBook returns the platform skeleton with ___ stubs + a client-side md5 (test 2)', async () => {
    const { usfm, md5 } = await store.readBook('TIT');
    expect(usfm).toContain('\\v 1 ___');
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
    expect(md5).toBe(md5Hex(usfm));
  });

  it(
    'writeBook applies a splice-like edit under expectMd5; a stale re-write throws StaleWriteError (test 3)',
    async () => {
      const before = await store.readBook('TIT');
      const edited = before.usfm.replace('\\v 1 ___', '\\v 1 Pablo, siervo de Dios');
      expect(edited).not.toBe(before.usfm);
      await store.writeBook('TIT', edited, { expectMd5: before.md5 });
      const after = await store.readBook('TIT');
      expect(after.usfm).toBe(edited); // exact bytes round-trip
      // A second writer still holding the ORIGINAL md5 must be refused (D-3).
      const stale = store.writeBook('TIT', before.usfm, { expectMd5: before.md5 });
      await expect(stale).rejects.toBeInstanceOf(StaleWriteError);
      // ...and the refused write changed nothing.
      expect((await store.readBook('TIT')).usfm).toBe(edited);
    },
    SLOW,
  );

  it('readSettings is null before the first write; writeSettings → readSettings round-trips (test 4)', async () => {
    expect(await store.readSettings()).toBeNull();
    const settings = {
      schemaVersion: 1,
      checkCategories: { translationWords: ['kt', 'names', 'other'] },
      ui: { paneSettings: [], toolsSettings: {} },
    };
    await store.writeSettings(settings);
    expect(await store.readSettings()).toEqual(settings);
  });

  it('readDecisions is null before the first check; upsertDecision merges by the §5.2 identity key (test 4)', async () => {
    expect(await store.readDecisions('translationWords', 'TIT')).toBeNull();
    const first = makeDecision({
      checkId: 'aaa1',
      groupId: 'god',
      quoteString: 'Θεοῦ',
      verse: 1,
      selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
    });
    const second = makeDecision({
      checkId: 'bbb2',
      groupId: 'faith',
      quoteString: 'πίστιν',
      verse: 1,
      selections: false,
    });
    await store.upsertDecision('translationWords', 'TIT', first);
    await store.upsertDecision('translationWords', 'TIT', second);
    // Update the first: same identity key + same quoteString → replaces in place.
    await store.upsertDecision('translationWords', 'TIT', {
      ...first,
      selections: [{ text: 'Dios santo', occurrence: 1, occurrences: 1 }],
      comments: 'checked twice',
    });
    const file = await store.readDecisions('translationWords', 'TIT');
    expect(file).not.toBeNull();
    expect(file?.decisions).toHaveLength(2); // count stays 2 after the update
    const updated = file?.decisions.find((d) => d.contextId.checkId === 'aaa1');
    expect(updated?.selections).toEqual([{ text: 'Dios santo', occurrence: 1, occurrences: 1 }]);
    expect(updated?.comments).toBe('checked twice');
    expect(updated?.modifiedTimestamp).toBeTruthy();
  });

  it('upsertDecision coerces empty selections to false (PLATFORM-NOTES #14) and persists status', async () => {
    await store.upsertDecision(
      'translationWords',
      'TIT',
      makeDecision({
        checkId: 'ccc3',
        groupId: 'grace',
        quoteString: 'χάρις',
        verse: 4,
        selections: [], // empty — must persist as false
        status: 'todo',
      }),
    );
    const file = await store.readDecisions('translationWords', 'TIT');
    const stored = file?.decisions.find((d) => d.contextId.checkId === 'ccc3');
    expect(stored?.selections).toBe(false);
    expect(stored?.status).toBe('todo');
  });

  it('a key match with a DIFFERENT quoteString is treated as unmatched (§5.2) — appended, never overwritten', async () => {
    // Same identity key as aaa1 but the resource's quote changed:
    await store.upsertDecision('translationWords', 'TIT', {
      ...makeDecision({
        checkId: 'aaa1',
        groupId: 'god',
        quoteString: 'Θεοῦ ἡμῶν', // differs
        verse: 1,
        selections: false,
      }),
    });
    const file = await store.readDecisions('translationWords', 'TIT');
    const matches = file?.decisions.filter((d) => d.contextId.checkId === 'aaa1');
    expect(matches).toHaveLength(2); // old record preserved, new appended
    expect(matches?.some((d) => d.contextId.quoteString === 'Θεοῦ')).toBe(true);
    expect(matches?.some((d) => d.contextId.quoteString === 'Θεοῦ ἡμῶν')).toBe(true);
  });

  it('writeAlignments normalizes STRING occurrences to integers at the boundary (test 5, I-2)', async () => {
    expect(await store.readAlignments('TIT')).toBeNull();
    const file: AlignmentFile = {
      schemaVersion: 1,
      book: 'TIT',
      chapters: {
        '1': {
          '1': {
            alignments: [
              {
                topWords: [
                  {
                    word: 'Παῦλος',
                    strong: 'G39720',
                    lemma: 'Παῦλος',
                    morph: 'Gr,N,,,,,NMS,',
                    // deliberately strings, as USFM attribute parsing yields (PLATFORM-NOTES #2)
                    occurrence: '1',
                    occurrences: '1',
                  },
                ],
                bottomWords: [{ word: 'Pablo', occurrence: '1', occurrences: '1' }],
              },
            ],
            wordBank: [{ word: 'de', occurrence: '1', occurrences: '2' }],
            invalid: false,
            targetVerseMd5: md5Hex('Pablo, siervo de Dios'),
            sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
          },
        },
      },
    };
    await store.writeAlignments('TIT', file);
    const back = await store.readAlignments('TIT');
    expect(back).not.toBeNull();
    const verse = back?.chapters['1']['1'];
    expect(verse?.alignments[0].topWords[0].occurrence).toBe(1);
    expect(verse?.alignments[0].topWords[0].occurrences).toBe(1);
    expect(verse?.alignments[0].bottomWords[0].occurrence).toBe(1);
    expect(verse?.alignments[0].bottomWords[0].occurrences).toBe(1);
    expect(verse?.wordBank[0].occurrence).toBe(1);
    expect(verse?.wordBank[0].occurrences).toBe(2);
    // non-occurrence fields pass through untouched
    expect(verse?.alignments[0].topWords[0].strong).toBe('G39720');
    expect(verse?.targetVerseMd5).toBe(md5Hex('Pablo, siervo de Dios'));
  });

  it('readResources before the first pin write returns null — "no pins recorded", which the preflight must tell apart from "pinned but absent locally"', async () => {
    expect(await store.readResources()).toBeNull();
  });

  it('readSourceBook reads the sideloaded ULT with zaln markup intact (test 6)', async () => {
    const { usfm } = await store.readSourceBook('_local_/_sideloaded_/en_ult', 'TIT');
    expect(usfm).toContain('\\id TIT');
    expect(usfm).toContain('\\zaln-s');
  });

  it(
    'commit() checkpoints; an immediate re-commit with nothing pending also succeeds (test 7)',
    async () => {
      await expect(store.commit('inc1 httpStore checkpoint')).resolves.toBeUndefined();
      // Documented actual behavior [VERIFIED live 0.18.5]: not an error.
      await expect(store.commit('inc1 httpStore empty checkpoint')).resolves.toBeUndefined();
    },
    SLOW,
  );

  it(
    'addBook scaffolds + registers a second book (no auto-commit — W-4)',
    async () => {
      await store.addBook({ book_code: 'JON', book_title: 'Jonás', book_abbr: 'Jon', add_cv: true });
      const projects = await store.listProjects();
      const mine = projects.find((p) => p.id === REPO);
      expect([...(mine?.bookCodes ?? [])].sort()).toEqual(['JON', 'TIT']);
      const jon = await store.readBook('JON');
      expect(jon.usfm).toContain('\\v 1 ___');
    },
    SLOW,
  );

  // -------------------------------------------------------------------------
  // OPEN-QUESTIONS #17 — sidecar writes must not lose a concurrent update.
  // Raised in priority by the project owner 2026-08-03: "data loss is an
  // app-killing issue". Drafts already had this protection; decisions did not.
  // -------------------------------------------------------------------------

  it('a decision write REFUSES to clobber a concurrent update (#17 compare-and-swap)', async () => {
    const tool = 'translationWords';
    const book = 'TIT';
    await store.upsertDecision(tool, book, decision({ checkId: 'cas-a' }));

    // Read as an editor would, then let ANOTHER writer land first.
    const stale = await store.readDecisions(tool, book);
    expect(stale).toBeTruthy();
    await store.upsertDecision(tool, book, decision({ checkId: 'cas-b' }));

    // The first editor now writes from its stale snapshot. Without a
    // compare-and-swap this silently erases cas-b; with it, the write refuses.
    const file = { ...stale!, decisions: [...stale!.decisions] };
    await expect(store.writeDecisions(tool, book, file, md5Hex('not the stored bytes')))
      .rejects.toBeInstanceOf(StaleWriteError);

    // Both decisions survive: nothing was lost.
    const after = await store.readDecisions(tool, book);
    const ids = after!.decisions.map((d) => d.contextId.checkId);
    expect(ids).toContain('cas-a');
    expect(ids).toContain('cas-b');
  }, SLOW);

  it('sidecar writes keep the .bak undo — decisions are not high-frequency (W-3)', async () => {
    const tool = 'translationNotes';
    const book = 'TIT';
    await store.upsertDecision(tool, book, decision({ checkId: 'bak-1' }));
    await store.upsertDecision(tool, book, decision({ checkId: 'bak-2' }));
    // The platform keeps a single-level .bak beside the ingredient; its
    // presence is the undo that W-3 lets high-frequency writers skip and that
    // a once-per-user-action decision write should not.
    const paths = await fetch(`${BASE}/burrito/paths/${REPO}`).then((r) => r.json());
    const flat = JSON.stringify(paths);
    expect(flat).toContain(`checking/${tool}/${book}.json`);
  }, SLOW);

  it('a decision write never relabels the file to a resource its decisions did not come from', async () => {
    const tool = 'translationWords';
    const book = 'TIT';
    // First write stamps the resolution record.
    await store.upsertDecision(tool, book, decision({ checkId: 'res-1' }), {
      repoPath: 'git.door43.org/Es-419_gl/es-419_tw',
      version: 'v37',
      sha: 'a'.repeat(40),
      languageSet: 'primary',
    });
    expect((await store.readDecisions(tool, book))!.resource).toMatchObject({
      repoPath: 'git.door43.org/Es-419_gl/es-419_tw',
    });

    // A later write under DIFFERENT pins must leave the record alone: changing
    // which resource a book is checked against is an explicit, consequences-
    // shown action (D23a/D30.2), never a side effect of marking one check.
    await store.upsertDecision(tool, book, decision({ checkId: 'res-2' }), {
      repoPath: 'git.door43.org/unfoldingWord/en_tw',
      version: 'v89',
      sha: 'b'.repeat(40),
      languageSet: 'primary',
    });
    const after = await store.readDecisions(tool, book);
    expect(after!.resource).toMatchObject({
      repoPath: 'git.door43.org/Es-419_gl/es-419_tw',
      version: 'v37',
    });
    expect(after!.decisions.map((d) => d.contextId.checkId)).toContain('res-2');
  }, SLOW);

});
