// Per-project actor identity — issue #61, the D53(c) acceptance block. Five
// criteria, one test each; the fifth is the load-bearing merge test with a
// NEGATIVE CONTROL that genuinely constructs the D53 failure (one
// installation-global actor id silently discarding one project's drafts).
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import {
  actorIdFor,
  deriveActorId,
  idbKvStore,
  type KvStore,
} from '../src/data/journal/identity';
import { JournalStore } from '../src/data/journal/journalStore';
import { ACTOR_RE, SLOT } from '../journal/grammar.mjs';

// journal/fold.mjs is Node-bound (node:crypto, createRequire). The
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
const { fold } = nodeRequire('./journal/fold.mjs') as {
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
// Review finding F1 (adversarial review of #61, 2026-08-19): the first-run
// secret mint was a read-check-write ACROSS two IndexedDB transactions, so two
// concurrent openers each read "no secret", each minted one, and the
// installation ended up with TWO actor ids for one project — one actor
// directory orphaned, and its staged outbox intents never replayed (replay
// filters by the current id's prefix). The reads below are SNAPSHOT reads (a
// delay before the answer), which is what two separate get transactions do.
// ---------------------------------------------------------------------------

/** A KvStore over a SHARED backing map whose get answers from a snapshot taken
 * before the delay — the reviewer's probe C2 construction. */
const snapshotKv = (backing: Map<string, string>): KvStore => ({
  get: async (key) => {
    const value = backing.get(key);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return value;
  },
  set: async (key, value) => {
    backing.set(key, value);
  },
  // Atomic by construction: no await between the check and the write.
  setIfAbsent: async (key, value) => {
    const existing = backing.get(key);
    if (existing !== undefined) return existing;
    backing.set(key, value);
    return value;
  },
  keys: async (prefix) => [...backing.keys()].filter((key) => key.startsWith(prefix)),
  delete: async (key) => {
    backing.delete(key);
  },
});

describe('#61 review F1: the first-run secret mint is atomic', () => {
  it('two CONCURRENT get-or-create calls over ONE backing store settle on ONE secret', async () => {
    const backing = new Map<string, string>();
    const [first, second] = await Promise.all([
      actorIdFor(snapshotKv(backing), PATH_ONE),
      actorIdFor(snapshotKv(backing), PATH_ONE),
    ]);
    expect(second).toBe(first); // one installation, one identity
    // …and that id is the one the SURVIVING stored secret derives, so the next
    // app start (which reads the stored secret) holds the same identity.
    const stored = backing.get('installation-secret');
    expect(stored).toBeDefined();
    expect(await deriveActorId(stored as string, PATH_ONE)).toBe(first);
  });

  it('idbKvStore is memoized per database name, so one process holds ONE object per database', () => {
    // The database is opened lazily, so this constructs no IndexedDB request.
    expect(idbKvStore('tc4-memo-probe')).toBe(idbKvStore('tc4-memo-probe'));
    expect(idbKvStore('tc4-memo-probe')).not.toBe(idbKvStore('tc4-memo-probe-other'));
  });

  it('two concurrent first-run open() calls provision exactly ONE actor directory', async () => {
    const backing = new Map<string, string>();
    const rig = fakeIngredientRig();
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const results = await Promise.all([
      new JournalStore({ api, repoPath: PATH_ONE, kv: snapshotKv(backing) }).open(),
      new JournalStore({ api, repoPath: PATH_ONE, kv: snapshotKv(backing) }).open(),
    ]);
    expect(results[1].actorId).toBe(results[0].actorId);
    const actorDirs = new Set(
      [...rig.files.keys()]
        .filter((ipath) => ipath.startsWith('checking/journal/'))
        .map((ipath) => ipath.split('/')[2]),
    );
    expect([...actorDirs]).toEqual([results[0].actorId]); // no orphaned directory
  });
});

describe('#61 review F5: the repoPath is VALIDATED before any derivation', () => {
  // The derivation used to accept any string, so a malformed path derived an id
  // in silence (review finding F5, 2026-08-19). The rule is the HTTP surface's
  // own: exactly 3 non-empty safe segments (serverApi.assertRepoPath).
  const malformed = [
    '_local_/_local_/proj/', // trailing slash — 4 segments, one empty
    '_local_/proj', // 2 segments
    '_local_/_local_/proj/book', // 4 segments
    '', // empty
    '_local_//proj', // empty segment
    '_local_/_local_/pro j', // whitespace in a segment
    '_local_/_local_/.hidden', // dot-prefixed segment
  ];

  it.each(malformed)('refuses to derive an actor id for %j', async (repoPath) => {
    await expect(deriveActorId(SECRET_A, repoPath)).rejects.toThrow(/repo path/);
  });

  it('refuses to open a store on a malformed repoPath, before any write', async () => {
    const rig = fakeIngredientRig();
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const store = new JournalStore({ api, repoPath: '_local_/_local_/proj/', kv: memKv() });
    await expect(store.open()).rejects.toThrow(/repo path/);
    expect([...rig.files.keys()]).toEqual([]);
  });

  it('does NOT case-fold: two case variants stay two ids (validation, not canonicalization)', async () => {
    // Deliberate, and stated in the fix: a case-sensitive filesystem can host
    // two genuinely different projects whose paths differ only in case. Folding
    // them would merge two projects into ONE actor identity — the D53 split,
    // inverted. Two ids give the visible fork D53(c) chooses.
    const lower = await deriveActorId(SECRET_A, '_local_/_local_/proj');
    const upper = await deriveActorId(SECRET_A, '_local_/_local_/PROJ');
    expect(upper).not.toBe(lower);
    expect(upper).toMatch(ACTOR_RE);
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

// ---------------------------------------------------------------------------
// Review finding P1-2 (second adversarial review of #61, 2026-08-19) — a staged
// intent is durable only when its TRANSACTION commits.
//
// idbKvStore.setIfAbsent resolved on the individual put request's onsuccess,
// which fires BEFORE the enclosing readwrite transaction's oncomplete. publish()
// treats that resolution as the durable-intent barrier and starts the HTTP write
// at once, so a crash in that window leaves a torn segment with no outbox entry
// to republish from, or an actor.json whose newly minted secret never committed
// — the identity is stranded. That is the D50 process-crash guarantee, broken.
//
// The Map-backed fakes above complete synchronously and CANNOT expose this, so
// this block drives the real idbKvStore against a minimal hand-rolled IndexedDB
// that models the two-phase ordering: a request's onsuccess fires on a
// microtask, the transaction's oncomplete on a later tick, and a put becomes
// visible in the backing store only at commit. No new dependency (the pinned
// versions rule and dependency discipline bind).
// ---------------------------------------------------------------------------

interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

/** A two-phase fake IndexedDB over `backing`. Every step appends to `log`, so a
 * test asserts the ORDER of the callbacks, not just the final value. */
const twoPhaseIdb = (backing: Map<string, string>, log: string[]) => {
  const request = (run: () => unknown): FakeRequest => {
    const req: FakeRequest = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    // Phase 1: the individual request settles on a MICROTASK.
    queueMicrotask(() => {
      req.result = run();
      req.onsuccess?.();
    });
    return req;
  };
  const objectStore = (staged: Map<string, string>) => ({
    get: (key: string) =>
      request(() => (staged.has(key) ? staged.get(key) : backing.get(key))),
    put: (value: string, key: string) =>
      request(() => {
        log.push('put:success');
        staged.set(key, value); // NOT durable yet — merged at commit
        return undefined;
      }),
  });
  const database = {
    createObjectStore: () => undefined,
    transaction: () => {
      const staged = new Map<string, string>();
      const store = objectStore(staged);
      const transaction = {
        error: null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => store,
      };
      // Phase 2: the transaction commits on a LATER tick — after every queued
      // microtask, which is exactly the real ordering guarantee.
      setTimeout(() => {
        for (const [key, value] of staged) backing.set(key, value);
        log.push('tx:complete');
        transaction.oncomplete?.();
      }, 0);
      return transaction;
    },
  };
  return {
    // The open request: onupgradeneeded first (with `result` already set — the
    // store is created there), then onsuccess.
    open: (): FakeRequest => {
      const req: FakeRequest = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
};

/** Run `body` with the fake installed as globalThis.indexedDB, then restore. */
const withFakeIdb = async (
  backing: Map<string, string>,
  log: string[],
  body: () => Promise<void>,
): Promise<void> => {
  const previous = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = twoPhaseIdb(
    backing,
    log,
  ) as unknown as IDBFactory;
  try {
    await body();
  } finally {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = previous;
  }
};

describe('#61 review P1-2: setIfAbsent resolves a NEW value only at transaction commit', () => {
  it('a first write resolves AFTER oncomplete, never on the put request success', async () => {
    const backing = new Map<string, string>();
    const log: string[] = [];
    await withFakeIdb(backing, log, async () => {
      // A database name of its own: idbKvStore memoizes per name.
      const kv = idbKvStore('tc4-p1-2-commit');
      const value = await kv.setIfAbsent('installation-secret', 'c'.repeat(64)).then((won) => {
        log.push('resolved');
        return won;
      });
      expect(value).toBe('c'.repeat(64));
      // The ORDER is the finding: the put succeeded, the transaction committed,
      // and only then did the caller get its durable-intent barrier.
      expect(log).toEqual(['put:success', 'tx:complete', 'resolved']);
      expect(backing.get('installation-secret')).toBe('c'.repeat(64));
    });
  });

  it('a read-only HIT may resolve on request success — nothing needs to commit', async () => {
    const backing = new Map<string, string>([['installation-secret', 'd'.repeat(64)]]);
    const log: string[] = [];
    await withFakeIdb(backing, log, async () => {
      const kv = idbKvStore('tc4-p1-2-hit');
      const value = await kv.setIfAbsent('installation-secret', 'e'.repeat(64)).then((won) => {
        log.push('resolved');
        return won;
      });
      expect(value).toBe('d'.repeat(64)); // the stored winner, not the candidate
      // No put, and the resolution does NOT wait for the commit: the value was
      // already durable before this transaction opened.
      expect(log).toEqual(['resolved']);
    });
  });
});
