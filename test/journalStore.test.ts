// JournalStore unit tests — issue #61 (the journal store over HTTP, D50 write
// model). Each describe names the #61 acceptance checkbox it proves. The store
// runs against a FAKE fetch that captures the exact HTTP payload bytes; the
// captured bytes are then judged by the CONFORMANCE REFERENCE
// (conformance/journal/files.mjs) — the harness validates what the store writes.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { forgetSharedClocks, JournalStore } from '../src/data/journal/journalStore';
import type { KvStore } from '../src/data/journal/identity';
import {
  CONTAINER_FRAME,
  sealAction,
  SEGMENT_LIMIT,
  type JournalEvent,
} from '../src/data/journal/seal';
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
    // Restart: a new PROCESS, whose physical clock sits EARLIER than the
    // published ts. A restart is a fresh module state, so the shared clock of
    // this identity is dropped (review finding F2) — without the ratchet the new
    // instance would re-mint an earlier ts.
    forgetSharedClocks();
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

// ---------------------------------------------------------------------------
// E. Review finding F2 (adversarial review of #61, 2026-08-19) — a duplicate ts
// must be impossible in-process, and staging must never overwrite a DIFFERENT
// staged action.
//
// The path lock is module-shared but the HLC was per INSTANCE, so two stores on
// one repoPath issued the SAME ts at the same physical millisecond. Store 1 then
// staged DRAFT A and died before its HTTP write; store 2 published DRAFT B at
// that same ts, its stage `set` OVERWROTE A's bytes at the same outbox key,
// publish succeeded and cleared the stage — DRAFT A was gone, with no conflict
// and no report. That is the silent loss the D50 staging exists to prevent.
// ---------------------------------------------------------------------------

describe('#61 review F2: no duplicate ts, no silent overwrite of a staged action', () => {
  it('two stores on ONE repoPath at the SAME physical millisecond issue DIFFERENT ts values', async () => {
    const frozen = () => Date.parse('2026-08-18T09:00:00.000Z');
    const rig = fakeRig();
    const kv = memKv();
    const { store: first } = await openStore({ rig, kv, now: frozen });
    const { store: second } = await openStore({ rig, kv, now: frozen });
    expect(second.actorId).toBe(first.actorId); // one installation, one project
    const tsOne = first.issueTs();
    const tsTwo = second.issueTs();
    expect(tsTwo).not.toBe(tsOne);
    // The §8.2 order is plain string comparison: the second ts sorts after.
    expect(tsTwo > tsOne).toBe(true);
  });

  it('staging refuses to overwrite DIFFERENT bytes at the same outbox key, and names the ts', async () => {
    const { rig, kv, store } = await openStore();
    const ts = store.issueTs();
    // A crash-era intent that this instance did not stage: the exact sealed
    // bytes of DRAFT A, staged at `ts` and never published.
    const stageKey = `outbox:${REPO}:${store.actorId}:${ts}`;
    const draftA = refSealAction([verseEvent(store.actorId, ts, 'DRAFT A — staged, never landed\n')]);
    await kv.set(stageKey, draftA);
    const before = rig.writes.length;
    await expect(
      store.publish([verseEvent(store.actorId, ts, 'DRAFT B\n')]),
    ).rejects.toThrow(new RegExp(ts.replace(/[|]/g, '\\|')));
    // The staged intent is intact and nothing was written.
    expect(kv.map.get(stageKey)).toBe(draftA);
    expect(rig.writes).toHaveLength(before);
    // …and it still replays: DRAFT A lands, DRAFT B never existed.
    expect(await store.replayStaged()).toEqual([{ ts, outcome: 'republished' }]);
    const landed = rig.files.get(rig.key(REPO, `checking/journal/${store.actorId}/segments/${refSegmentName(ts)}`));
    expect(landed).toBe(draftA);
  });

  it('re-staging BYTE-IDENTICAL bytes stays idempotent (a retry of the same publish)', async () => {
    const { rig, kv, store } = await openStore();
    const ts = store.issueTs();
    const events = [verseEvent(store.actorId, ts, 'un solo intento\n')];
    // Stage exactly what publish will seal, as a crashed first attempt did.
    await kv.set(`outbox:${REPO}:${store.actorId}:${ts}`, refSealAction(events));
    const result = await store.publish(events);
    expect(result.idempotent).toBe(false);
    expect(await kv.keys(`outbox:${REPO}:${store.actorId}:`)).toHaveLength(0);
    expect(rig.writes.at(-1)?.payload).toBe(refSealAction(events));
  });
});

// ---------------------------------------------------------------------------
// F. Review finding F6 (adversarial review of #61, 2026-08-19) — the container
// frame allowance is a SHARED constant: changing it in seal.ts alone used to
// leave every test passing. One boundary test now pins the store's accept/refuse
// edge to the reference's, computed from the constant, never a byte literal.
// ---------------------------------------------------------------------------

describe('#61 review F6: the seal size boundary agrees with the reference', () => {
  const BOUNDARY_ACTOR = 'a0123456789abcde';
  const BOUNDARY_TS = `2026-08-18T09:00:00.000Z|0000|${BOUNDARY_ACTOR}`;
  const utf8Len = (text: string): number => new TextEncoder().encode(text).length;
  // settings.set is the LEANEST action shape: its body carries few quotes, so
  // JSON-escaping the body into the container stays inside the frame allowance
  // and the FRAME is what decides the edge (asserted below).
  const action = (payload: string): JournalEvent[] => [
    settingsEvent(BOUNDARY_ACTOR, BOUNDARY_TS, payload),
  ];
  const bodyLen = (payload: string): number => utf8Len(JSON.stringify({ events: action(payload) }));

  it('the largest accepted and the smallest refused action are the SAME for the store and the reference', async () => {
    // Every added ASCII character adds exactly one byte to the body AND one to
    // the container, so the container overhead is a constant — measured here
    // from the reference's own bytes, never assumed.
    const overhead = utf8Len(refSealAction(action('x'))) - bodyLen('x');
    // The store accepts while BOTH caps hold: body ≤ limit − frame (the cheap
    // pre-check) and body + overhead ≤ limit (the real container).
    const largestBody = SEGMENT_LIMIT - Math.max(CONTAINER_FRAME, overhead);
    const base = bodyLen('');
    const payloadOf = (targetBody: number): string => 'x'.repeat(targetBody - base);

    const storeAccepts = async (payload: string): Promise<boolean> => {
      try {
        await sealAction(action(payload));
        return true;
      } catch {
        return false;
      }
    };
    const referenceAccepts = (payload: string): boolean => {
      try {
        refSealAction(action(payload));
        return true;
      } catch {
        return false;
      }
    };

    const largest = payloadOf(largestBody);
    const smallestRefused = payloadOf(largestBody + 1);
    // PARITY at the exact edge, in both directions.
    expect(await storeAccepts(largest)).toBe(referenceAccepts(largest));
    expect(await storeAccepts(smallestRefused)).toBe(referenceAccepts(smallestRefused));
    // …and the edge really is an edge: accepted, then refused.
    expect(await storeAccepts(largest)).toBe(true);
    expect(await storeAccepts(smallestRefused)).toBe(false);
    // The accepted bytes are byte-identical to the reference's at the boundary.
    expect(await sealAction(action(largest))).toBe(refSealAction(action(largest)));
    // SENSITIVITY GUARD, last: this test probes the FRAME only while the frame
    // is the binding cap. If a future edit fattens the action shape past the
    // allowance, the container cap would decide the edge and a frame divergence
    // would slip through again — which is exactly how F6 stayed invisible.
    expect(overhead).toBeLessThanOrEqual(CONTAINER_FRAME);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// G. Review finding P1-1 (second adversarial review of #61, 2026-08-19) — the
// HLC ratchet must cover every ts the store can SEE, not only the ones its own
// filenames carry.
//
// open() ratcheted from own segment FILENAMES and outbox KEY suffixes only. Both
// carry an action's FIRST ts, so the second event of a two-event action was
// never ratcheted past: a restart at the same physical millisecond re-issued an
// identity an accepted event already held. Event identity IS the ts (R-8.2.5) and
// the union de-duplicates by it, so one of the two events disappears silently.
// No other actor's segments were read at all — a merged-in future stream did not
// move the local clock (R-8.2.4).
// ---------------------------------------------------------------------------

describe('#61 review P1-1: the ratchet covers every visible ts (R-8.2.4/R-8.2.5)', () => {
  it('a restart re-issues a ts strictly after EVERY event of a published multi-event action', async () => {
    // One physical millisecond for the whole test: the counter is the only thing
    // that separates the ts values, which is exactly the collision case.
    const frozen = () => Date.parse('2026-08-19T09:00:00.000Z');
    const { rig, kv, store } = await openStore({ now: frozen });
    const events = [
      verseEvent(store.actorId, store.issueTs(), 'primer evento\n'), // …|0000|
      settingsEvent(store.actorId, store.issueTs(), 'segundo evento'), // …|0001|
    ];
    await store.publish(events);
    // The filename carries the FIRST ts only — the second is visible in the body.
    expect(rig.files.get(rig.key(REPO, `checking/journal/${store.actorId}/segments/${refSegmentName(events[0].ts)}`))).toBeDefined();

    forgetSharedClocks(); // a restart is a fresh module state
    const restarted = new JournalStore({
      api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn }),
      repoPath: REPO,
      kv,
      now: frozen,
    });
    await restarted.open();
    const next = restarted.issueTs();
    for (const event of events) expect(next > event.ts).toBe(true);
  });

  it('a staged (unpublished) multi-event action also ratchets past its LAST event', async () => {
    const frozen = () => Date.parse('2026-08-19T09:10:00.000Z');
    const { rig, kv, store } = await openStore({ now: frozen });
    const events = [
      verseEvent(store.actorId, store.issueTs(), 'intento primero\n'),
      settingsEvent(store.actorId, store.issueTs(), 'intento segundo'),
    ];
    // A crash between stage and publish: the intent is durable, the segment is not.
    await kv.set(`outbox:${REPO}:${store.actorId}:${events[0].ts}`, refSealAction(events));

    forgetSharedClocks();
    const restarted = new JournalStore({
      api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn }),
      repoPath: REPO,
      kv,
      now: frozen,
    });
    await restarted.open();
    const next = restarted.issueTs();
    for (const event of events) expect(next > event.ts).toBe(true);
  });

  it("a VALID segment from ANOTHER actor, dated in the future, moves this actor's clock (R-8.2.4)", async () => {
    // The merge case: another device's journal directory arrives in the project
    // (git pull, import) carrying events dated after the local wall clock.
    const rig = fakeRig();
    const foreign = 'a-foreign-actor';
    const foreignTs = `2030-01-01T00:00:00.000Z|0000|${foreign}`;
    rig.files.set(
      rig.key(REPO, `checking/journal/${foreign}/segments/${refSegmentName(foreignTs)}`),
      refSealAction([verseEvent(foreign, foreignTs, 'del futuro\n')]),
    );
    const { store } = await openStore({ rig, now: tickingNow('2026-08-19T09:20:00.000Z').now });
    expect(store.actorId).not.toBe(foreign);
    expect(store.issueTs() > foreignTs).toBe(true);
  });
});
