// JournalStore unit tests — issue #61 (the journal store over HTTP, D50 write
// model). Each describe names the #61 acceptance checkbox it proves. The store
// runs against a FAKE fetch that captures the exact HTTP payload bytes; the
// captured bytes are then judged by the CONFORMANCE REFERENCE
// (conformance/journal/files.mjs) — the harness validates what the store writes.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalStore } from '../src/data/journal/journalStore';
import type { KvStore } from '../src/data/journal/identity';
import type { JournalEvent } from '../src/data/journal/seal';
import { SLOT } from '../conformance/journal/grammar.mjs';

// conformance/journal/files.mjs is Node-bound (fs, node:crypto). The app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks even under
// the Vitest node environment [VERIFIED in this toolchain — same workaround as
// test/s0a-aligner-headless.test.ts], so the reference is loaded via a NATIVE
// require (Node ≥22 supports require of ESM), outside the vite pipeline.
interface RefSegmentVerdict {
  ok: boolean;
  reason?: string;
  events: Record<string, unknown>[];
}
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const refFiles = nodeRequire('./conformance/journal/files.mjs') as {
  sealAction(events: unknown[]): string;
  segmentName(ts: string): string;
  validateActorDoc(raw: unknown, actorId: string): { ok: boolean; reason?: string };
  validateSegment(raw: string): RefSegmentVerdict;
};
const refSealAction = refFiles.sealAction;
const refSegmentName = refFiles.segmentName;
const refValidateActorDoc = refFiles.validateActorDoc;
const refValidateSegment = refFiles.validateSegment;

const REPO = '_local_/_local_/j61unit';

// ---------------------------------------------------------------------------
// Fakes: a Map-backed KvStore and a fake rig that captures every write
// ---------------------------------------------------------------------------

const memKv = (): KvStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    // Atomic by construction: no await between the check and the write.
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

interface CapturedWrite {
  ipath: string;
  payload: string;
  noBak: boolean;
  updateIngredients: boolean;
}

/** Fake pankosmia rig: ingredient read/write + the paths listing, verbatim
 * response shapes (isNotFound needs the live 400 ENOENT reason text). */
const fakeRig = () => {
  const files = new Map<string, string>(); // `${repo}\n${ipath}` -> text
  const writes: CapturedWrite[] = [];
  const key = (repo: string, ipath: string): string => `${repo}\n${ipath}`;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'burrito', ...]
    if (parts[1] === 'burrito' && parts[2] === 'ingredient' && parts[3] === 'raw') {
      const repo = parts.slice(4, 7).map(decodeURIComponent).join('/');
      const ipath = url.searchParams.get('ipath') ?? '';
      if ((init?.method ?? 'GET') === 'GET') {
        const text = files.get(key(repo, ipath));
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
      const body = JSON.parse(String(init?.body)) as { payload: string };
      files.set(key(repo, ipath), body.payload);
      writes.push({
        ipath,
        payload: body.payload,
        noBak: url.searchParams.has('no_bak'),
        updateIngredients: url.searchParams.has('update_ingredients'),
      });
      return new Response(JSON.stringify({ is_good: true, reason: 'ok' }), { status: 200 });
    }
    if (parts[1] === 'burrito' && parts[2] === 'paths') {
      const repo = parts.slice(3, 6).map(decodeURIComponent).join('/');
      const listed = [...files.keys()]
        .filter((entry) => entry.startsWith(`${repo}\n`))
        .map((entry) => entry.split('\n')[1]);
      return new Response(JSON.stringify(listed), { status: 200 });
    }
    return new Response(JSON.stringify({ is_good: false, reason: 'no such route' }), {
      status: 404,
    });
  }) as typeof fetch;
  return { files, writes, fetchFn, key };
};

/** A fixed physical clock the tests can advance. */
const tickingNow = (startIso: string) => {
  let at = Date.parse(startIso);
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

const openStore = async (options?: {
  rig?: ReturnType<typeof fakeRig>;
  kv?: ReturnType<typeof memKv>;
  now?: () => number;
  repoPath?: string;
}) => {
  const rig = options?.rig ?? fakeRig();
  const kv = options?.kv ?? memKv();
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalStore({
    api,
    repoPath: options?.repoPath ?? REPO,
    kv,
    now: options?.now ?? tickingNow('2026-08-18T09:00:00.000Z').now,
  });
  await store.open();
  return { rig, kv, api, store };
};

const settingsEvent = (actor: string, ts: string, value: unknown): JournalEvent => ({
  v: 1,
  op: 'settings.set',
  actor,
  ts,
  base: null,
  path: 'ui.example',
  value,
});

const verseEvent = (actor: string, ts: string, text: string): JournalEvent => ({
  v: 1,
  op: 'text.verse.set',
  actor,
  ts,
  base: null,
  book: 'TIT',
  chapter: '1',
  verse: '1',
  text,
});

const skeleton = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;

// ---------------------------------------------------------------------------
// A. Checkbox 4 — the conformance harness validates what the store writes
// ---------------------------------------------------------------------------

describe('#61 checkbox 4: the conformance harness validates what the store writes', () => {
  it('publish() lands segment bytes the reference validateSegment accepts, at the reference segmentName path', async () => {
    const { rig, store } = await openStore();
    const events = [
      {
        v: 1,
        op: 'book.add',
        actor: store.actorId,
        ts: store.issueTs(),
        base: null,
        book: 'TIT',
        scope: [],
        skeleton,
        initialVerses: { '1:1': 'primer borrador\n' },
      } as JournalEvent,
      verseEvent(store.actorId, store.issueTs(), 'segundo borrador\n'),
    ];
    const { ipath } = await store.publish(events);
    expect(ipath).toBe(
      `checking/journal/${store.actorId}/segments/${refSegmentName(events[0].ts)}`,
    );
    const captured = rig.writes.find((write) => write.ipath === ipath);
    expect(captured).toBeDefined();
    const verdict = refValidateSegment(captured!.payload);
    expect(verdict.ok).toBe(true);
    expect(verdict.events).toHaveLength(2);
    // Segments are write-once: no .bak (keepBak false) and NO update_ingredients
    // (the rescan wipes every x-role — PLATFORM-NOTES #5, D28/W-2).
    expect(captured!.noBak).toBe(true);
    expect(captured!.updateIngredients).toBe(false);
  });

  it("the store's sealed bytes are byte-identical to the reference sealAction's for the same events", async () => {
    const { rig, store } = await openStore();
    const events = [
      verseEvent(store.actorId, store.issueTs(), 'texto exacto\n'),
      settingsEvent(store.actorId, store.issueTs(), 42),
    ];
    const { ipath } = await store.publish(events);
    const captured = rig.writes.find((write) => write.ipath === ipath);
    expect(captured!.payload).toBe(refSealAction(events));
  });

  it('open() provisions actor.json bytes the reference validateActorDoc accepts', async () => {
    const { rig, store } = await openStore();
    const bytes = rig.files.get(rig.key(REPO, `checking/journal/${store.actorId}/actor.json`));
    expect(bytes).toBeDefined();
    const verdict = refValidateActorDoc(bytes, store.actorId);
    expect(verdict.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Checkbox 1 — R-8.1.4/5 immutability branches over HTTP
// ---------------------------------------------------------------------------

describe('#61 checkbox 1: immutability branches (R-8.1.4/5) over HTTP', () => {
  it('path free → write; byte-identical republish → idempotent accept with NO second write', async () => {
    const { rig, store } = await openStore();
    const events = [verseEvent(store.actorId, store.issueTs(), 'uno\n')];
    const first = await store.publish(events);
    expect(first.idempotent).toBe(false);
    const writesAfterFirst = rig.writes.filter((write) => write.ipath === first.ipath).length;
    const second = await store.publish(events);
    expect(second.idempotent).toBe(true);
    expect(rig.writes.filter((write) => write.ipath === second.ipath)).toHaveLength(
      writesAfterFirst,
    );
  });

  it('a DIFFERENT valid action at an accepted path is refused and the accepted bytes stay untouched', async () => {
    const { rig, store } = await openStore();
    const ts = store.issueTs();
    const { ipath } = await store.publish([verseEvent(store.actorId, ts, 'aceptado\n')]);
    const accepted = rig.files.get(rig.key(REPO, ipath));
    await expect(store.publish([verseEvent(store.actorId, ts, 'DIFERENTE\n')])).rejects.toThrow(
      /refuse to overwrite/,
    );
    expect(rig.files.get(rig.key(REPO, ipath))).toBe(accepted);
  });

  it('existing INVALID bytes at the path → publish refuses; recovery goes through replayStaged() with the EXACT staged bytes', async () => {
    const { rig, kv, store } = await openStore();
    const ts = store.issueTs();
    const events = [verseEvent(store.actorId, ts, 'recuperable\n')];
    const ipath = `checking/journal/${store.actorId}/segments/${refSegmentName(ts)}`;
    rig.files.set(rig.key(REPO, ipath), 'torn garbage — not a segment');
    await expect(store.publish(events)).rejects.toThrow(/replayStaged/);
    // The staged intent survives the refusal…
    expect(await kv.keys(`outbox:${REPO}:${store.actorId}:`)).toHaveLength(1);
    // …and replay writes the EXACT staged bytes over the invalid file.
    const results = await store.replayStaged();
    expect(results).toEqual([{ ts, outcome: 'republished' }]);
    expect(rig.files.get(rig.key(REPO, ipath))).toBe(refSealAction(events));
    expect(await kv.keys(`outbox:${REPO}:${store.actorId}:`)).toHaveLength(0);
  });

  it('an oversize action is refused at seal (R-8.1.9): nothing staged, nothing written', async () => {
    const { rig, kv, store } = await openStore();
    const before = rig.writes.length;
    await expect(
      store.publish([
        verseEvent(store.actorId, store.issueTs(), `${'x'.repeat(4 * 1024 * 1024)}\n`),
      ]),
    ).rejects.toThrow(/4 MiB/);
    expect(rig.writes).toHaveLength(before);
    expect(await kv.keys(`outbox:${REPO}:${store.actorId}:`)).toHaveLength(0);
  });

  it("an event whose actor is not this store's derived actor is refused before any write (R-8.1.12)", async () => {
    const { rig, store } = await openStore();
    const before = rig.writes.length;
    const foreign = verseEvent(
      'some-other-actor',
      '2026-08-18T09:30:00.000Z|0000|some-other-actor',
      'ajeno\n',
    );
    await expect(store.publish([foreign])).rejects.toThrow(/R-8\.1\.12/);
    expect(rig.writes).toHaveLength(before);
  });

  it('a truncated capture is invisible AS A WHOLE to the reference reader (R-8.1.6)', async () => {
    const { rig, store } = await openStore();
    const { ipath } = await store.publish([
      verseEvent(store.actorId, store.issueTs(), 'entero o nada\n'),
    ]);
    const captured = rig.files.get(rig.key(REPO, ipath))!;
    const verdict = refValidateSegment(captured.slice(0, captured.length - 10));
    expect(verdict.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Checkbox 2 — provisioning + the HLC ratchet across restarts
// ---------------------------------------------------------------------------

describe('#61 checkbox 2: actor provisioning and the HLC ratchet (R-8.2.4)', () => {
  it('first open writes a valid actor.json with NO identifying defaults (PRD FR-33, D7)', async () => {
    const { rig, store } = await openStore();
    const bytes = rig.files.get(rig.key(REPO, `checking/journal/${store.actorId}/actor.json`))!;
    const doc = JSON.parse(bytes) as Record<string, unknown>;
    expect(refValidateActorDoc(bytes, store.actorId).ok).toBe(true);
    expect(doc.displayName).toBeUndefined();
    expect(doc.device).toBe('translation device'); // non-identifying, user-editable later
  });

  it('a second open of the same project does not rewrite actor.json', async () => {
    const { rig, kv, store } = await openStore();
    const actorIpath = `checking/journal/${store.actorId}/actor.json`;
    const writesAfterFirst = rig.writes.filter((write) => write.ipath === actorIpath).length;
    expect(writesAfterFirst).toBe(1);
    const again = new JournalStore({
      api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn }),
      repoPath: REPO,
      kv,
      now: tickingNow('2026-08-18T10:00:00.000Z').now,
    });
    await again.open();
    expect(again.actorId).toBe(store.actorId);
    expect(rig.writes.filter((write) => write.ipath === actorIpath)).toHaveLength(1);
  });

  it('an existing actor.json that fails validation refuses open() (R-8.1.13)', async () => {
    const { rig, kv, store } = await openStore();
    rig.files.set(
      rig.key(REPO, `checking/journal/${store.actorId}/actor.json`),
      JSON.stringify({
        schemaVersion: 1,
        actorId: 'someone-else',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const again = new JournalStore({
      api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn }),
      repoPath: REPO,
      kv,
    });
    await expect(again.open()).rejects.toThrow(/R-8\.1\.13/);
  });

  it("after a 'restart' (new store, same backend) with a REWOUND wall clock, the next issued ts still sorts after everything published", async () => {
    const clock1 = tickingNow('2026-08-18T12:00:00.000Z');
    const { rig, kv, store } = await openStore({ now: clock1.now });
    const publishedTs = store.issueTs();
    await store.publish([verseEvent(store.actorId, publishedTs, 'antes del reinicio\n')]);
    // Restart: a new instance whose physical clock sits EARLIER than the
    // published ts. Without the ratchet it would re-mint an earlier ts.
    const rewound = tickingNow('2026-08-18T11:00:00.000Z');
    const restarted = new JournalStore({
      api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn }),
      repoPath: REPO,
      kv,
      now: rewound.now,
    });
    await restarted.open();
    const next = restarted.issueTs();
    expect(next > publishedTs).toBe(true); // plain string comparison IS the §8.2 order
  });

  it('readOwnSegments applies the exact R-8.1.2 round-trip: a misnamed file is invisible and reported (R-8.1.7 posture)', async () => {
    const { rig, store } = await openStore();
    const ts = store.issueTs();
    await store.publish([verseEvent(store.actorId, ts, 'listado\n')]);
    rig.files.set(
      rig.key(REPO, `checking/journal/${store.actorId}/segments/stray-file.action.json`),
      'not a segment',
    );
    const listing = await store.readOwnSegments();
    expect(listing.segments.map((segment) => segment.ts)).toEqual([ts]);
    expect(listing.misnamed).toEqual(['stray-file.action.json']);
  });
});

// ---------------------------------------------------------------------------
// D. Checkbox 3 — I-4 Unicode NFC through the store's publish path
// ---------------------------------------------------------------------------

describe("#61 checkbox 3: I-4 NFC through the store's publish path", () => {
  const NFD = 'Pabló siérvo\n'; // combining acutes — NFD content
  const NFC = NFD.normalize('NFC');

  it('NFD verse content is NFC in the sealed bytes', async () => {
    const { rig, store } = await openStore();
    expect(NFD).not.toBe(NFC); // the fixture is genuinely denormalized
    const { ipath } = await store.publish([verseEvent(store.actorId, store.issueTs(), NFD)]);
    const captured = rig.files.get(rig.key(REPO, ipath))!;
    const verdict = refValidateSegment(captured);
    expect(verdict.ok).toBe(true);
    expect((verdict.events[0] as { text: string }).text).toBe(NFC);
  });

  it('an NFD IDENTITY component is REFUSED at publish, never silently rewritten', async () => {
    const { rig, kv, store } = await openStore();
    const before = rig.writes.length;
    const generation = store.issueTs();
    const decision: JournalEvent = {
      v: 1,
      op: 'check.decision.set',
      actor: store.actorId,
      ts: store.issueTs(),
      base: null,
      generation,
      toolId: 'translationWords',
      decision: {
        contextId: {
          checkId: 'chék', // NFD identity — must refuse (I-4)
          occurrence: 1,
          reference: { bookId: 'tit', chapter: '1', verse: '1' },
        },
        selections: false,
      },
    };
    await expect(store.publish([decision])).rejects.toThrow(/I-4/);
    expect(rig.writes).toHaveLength(before);
    expect(await kv.keys(`outbox:${REPO}:${store.actorId}:`)).toHaveLength(0);
  });
});
