// Per-project actor identity — issue #61, the D53(c) acceptance block. Five
// criteria, one test each; the fifth is the load-bearing merge test with a
// NEGATIVE CONTROL that genuinely constructs the D53 failure (one
// installation-global actor id silently discarding one project's drafts).
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { deriveActorId, type KvStore } from '../src/data/journal/identity';
import { JournalStore } from '../src/data/journal/journalStore';
import { ACTOR_RE, SLOT } from '../conformance/journal/grammar.mjs';

// conformance/journal/fold.mjs is Node-bound (node:crypto, createRequire). The
// app's vite-plugin-node-polyfills aliases node builtins to browser mocks even
// under the Vitest node environment [VERIFIED in this toolchain — same
// workaround as test/s0a-aligner-headless.test.ts], so the reference fold is
// loaded via a NATIVE require (Node ≥22 supports require of ESM).
interface FoldResult {
  forks: { key: string; heads: string[] }[];
  retained: { key: string; ts: string; reason: string }[];
  books: Record<string, { usfm: string; verses: Record<string, string> }>;
  liveHeads: Record<string, { ts: string }[]>;
}
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const { fold } = nodeRequire('./conformance/journal/fold.mjs') as {
  fold(events: unknown[]): FoldResult;
};

const SECRET_A = 'a'.repeat(64); // a fixed 32-byte hex installation secret
const SECRET_B = 'b'.repeat(64); // a second installation
const PATH_ONE = '_local_/_local_/proj-one';
const PATH_TWO = '_local_/_local_/proj-two';

describe('#61 D53(c): actor identity is scoped per project', () => {
  it('criterion 1: two repoPaths under ONE secret derive two DIFFERENT actor ids, both §8.1 slugs', async () => {
    const one = await deriveActorId(SECRET_A, PATH_ONE);
    const two = await deriveActorId(SECRET_A, PATH_TWO);
    expect(one).not.toBe(two);
    expect(one).toMatch(ACTOR_RE);
    expect(two).toMatch(ACTOR_RE);
  });

  it('criterion 2: the derivation is deterministic and one-way (HMAC — the id reveals nothing of the secret)', async () => {
    const first = await deriveActorId(SECRET_A, PATH_ONE);
    const again = await deriveActorId(SECRET_A, PATH_ONE);
    expect(again).toBe(first); // deterministic
    // Keyed by the secret: a different installation secret gives a different id
    // for the same repoPath (that is what makes it an HMAC, not a plain hash of
    // the path).
    expect(await deriveActorId(SECRET_B, PATH_ONE)).not.toBe(first);
    // One-way: the id carries no substring of the secret (the hex tail is an
    // HMAC-SHA-256 digest, not secret material).
    expect(SECRET_A.includes(first.slice(1))).toBe(false);
    expect(first).toMatch(/^a[0-9a-f]{15}$/);
  });

  it('criterion 3: a new store instance over the same kv + repoPath resolves the SAME id (reopening preserves identity)', async () => {
    // Store-level: the secret is minted once in the kv, so a second JournalStore
    // (a later app run) derives the identical actor id.
    const kv = memKv();
    const rig = fakeIngredientRig();
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const first = new JournalStore({ api, repoPath: PATH_ONE, kv });
    await first.open();
    const second = new JournalStore({ api, repoPath: PATH_ONE, kv });
    await second.open();
    expect(second.actorId).toBe(first.actorId);
  });

  it('criterion 4: a copied/imported project (a different repoPath) gets a DIFFERENT id', async () => {
    // The repoPath is the project key (D53c): copying a project to a new path
    // is a new project as far as actor identity goes.
    const original = await deriveActorId(SECRET_A, PATH_ONE);
    const copied = await deriveActorId(SECRET_A, '_local_/_local_/proj-one-copy');
    expect(copied).not.toBe(original);
  });

  it('criterion 5: the merge test — NEGATIVE CONTROL first (one global id = silent loss, D53c), then per-project ids (a visible fork)', async () => {
    const skeleton = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
    const seedPayload = {
      v: 1,
      op: 'book.add',
      base: null,
      book: 'TIT',
      scope: [],
      skeleton,
      initialVerses: {},
    };
    const draftOne = 'draft from project one\n';
    const draftTwo = 'draft from project two\n';
    const edit = (actor: string, ts: string, base: string, text: string) => ({
      v: 1,
      op: 'text.verse.set',
      actor,
      ts,
      base,
      book: 'TIT',
      chapter: '1',
      verse: '1',
      text,
    });

    // ---- NEGATIVE CONTROL: the D53 danger, genuinely constructed. ----
    // ONE installation-global actor id in BOTH projects. Deterministic seeding
    // (§8.8: fixed epoch ts + identical payload) means both projects' creation
    // events are the SAME event (identical ts — the union de-duplicates), and
    // the two independent verse drafts are same-actor events on one key: the
    // §8.3 same-actor linear rule (R-8.3.3) totally orders them by ts — no
    // fork, retained[] empty, and one draft is simply GONE from the projection.
    const globalActor = 'tc4-install-0001';
    const globalSeedTs = `2026-01-01T00:00:00.000Z|0000|${globalActor}`;
    const globalSeed = { ...seedPayload, actor: globalActor, ts: globalSeedTs };
    const oneEdit = edit(
      globalActor,
      `2026-08-01T10:00:00.000Z|0000|${globalActor}`,
      globalSeedTs,
      draftOne,
    );
    const twoEdit = edit(
      globalActor,
      `2026-08-02T10:00:00.000Z|0000|${globalActor}`,
      globalSeedTs,
      draftTwo,
    );
    // The union of the two projects' journals (the seed arrives from both sides).
    const lost = fold([globalSeed, globalSeed, oneEdit, twoEdit]);
    expect(lost.forks).toHaveLength(0); // no fork…
    expect(lost.books.TIT.verses['1:1']).toBe(draftTwo); // …the later draft wins…
    expect(JSON.stringify(lost.books)).not.toContain(draftOne.trim()); // …the other is gone…
    expect(lost.retained.filter((entry: { ts: string }) => entry.ts === oneEdit.ts)).toHaveLength(
      0,
    ); // …and NOT reported.

    // ---- THE REAL DESIGN: per-project derived ids. ----
    // Each project holds its own derived actor id. The two seeds now differ
    // only in actor/ts — §8.8 seeding is deterministic modulo actor — so the
    // fold CONVERGES them as one creation root (D53d), and the two drafts are
    // cross-actor heads on one key: exactly ONE fork, both drafts observable.
    const actorOne = await deriveActorId(SECRET_A, PATH_ONE);
    const actorTwo = await deriveActorId(SECRET_A, PATH_TWO);
    const seedOne = {
      ...seedPayload,
      actor: actorOne,
      ts: `2026-01-01T00:00:00.000Z|0000|${actorOne}`,
    };
    const seedTwo = {
      ...seedPayload,
      actor: actorTwo,
      ts: `2026-01-01T00:00:00.000Z|0000|${actorTwo}`,
    };
    const editOne = edit(
      actorOne,
      `2026-08-01T10:00:00.000Z|0000|${actorOne}`,
      seedOne.ts,
      draftOne,
    );
    const editTwo = edit(
      actorTwo,
      `2026-08-02T10:00:00.000Z|0000|${actorTwo}`,
      seedTwo.ts,
      draftTwo,
    );
    const merged = fold([seedOne, seedTwo, editOne, editTwo]);
    expect(merged.forks).toHaveLength(1); // exactly one fork, surfaced for a person
    expect([...merged.forks[0].heads].sort()).toEqual([editOne.ts, editTwo.ts].sort());
    // Both drafts observable: the provisional winner projects, the other head is
    // live in the fork report (nothing was silently discarded).
    expect(merged.books.TIT.verses['1:1']).toBe(draftTwo);
    const liveTs = new Set(
      Object.values(merged.liveHeads as Record<string, { ts: string }[]>)
        .flat()
        .map((head) => head.ts),
    );
    expect(liveTs.has(editOne.ts)).toBe(true);
    expect(liveTs.has(editTwo.ts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimal fakes (criterion 3 needs a working open(): actor.json + paths routes)
// ---------------------------------------------------------------------------

function memKv(): KvStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key) => {
      map.delete(key);
    },
  };
}

function fakeIngredientRig() {
  const files = new Map<string, string>();
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[1] === 'burrito' && parts[2] === 'ingredient' && parts[3] === 'raw') {
      const ipath = url.searchParams.get('ipath') ?? '';
      if ((init?.method ?? 'GET') === 'GET') {
        const text = files.get(ipath);
        if (text === undefined)
          return new Response(
            JSON.stringify({
              is_good: false,
              reason: 'could not read ingredient content: No such file or directory (os error 2)',
            }),
            { status: 400 },
          );
        return new Response(text, { status: 200 });
      }
      files.set(ipath, (JSON.parse(String(init?.body)) as { payload: string }).payload);
      return new Response(JSON.stringify({ is_good: true, reason: 'ok' }), { status: 200 });
    }
    if (parts[1] === 'burrito' && parts[2] === 'paths')
      return new Response(JSON.stringify([...files.keys()]), { status: 200 });
    return new Response(JSON.stringify({ is_good: false, reason: 'no such route' }), {
      status: 404,
    });
  }) as typeof fetch;
  return { files, fetchFn };
}
