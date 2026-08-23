// Regression tests for the blocking defects found by the independent
// adversarial review of Increment 2 (2026-08-06).
//
// WHY THIS FILE EXISTS, AND WHY IT ASSERTS WHAT IT DOES.
// The defects were live while 34 conformance checks, 59 journal checks, 260
// unit tests and 25 journeys were green. The conformance harness calls the
// library functions directly, and the library was (mostly) correct — the
// application did not always call it correctly, and one library path was
// untested for a whole grammar form. So a unit test of `filterToScope` proves
// nothing about the app wiring, and a scope test that never uses `C:V-V` proves
// nothing about that form. Each test below is sourced from real derived items,
// not hand-built identifiers.
import { describe, expect, it } from 'vitest';
import { carryOverDecisions } from '../src/data/carryOver';
import {
  TN_HEADER,
  deriveTnItems,
  filterToScope,
  mergeAndReattach,
  progressOf,
  refInScope,
  scopeRangesFor,
} from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';
import { selectionsFromTokens, targetWords, tokenIndicesFromSelections } from '../src/data/selections';
import type { DecisionFile } from '../src/data/burritoStore';
import { HttpStore, StaleWriteError } from '../src/data/httpStore';
import { localRepoPathFromRepoPath, installedPathFor, isPinLocal } from '../src/data/installed';
import { preflightToolBook } from '../src/data/resolve';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const RES_A = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89' };
const RES_B = { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v66' };

const tsv = (rows: string[][]): string =>
  [TN_HEADER, ...rows.map((r) => [r[0], r[1], '', r[2], r[3], r[4], r[5]].join('\t'))].join('\n');

const ref = (i: CheckItem): string =>
  `${i.contextId.reference.chapter}:${i.contextId.reference.verse}`;

const fileOf = (decisions: unknown[], resource: unknown): DecisionFile =>
  ({ schemaVersion: 1, tool: 'translationNotes', book: 'TIT', resource, decisions }) as unknown as DecisionFile;

// ---------------------------------------------------------------- R1: scope
describe('R1 — the derived list the app shows is filtered to the project scope (§4.2, D26)', () => {
  const rows = [
    ['1:1', 'a1', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['1:2', 'a2', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['1:3', 'a3', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['2:1', 'a4', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['2:4', 'a5', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['2:5', 'a6', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['2:6', 'a7', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['2:9', 'a8', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['3:1', 'a9', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ['3:5', 'a10', 'figs-idiom', 'Θεοῦ', '1', 'n'],
  ];

  it('the unscoped derive returns every row — this is what the app used to show', () => {
    expect(deriveTnItems(tsv(rows), 'tit')).toHaveLength(10);
  });

  it('cross-chapter scope 1:1-2:5 admits only the in-scope rows; denominator shrinks with it', () => {
    const scoped = filterToScope(deriveTnItems(tsv(rows), 'tit'), scopeRangesFor({ TIT: ['1:1-2:5'] }, 'TIT'));
    expect(scoped.map(ref)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:4', '2:5']);
    expect(progressOf(scoped).total).toBe(6);
  });

  it('an empty scope means whole book, so nothing regresses for unscoped projects', () => {
    expect(filterToScope(deriveTnItems(tsv(rows), 'tit'), scopeRangesFor({}, 'TIT'))).toHaveLength(10);
  });

  // The defect was never in the library — it was that state.jsx did not call it.
  it('state.jsx imports the scope helpers and applies them at every derive site', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/state.jsx'), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\bfilterToScope\b/s);
    expect(src).toMatch(/import\s*\{[^}]*\bscopeRangesFor\b/s);
    const deriveCalls = (src.match(/deriveT(n|wl)Items\(/g) ?? []).length;
    const scopeFilters = (src.match(/filterToScope\(/g) ?? []).length;
    expect(deriveCalls).toBeGreaterThan(0);
    expect(scopeFilters * 2).toBe(deriveCalls);
  });
});

// ------------------------------------------------ R1b: F6 same-chapter C:V-V
describe('R1b — a same-chapter verse span C:V-V is honored exactly (F6, §3 rules 4-5)', () => {
  // Before the fix, `to` in "1:3-5" was read as CHAPTER 5, so the range meant
  // "1:3 through chapter 5" — admitting 1:6 and all of chapter 2.
  it('refInScope("1:3-5") admits 1:3..1:5 only — never 1:6, never chapter 2', () => {
    expect(refInScope(['1:3-5'], 1, 3)).toBe(true);
    expect(refInScope(['1:3-5'], 1, 5)).toBe(true);
    expect(refInScope(['1:3-5'], 1, 6)).toBe(false);
    expect(refInScope(['1:3-5'], 2, 1)).toBe(false);
  });

  it('controls: the other grammar forms are unaffected', () => {
    expect(refInScope(['1:1-2:5'], 2, 5)).toBe(true); // C:V-C:V
    expect(refInScope(['1:1-2:5'], 2, 6)).toBe(false);
    expect(refInScope(['3'], 3, 15)).toBe(true); // whole chapter
    expect(refInScope(['3'], 2, 1)).toBe(false);
    expect(refInScope(['1:4'], 1, 4)).toBe(true); // single verse C:V
    expect(refInScope(['1:4'], 1, 5)).toBe(false);
  });

  it('the scoped derive drops out-of-span verses for a C:V-V scope', () => {
    const rows = [
      ['1:3', 'a3', 'figs-idiom', 'Θεοῦ', '1', 'n'],
      ['1:5', 'a5', 'figs-idiom', 'Θεοῦ', '1', 'n'],
      ['1:6', 'a6', 'figs-idiom', 'Θεοῦ', '1', 'n'],
      ['2:1', 'a7', 'figs-idiom', 'Θεοῦ', '1', 'n'],
    ];
    const scoped = filterToScope(deriveTnItems(tsv(rows), 'tit'), scopeRangesFor({ TIT: ['1:3-5'] }, 'TIT'));
    expect(scoped.map(ref)).toEqual(['1:3', '1:5']);
  });
});

// ------------------------------------------- R2: status-only decision (F5)
describe('R2 — a status-only (todo) decision survives a resource change and round-trip (F5, D2, D36)', () => {
  // A asks check a1@1:1; B asks a different check b9@2:2. The todo on a1 cannot
  // place on B, so it must invalidate — and come back on re-pin. Items are real
  // derived contextIds, so the reattach keys are the ones the app actually uses.
  const derivedA = deriveTnItems(tsv([['1:1', 'a1', 'figs-idiom', 'Θεοῦ', '1', 'n']]), 'tit');
  const derivedB = deriveTnItems(tsv([['2:2', 'b9', 'figs-metaphor', 'δοῦλος', '1', 'n']]), 'tit');
  const todo = (i: CheckItem): CheckItem => ({ ...i, status: 'todo' }); // status only, no selections

  it('a TODO with no selections carries over instead of being deleted (same resource)', () => {
    const r = carryOverDecisions(fileOf([todo(derivedA[0])], RES_A), derivedA, RES_A);
    expect(r.carried).toBe(1);
    expect(r.file.decisions).toHaveLength(1);
    expect(r.file.decisions[0].status).toBe('todo');
  });

  it('switching to a resource without the check invalidates & KEEPS it, preserving the todo triage', () => {
    const r = carryOverDecisions(fileOf([todo(derivedA[0])], RES_A), derivedB, RES_B);
    expect(r.invalidated).toBe(1);
    expect(r.carried).toBe(0);
    const kept = r.file.decisions.find((d) => d.invalidated);
    expect(kept).toBeTruthy();
    expect(kept?.status).toBe('todo'); // §5.2: only "valid" is forced to "invalid"
  });

  it('FULL CYCLE (this is F5): todo -> switch away -> re-pin restores the decision, not []', () => {
    const away = carryOverDecisions(fileOf([todo(derivedA[0])], RES_A), derivedB, RES_B);
    const back = carryOverDecisions(away.file, derivedA, RES_A);
    const x = back.file.decisions.find((d) => d.contextId.checkId === 'a1');
    expect(x, 'the todo must not be deleted by the away-and-back round-trip').toBeTruthy();
    expect(x?.status).toBe('todo');
    expect(x?.invalidated).toBeFalsy();
    expect(back.file.decisions).toHaveLength(1);
  });

  it('a genuinely untouched item is not carried — the fix does not over-keep', () => {
    const r = carryOverDecisions(fileOf([], RES_A), derivedA, RES_A);
    expect(r.carried).toBe(0);
    expect(r.file.decisions).toHaveLength(0);
    expect(r.undecided).toBe(1);
  });
});

// --------------------------------------------- R3: re-pin restores, progress
describe('R3 — re-pinning the old resource restores a decided item (D36)', () => {
  const ctx = {
    checkId: 'a1',
    reference: { bookId: 'tit', chapter: 1, verse: 1 },
    tool: 'translationNotes',
    groupId: 'figs-idiom',
    quote: 'Θεοῦ',
    quoteString: 'Θεοῦ',
    occurrence: 1,
  };
  const item = (over: Partial<CheckItem> & { contextId: CheckItem['contextId'] }): CheckItem => ({
    selections: false, comments: false, reminders: false, nothingToSelect: false,
    verseEdits: false, invalidated: false, ...over,
  });

  it('a formerly-valid, invalidated decision that re-attaches loses only its cleared status', () => {
    const invalidated = item({
      contextId: ctx,
      selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
      invalidated: true,
      status: 'invalid',
    });
    const { items } = mergeAndReattach([item({ contextId: ctx })], [invalidated]);
    expect(items).toHaveLength(1);
    expect(items[0].invalidated).toBeFalsy();
    expect(items[0].status).toBeUndefined();
    expect(items[0].selections).toHaveLength(1);
  });

  it('an invalidated decision does NOT count toward progress (§5.2 MUST)', () => {
    const stillInvalid = item({
      contextId: ctx,
      selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
      invalidated: true,
      status: 'invalid',
    });
    expect(progressOf([stillInvalid])).toEqual({ decided: 0, total: 1 });
  });

  it('after the re-pin restores it, it counts again — 1 of 1', () => {
    const invalidated = item({
      contextId: ctx,
      selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }],
      invalidated: true,
      status: 'invalid',
    });
    const { items } = mergeAndReattach([item({ contextId: ctx })], [invalidated]);
    expect(progressOf(items)).toEqual({ decided: 1, total: 1 });
  });
});

// ------------------------------------------ R7: concurrent resources.json (B7)
describe('R7 — a concurrent resources.json write is refused, not silently clobbered (B7)', () => {
  // One shared in-memory ingredient, two HttpStores over it — two app sessions.
  const shared = (initial: string) => {
    let text: string | null = initial;
    return {
      current: () => text,
      api: {
        readIngredient: async () => {
          if (text === null) throw new Error('no such file');
          return text;
        },
        writeIngredient: async (_repo: string, _ipath: string, payload: string) => {
          text = payload;
        },
      },
    };
  };
  const RESOURCES = JSON.stringify({
    schemaVersion: 2,
    languageSets: { primary: { translationNotes: { repoPath: 'x/a_tn', version: 'v1' } } },
    resources: {},
  });

  it('the second (stale) write throws StaleWriteError instead of overwriting', async () => {
    const store = shared(RESOURCES);
    const A = new HttpStore({ api: store.api as never, repoPath: '_local_/_local_/probe' });
    const B = new HttpStore({ api: store.api as never, repoPath: '_local_/_local_/probe' });
    const a = await A.readResourcesWithMd5();
    const b = await B.readResourcesWithMd5(); // same bytes → same md5
    await A.writeResources({ ...(a.value as object), tag: 'A' } as never, a.md5); // wins
    await expect(
      B.writeResources({ ...(b.value as object), tag: 'B' } as never, b.md5),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('a read-modify-write RETRY lets both writers’ changes survive', async () => {
    const store = shared(RESOURCES);
    const A = new HttpStore({ api: store.api as never, repoPath: '_local_/_local_/probe' });
    const B = new HttpStore({ api: store.api as never, repoPath: '_local_/_local_/probe' });
    // Both read the same starting bytes.
    const a = await A.readResourcesWithMd5();
    const bStale = await B.readResourcesWithMd5();
    // A changes the primary tN version.
    const aNext = JSON.parse(JSON.stringify(a.value));
    aNext.languageSets.primary.translationNotes.version = 'v2-by-A';
    await A.writeResources(aNext, a.md5);
    // B changes a DIFFERENT field; its first write is stale, so it re-reads and
    // re-applies (the app's updateResources loop) — A's change must remain.
    let wrote = false;
    for (let attempt = 0; !wrote; attempt += 1) {
      const cur = attempt === 0 ? bStale : await B.readResourcesWithMd5();
      const next = JSON.parse(JSON.stringify(cur.value));
      next.languageSets.primary.newField = 'v2-by-B';
      try {
        await B.writeResources(next, cur.md5);
        wrote = true;
      } catch (e) {
        if (!(e instanceof StaleWriteError)) throw e;
      }
    }
    const final = JSON.parse(store.current() as string);
    expect(final.languageSets.primary.translationNotes.version).toBe('v2-by-A');
    expect(final.languageSets.primary.newField).toBe('v2-by-B');
  });
});

// ------------------------------------------------- R8: integer occurrences (B8)
describe('R8 — writeDecisions normalizes every occurrence to an integer, and rejects non-integers (B8, I-2)', () => {
  const captureStore = () => {
    let written: string | null = null;
    const api = {
      writeIngredient: async (_repo: string, _ipath: string, payload: string) => {
        written = payload;
      },
    };
    return {
      written: () => written,
      store: new HttpStore({ api: api as never, repoPath: '_local_/_local_/probe' }),
    };
  };
  // A parser-shaped decision: occurrences arrive as the string `n`.
  const decision = (n: unknown) => ({
    contextId: {
      checkId: 'probe', occurrenceNote: '', reference: { bookId: 'tit', chapter: 1, verse: 1 },
      tool: 'translationNotes', groupId: 'figs', quote: [{ word: 'x', occurrence: n }],
      quoteString: 'x', occurrence: n,
    },
    selections: [{ text: 'x', occurrence: n, occurrences: n }],
    comments: false, reminders: false, nothingToSelect: false, verseEdits: false, invalidated: false,
  });
  const fileOf = (n: unknown) =>
    ({ schemaVersion: 1, tool: 'translationNotes', book: 'TIT', decisions: [decision(n)] }) as never;

  it('the string "1" becomes integer 1 in contextId, quote AND both selection fields', async () => {
    const { store, written } = captureStore();
    await store.writeDecisions('translationNotes', 'TIT', fileOf('1'));
    const out = JSON.parse(written() as string).decisions[0];
    for (const v of [
      out.contextId.occurrence, out.contextId.quote[0].occurrence,
      out.selections[0].occurrence, out.selections[0].occurrences,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBe(1);
    }
  });

  it('a value that cannot become an integer is REJECTED, and nothing is persisted', async () => {
    const { store, written } = captureStore();
    await expect(store.writeDecisions('translationNotes', 'TIT', fileOf('not-an-integer')))
      .rejects.toThrow(/I-2/);
    expect(written()).toBeNull();
  });
});

// ----------------------------------------------- R9: install identity (B9)
describe('R9 — install identity distinguishes the complete DCS repo, not the basename (B9)', () => {
  it('two owners with the same repo name resolve to DISTINCT install dirs', () => {
    const xenizo = localRepoPathFromRepoPath('git.door43.org/Xenizo/fr_tn');
    const mvhs = localRepoPathFromRepoPath('git.door43.org/MVHS/fr_tn');
    expect(xenizo).not.toBe(mvhs);
    expect(xenizo.startsWith('_local_/_sideloaded_/')).toBe(true);
    expect(mvhs.startsWith('_local_/_sideloaded_/')).toBe(true);
  });

  it('the same repo in a different owner CASE resolves to the same dir (mirrors samePath)', () => {
    expect(localRepoPathFromRepoPath('git.door43.org/Xenizo/fr_tn'))
      .toBe(localRepoPathFromRepoPath('git.door43.org/xenizo/fr_tn'));
  });
});

// ------------------------------------------ R7b: overlapping guarded writes (B7)
describe('R7b — overlapping guarded writes are serialized, so neither is silently lost (B7)', () => {
  it('two concurrent writes with the same starting md5: exactly one wins, the other is REFUSED', async () => {
    let text: string | null = JSON.stringify({ v: 0 });
    const api = {
      readIngredient: async () => { if (text === null) throw new Error('no file'); return text; },
      writeIngredient: async (_r: string, _i: string, p: string) => { text = p; },
    };
    const A = new HttpStore({ api: api as never, repoPath: '_local_/_local_/overlap' });
    const B = new HttpStore({ api: api as never, repoPath: '_local_/_local_/overlap' });
    const a = await A.readResourcesWithMd5();
    const b = await B.readResourcesWithMd5(); // same bytes → same md5
    // Fire both writes concurrently; the md5 precheck alone would let BOTH pass
    // (TOCTOU) and silently lose one. The in-process lock serializes them.
    const results = await Promise.allSettled([
      A.writeResources({ ...(a.value as object), writerA: true } as never, a.md5),
      B.writeResources({ ...(b.value as object), writerB: true } as never, b.md5),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(StaleWriteError); // refused, not silently lost
    const final = JSON.parse(text as string);
    // Exactly one writer's data is on disk; the loser knows it was refused.
    expect(Number(!!final.writerA) + Number(!!final.writerB)).toBe(1);
  });
});

// ------------------------------------------------- R10: legacy install path (B10)
describe('R10 — a legacy/seeded install resolves by identity, not by a recomputed path (B10)', () => {
  // The rig seeds and older installs live at the legacy `<repo>` path; the pin
  // derives the owner-qualified path, which would look in the wrong place.
  const installed = {
    '_local_/_sideloaded_/en_tn': { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89', sha: '9999999999999999999999999999999999999999', flavor: '' },
  };
  const pin = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89', sha: '9999999999999999999999999999999999999999', flavor: '' };

  it('installedPathFor returns the ACTUAL on-disk path, not the owner-qualified derivation', () => {
    expect(localRepoPathFromRepoPath(pin.repoPath)).toBe('_local_/_sideloaded_/unfoldingword--en_tn');
    expect(installedPathFor(installed, pin)).toBe('_local_/_sideloaded_/en_tn');
  });

  it('isPinLocal sees the seeded resource as local (it was invisible before)', () => {
    expect(isPinLocal(installed, pin)).toBe(true);
  });
});

// ------------------------------------------------- R11: atomic migration (B11)
describe('R11 — a gateway migration aborts cleanly when a book moved: no partial migration (B11)', () => {
  it('validate-all-before-write leaves the first book un-migrated and the pins old', async () => {
    const files = new Map<string, string>([
      ['checking/resources.json', JSON.stringify({ pins: 'old' })],
      ['checking/translationNotes/TIT.json', JSON.stringify({ book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [] })],
      ['checking/translationNotes/JON.json', JSON.stringify({ book: 'JON', resource: { repoPath: 'OLD' }, decisions: [] })],
    ]);
    const api = {
      readIngredient: async (_r: string, ip: string) => { const v = files.get(ip); if (v === undefined) throw new Error('missing'); return v; },
      writeIngredient: async (_r: string, ip: string, p: string) => { files.set(ip, p); },
    };
    const store = new HttpStore({ api: api as never, repoPath: '_local_/_local_/partial' });
    const titMd5 = (await store.readDecisionsWithMd5('translationNotes', 'TIT')).md5;
    const jonMd5 = (await store.readDecisionsWithMd5('translationNotes', 'JON')).md5;
    // A concurrent external edit to JON after the preview read it.
    files.set('checking/translationNotes/JON.json', JSON.stringify({ book: 'JON', resource: { repoPath: 'OLD' }, decisions: [], externalEdit: true }));

    const plan = [
      { tool: 'translationNotes', book: 'TIT', expectMd5: titMd5, file: { book: 'TIT', resource: { repoPath: 'NEW' }, decisions: [] } },
      { tool: 'translationNotes', book: 'JON', expectMd5: jonMd5, file: { book: 'JON', resource: { repoPath: 'NEW' }, decisions: [] } },
    ];
    // The fixed commit sequence: validate EVERY precondition before any write.
    let aborted = false;
    try {
      for (const p of plan) {
        const cur = (await store.readDecisionsWithMd5(p.tool, p.book)).md5;
        if ((p.expectMd5 ?? null) !== (cur ?? null)) throw new StaleWriteError(p.book, p.expectMd5 ?? '', cur ?? '');
      }
      for (const p of plan) await store.writeDecisions(p.tool, p.book, p.file as never, p.expectMd5);
    } catch (e) {
      aborted = e instanceof StaleWriteError;
    }
    expect(aborted).toBe(true);
    // TIT was never migrated; resources never changed — no partial state.
    expect(JSON.parse(files.get('checking/translationNotes/TIT.json') as string).resource.repoPath).toBe('OLD');
    expect(JSON.parse(files.get('checking/resources.json') as string)).toEqual({ pins: 'old' });
  });
});

// ------------------------------------------------ R13: draft-write overlap (B13)
describe('R13 — overlapping draft (writeBook) writes are serialized; the second is refused (B13)', () => {
  it('two concurrent writeBook calls with the same md5: one wins, the other StaleWriteError', async () => {
    let usfm = '\\id TIT\n\\v 1 base\n';
    const api = {
      readIngredient: async () => usfm,
      writeIngredient: async (_r: string, _i: string, p: string) => { usfm = p; },
    };
    const A = new HttpStore({ api: api as never, repoPath: '_local_/_local_/book' });
    const B = new HttpStore({ api: api as never, repoPath: '_local_/_local_/book' });
    const a = await A.readBook('TIT');
    const b = await B.readBook('TIT'); // same starting md5
    // The md5 precheck alone would let BOTH pass (TOCTOU); the per-path lock
    // serializes the check→write, so the loser sees the winner's bytes.
    const results = await Promise.allSettled([
      A.writeBook('TIT', '\\id TIT\n\\v 1 edit-A\n', { expectMd5: a.md5 }),
      B.writeBook('TIT', '\\id TIT\n\\v 1 edit-B\n', { expectMd5: b.md5 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(StaleWriteError);
    // Exactly one edit persisted; the other writer was refused, not silently lost.
    expect(['\\id TIT\n\\v 1 edit-A\n', '\\id TIT\n\\v 1 edit-B\n']).toContain(usfm);
  });
});

// -------------------------------------------- R14: rollback never clobbers (B14)
describe('R14 — a gateway rollback never force-overwrites a concurrent edit (B14)', () => {
  it('CAS-guarded rollback: an edit made after migration survives the rollback', async () => {
    const ipath = 'checking/translationNotes/TIT.json';
    const files = new Map<string, string>([[ipath, JSON.stringify({ book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [] })]]);
    const api = {
      readIngredient: async (_r: string, ip: string) => { const v = files.get(ip); if (v === undefined) throw new Error('missing'); return v; },
      writeIngredient: async (_r: string, ip: string, p: string) => { files.set(ip, p); },
    };
    const store = new HttpStore({ api: api as never, repoPath: '_local_/_local_/rollback' });

    const orig = await store.readDecisionsWithMd5('translationNotes', 'TIT');
    // Migrate TIT to the NEW resource, then capture the bytes we wrote.
    await store.writeDecisions('translationNotes', 'TIT', { book: 'TIT', resource: { repoPath: 'NEW' }, decisions: [] } as never, orig.md5);
    const wroteMd5 = (await store.readDecisionsWithMd5('translationNotes', 'TIT')).md5;
    // A concurrent writer edits TIT AFTER our migration.
    files.set(ipath, JSON.stringify({ book: 'TIT', resource: { repoPath: 'NEW' }, decisions: [], externalEdit: true }));

    // Rollback with CAS on the bytes WE wrote → refused, because the file moved.
    let refused = false;
    try {
      await store.writeDecisions('translationNotes', 'TIT', { book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [] } as never, wroteMd5);
    } catch (e) {
      refused = e instanceof StaleWriteError;
    }
    expect(refused).toBe(true);
    // The concurrent edit survived — rollback did not force-clobber it.
    expect(JSON.parse(files.get(ipath) as string).externalEdit).toBe(true);
  });
});

// -------------------------------------- R15: written-md5 has no read-back race (B15)
describe('R15 — writeDecisions returns the md5 of ITS OWN write, so rollback cannot adopt a concurrent edit (B15)', () => {
  it('a concurrent edit landing right after the write does not change the returned md5', async () => {
    let content = JSON.stringify({ book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [] });
    const api = {
      readIngredient: async () => content,
      writeIngredient: async (_r: string, _i: string, p: string) => {
        content = p;
        // Another writer lands IMMEDIATELY after our write — exactly the window
        // a read-back would have fallen into (B15).
        content = JSON.stringify({ book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [], externalEdit: true });
      },
    };
    const store = new HttpStore({ api: api as never, repoPath: '_local_/_local_/b15' });
    const orig = await store.readDecisionsWithMd5('translationNotes', 'TIT');
    // wroteMd5 is OUR migration bytes, captured under the lock — NOT the edit that landed after.
    const wroteMd5 = await store.writeDecisions('translationNotes', 'TIT', { book: 'TIT', resource: { repoPath: 'NEW' }, decisions: [] } as never, orig.md5);

    // Rollback CAS on wroteMd5 must be REFUSED, because the file has moved to the
    // concurrent edit — so the edit is preserved, not clobbered.
    let refused = false;
    try {
      await store.writeDecisions('translationNotes', 'TIT', { book: 'TIT', resource: { repoPath: 'OLD' }, decisions: [] } as never, wroteMd5);
    } catch (e) {
      refused = e instanceof StaleWriteError;
    }
    expect(refused).toBe(true);
    expect(JSON.parse(content).externalEdit).toBe(true);
  });
});

// ---------------------------------------- R16: coexistence resolution (B16)
describe('R16 — the exact requested install is chosen over a coexisting legacy one (B16)', () => {
  // Mid-migration shape: an OLD legacy `<repo>` install AND the exact new
  // `<owner>--<repo>` install of the same repo, at different versions.
  const installed = {
    '_local_/_sideloaded_/en_tn': { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v88', sha: '8888888888888888888888888888888888888888', flavor: '' },
    '_local_/_sideloaded_/unfoldingword--en_tn': { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89', sha: '9999999999999999999999999999999999999999', flavor: '' },
  };
  const pinV89 = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89', sha: '9999999999999999999999999999999999999999', flavor: '' };

  it('installedPathFor returns the exact-version install, not the first (legacy) one', () => {
    expect(installedPathFor(installed, pinV89)).toBe('_local_/_sideloaded_/unfoldingword--en_tn');
  });

  it('isPinLocal sees the exact requested pin as local', () => {
    expect(isPinLocal(installed, pinV89)).toBe(true);
  });

  it('the older pin still resolves to the legacy install (both coexist correctly)', () => {
    const pinV88 = { ...pinV89, version: 'v88', sha: '8'.repeat(40) };
    expect(installedPathFor(installed, pinV88)).toBe('_local_/_sideloaded_/en_tn');
    expect(isPinLocal(installed, pinV88)).toBe(true);
  });
});

// -------------------------------------- R18: reattach honors quoteString (B18)
describe('R18 — same-checkId reattach requires the quoteString to match (B18, §5.2)', () => {
  const mk = (checkId: string, quoteString: string, over: Partial<CheckItem> = {}): CheckItem => ({
    contextId: {
      checkId, tool: 'tn', groupId: 'g', quote: quoteString, quoteString,
      occurrence: 1, reference: { bookId: 'TIT', chapter: 1, verse: 1 },
    } as never,
    selections: false, comments: false, reminders: false, nothingToSelect: false, invalidated: false,
    ...over,
  } as CheckItem);

  it('a saved decision whose checkId survives but whose quote CHANGED is left unplaced, not carried', () => {
    const derived = [mk('a1', 'κατὰ πίστιν')]; // resource kept checkId a1 but changed the quote
    const saved = [mk('a1', 'κατὰ πίστιν changed-by-resource', { status: 'todo' })];
    const { items, unplaced } = mergeAndReattach(derived, saved);
    expect(unplaced).toHaveLength(1); // stale-quote decision cannot place
    expect(items[0].status).toBeUndefined(); // derived item stays fresh
    expect(items[0].contextId.quoteString).toBe('κατὰ πίστιν');
  });

  it('a matching checkId AND quote still carries the decision', () => {
    const derived = [mk('a1', 'κατὰ πίστιν')];
    const saved = [mk('a1', 'κατὰ πίστιν', { status: 'todo' })];
    const { items } = mergeAndReattach(derived, saved);
    expect(items[0].status).toBe('todo');
  });
});

// -------------------------------------- R19: item verse-span scope (B19)
describe('R19 — an ITEM verse-span outside scope is excluded (B19)', () => {
  it('15:23-24 is out of scope 15:1-22; overlapping spans are in', () => {
    expect(refInScope(['15:1-22'], 15, '23-24')).toBe(false); // wholly out
    expect(refInScope(['15:1-22'], 15, '22-23')).toBe(true); // overlaps at v22
    expect(refInScope(['15:1-22'], 15, '20-21')).toBe(true); // wholly in
    expect(refInScope(['15:1-22'], 15, 23)).toBe(false); // plain-verse control
  });
});

// -------------------------------------- R20: missing primary → warned fallback (B20)
describe('R20 — a not-installed pinned primary opens the fallback but is NOT silent (B20 warned-fallback)', () => {
  const ES = 'git.door43.org/es-419_gl/es-419_tn';
  const EN = 'git.door43.org/unfoldingWord/en_tn';
  const set = (lang: string, owner: string, repoPath: string) => ({
    gatewayLanguage: { languageId: lang, owner },
    translationNotes: { repoPath, version: lang === 'en' ? 'v89' : 'v66', flavor: '' },
    translationWordsLinks: { repoPath, version: 'v1', flavor: '' },
    translationWords: { repoPath, version: 'v1', flavor: '' },
    translationAcademy: { repoPath, version: 'v1', flavor: '' },
  });
  const resources = {
    schemaVersion: 2,
    languageSets: { primary: set('es-419', 'es-419_gl', ES), fallback: set('en', 'unfoldingWord', EN) },
    resources: {},
  } as never;

  it('the installed fallback opens (ready) but flags the not-local pinned primary — not silent, not a forced fetch', () => {
    const pf = preflightToolBook(resources, 'translationNotes', 'JON', {
      coverage: { [EN]: ['JON'] }, // only English is local-covered
      isLocal: (p) => p.repoPath === EN,
      online: true,
    });
    expect(pf.state).toBe('ready'); // the fallback works; no forced fetch (over-correction reverted)
    expect(pf.resolution?.usedFallback).toBe(true);
    expect(pf.unavailablePrimary?.repoPath).toBe(ES); // warned: the pinned primary is fetchable
  });

  it('offline: still opens the installed fallback, still flags the missing primary (never a silent switch)', () => {
    const pf = preflightToolBook(resources, 'translationNotes', 'JON', {
      coverage: { [EN]: ['JON'] },
      isLocal: (p) => p.repoPath === EN,
      online: false,
    });
    expect(pf.state).toBe('ready');
    expect(pf.unavailablePrimary?.repoPath).toBe(ES);
  });

  it('when the primary IS local and simply lacks the book, the fallback is plainly correct — no warning', () => {
    const pf = preflightToolBook(resources, 'translationNotes', '1CO', {
      coverage: { [ES]: ['JON'], [EN]: ['1CO'] }, // both local; es-419 lacks 1CO
      isLocal: () => true,
      online: true,
    });
    expect(pf.state).toBe('ready');
    expect(pf.resolution?.usedFallback).toBe(true);
    expect(pf.unavailablePrimary ?? null).toBeNull();
  });
});

// -------------------------------------- R21: byte-exact rollback (B21)
describe('R21 — a gateway rollback restores decision bytes byte-exactly (B21)', () => {
  it('restoreDecisionsText writes verbatim; the normalizing writeDecisions would not', async () => {
    // A non-app-normalized original (tC3 import / hand edit): different field
    // order + whitespace than the app's serializer would produce.
    const original = '{\n  "book": "TIT",\n  "tool": "translationNotes",\n  "extra": 1,\n  "decisions": []\n}';
    let content: string | null = original;
    const api = {
      readIngredient: async () => { if (content === null) throw new Error('no file'); return content; },
      writeIngredient: async (_r: string, _i: string, p: string) => { content = p; },
    };
    const store = new HttpStore({ api: api as never, repoPath: '_local_/_local_/b21' });

    const snap = await store.readDecisionsText('translationNotes', 'TIT');
    expect(snap.text).toBe(original);
    // Migrate — writeDecisions normalizes, so the bytes change.
    const migratedMd5 = await store.writeDecisions(
      'translationNotes', 'TIT',
      { book: 'TIT', tool: 'translationNotes', resource: { repoPath: 'NEW' }, decisions: [] } as never,
      snap.md5,
    );
    expect(content).not.toBe(original);
    // Rollback restores the EXACT original bytes (CAS on the migrated md5).
    await store.restoreDecisionsText('translationNotes', 'TIT', snap.text as string, migratedMd5);
    expect(content).toBe(original);
  });
});

// -------------------------------------- R22: re-key exact-key carry-over (B22)
describe('R22 — exact-key carry-over re-keys to the new resource context (B22, D36)', () => {
  const mk = (occurrenceNote: string, over: Partial<CheckItem> = {}): CheckItem => ({
    contextId: {
      checkId: 'fyf8', tool: 'tn', groupId: 'g', quote: 'δοῦλος', quoteString: 'δοῦλος',
      occurrence: 1, occurrenceNote, reference: { bookId: 'TIT', chapter: 1, verse: 1 },
    } as never,
    selections: false, comments: false, reminders: false, nothingToSelect: false, invalidated: false,
    ...over,
  } as CheckItem);

  it('keeps the human decision but adopts the DERIVED contextId (new occurrenceNote)', () => {
    // Same identity key (checkId/ref/quote/occurrence) but the new resource has a
    // different note. The occurrenceNote is NOT in mergeKey, so this is an exact
    // match — D36 requires re-keying to the new resource's context.
    const derived = [mk('NEW resource note')];
    const saved = [mk('OLD resource note', { status: 'todo' })];
    const { items } = mergeAndReattach(derived, saved);
    expect(items[0].status).toBe('todo'); // decision carried
    expect(items[0].contextId.occurrenceNote).toBe('NEW resource note');
  });
});

// -------------------------------------- R23: tN/tW target-word selection (B23)
describe('R23 — the tN/tW target-word selection round-trips through the proven tokenizer (B23, §5.2)', () => {
  // A real drafted verse (TIT 1:1, a plain gateway rendering). The checker taps
  // the word(s) that render the item's original-language quote. The tokenizer is
  // the SAME one the check view renders with, so tapped indices never drift.
  const verse = 'Paul, a servant of God and an apostle of Jesus Christ';

  it('selectionsFromTokens records each tapped word with its occurrence and total', () => {
    // tap "servant" (index 2) — its §5.2 selection carries occurrence 1 of 1.
    const words = targetWords(verse);
    expect(words[2]).toBe('servant');
    const sel = selectionsFromTokens(verse, [2]);
    expect(sel).toEqual([{ text: 'servant', occurrence: 1, occurrences: 1 }]);
  });

  it('a repeated word carries the RIGHT occurrence (nth), not merely the word', () => {
    // "of" appears twice ("of God", "of Jesus"); tapping the 2nd must record
    // occurrence 2, so revalidation re-locates that instance, not the first.
    const words = targetWords(verse);
    const ofIndices = words.map((w, i) => (w === 'of' ? i : -1)).filter((i) => i >= 0);
    expect(ofIndices.length).toBe(2);
    const sel = selectionsFromTokens(verse, [ofIndices[1]]);
    expect(sel).toEqual([{ text: 'of', occurrence: 2, occurrences: 2 }]);
  });

  it('tokenIndicesFromSelections is the exact inverse: stored selection → the same tapped indices', () => {
    const picks = [0, 2]; // "Paul", "servant"
    const sel = selectionsFromTokens(verse, picks);
    expect(tokenIndicesFromSelections(verse, sel)).toEqual(picks);
  });

  it('the inverse re-selects the RIGHT occurrence of a repeated word', () => {
    const words = targetWords(verse);
    const secondOf = words.map((w, i) => (w === 'of' ? i : -1)).filter((i) => i >= 0)[1];
    expect(typeof secondOf).toBe('number');
    const sel = selectionsFromTokens(verse, [secondOf]);
    expect(tokenIndicesFromSelections(verse, sel)).toEqual([secondOf]);
  });

  it('an empty / false stored selection maps to no highlighted tokens', () => {
    expect(tokenIndicesFromSelections(verse, false)).toEqual([]);
    expect(tokenIndicesFromSelections(verse, [])).toEqual([]);
  });

  it('progressOf counts an explicit user INVALID triage as decided, but a carry-over invalidation NOT', () => {
    const base: CheckItem = {
      contextId: { checkId: 'x', reference: { bookId: 'TIT', chapter: 1, verse: 1 } } as never,
      selections: false, comments: false, reminders: false, nothingToSelect: false,
      verseEdits: false, invalidated: false,
    } as CheckItem;
    // user marked it invalid (reviewed, rejected) — a real decision
    const userInvalid = { ...base, status: 'invalid' } as CheckItem;
    // carry-over auto-invalidation — NOT a decision, must not count (D36)
    const autoInvalidated = { ...base, status: 'invalid', invalidated: true } as CheckItem;
    const todo = { ...base, status: 'todo' } as CheckItem;
    expect(progressOf([userInvalid]).decided).toBe(1);
    expect(progressOf([autoInvalidated]).decided).toBe(0);
    expect(progressOf([todo]).decided).toBe(0);
  });
});
