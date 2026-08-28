// Regression tests for the 2026-07-30 adversarial code-review findings.
// Each test is named for its finding; if one fails, read the review record in
// docs/guided-build/phases/PHASE-1-SUMMARY.md before touching the guard.
import { describe, it, expect } from 'vitest';
import usfm from 'usfm-js';
import { seedBookFromSource, seedMatchesSource } from '../src/data/seed';
import { spliceVerse, verseBody } from '../src/data/usfm/splice';
import { indexBook } from '../src/data/usfm/indexer';
import { SaveScheduler } from '../src/data/saveScheduler';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ULT_TIT = fs.readFileSync(path.join(HERE, 'fixtures', 'en_ult', 'TIT.usfm'), 'utf8');

// A synthetic psalm-shaped source with every hard case B1/M3 found in the real
// corpus: mid-line \v after a paragraph marker, \d superscription, an empty
// \v line, and a marker-with-text line.
const PSALM_SHAPE = [
  '\\id PSA test',
  '\\c 131',
  '\\d ___A psalm of ascents.',
  '\\q1 \\v 1 My heart is not proud,',
  '\\q2 my eyes are not haughty.',
  '\\v 2',
  '\\q1 But I have calmed and quieted my soul.',
  '\\q1 \\v 3 Hope in Yahweh now and forever.',
  '\\c 132',
  '\\p \\v 1 Remember, Yahweh.',
].join('\n');

describe('B1 — seeding reads mid-line \\v markers (marker stream, not line walk)', () => {
  const seeded = seedBookFromSource(PSALM_SHAPE, {
    bookCode: 'PSA',
    bookName: 'Psalms',
    projectName: 'x',
  });

  it('keeps every verse the usfm-js oracle sees, including mid-line ones', () => {
    const oracle = usfm.toJSON(PSALM_SHAPE).chapters as Record<string, Record<string, unknown>>;
    for (const c of Object.keys(oracle)) {
      for (const v of Object.keys(oracle[c])) {
        if (/^\d/.test(v)) {
          expect(seeded, `verse ${c}:${v}`).toMatch(new RegExp(`^\\\\v ${v} ___$`, 'm'));
        }
      }
    }
  });

  it('gives the \\d superscription a translatable stub slot', () => {
    expect(seeded).toMatch(/^\\d ___$/m);
  });

  it('seedMatchesSource uses an independent oracle (would catch a dropped verse)', () => {
    expect(seedMatchesSource(seeded, PSALM_SHAPE)).toBe(true);
    const mutilated = seeded.replace('\\v 2 ___\n', '');
    expect(seedMatchesSource(mutilated, PSALM_SHAPE)).toBe(false);
  });

  // A whole-corpus leg: ~2s alone, but the default 5s times out under the
  // full suite's parallel load (observed 5.9s/7.6s, 2026-08-22).
  it('full en_ult corpus leg: seeded verse sets match the oracle for every book (skips without the cache)', { timeout: 30_000 }, () => {
    const cache = path.resolve(HERE, '..', '..', 'dev-env', 'resources-cache', 'en_ult-v89-unwrapped.zip');
    if (!fs.existsSync(cache)) {
      console.warn('corpus leg skipped: resources cache absent');
      return;
    }
    // node has no zip reader built in; sample the hard books via unzip -p
    const { execFileSync } = process.getBuiltinModule('node:child_process');
    for (const code of ['PSA', 'PRO', 'JOB', 'LAM', 'SNG', 'GEN', 'LUK', 'MAT', 'ACT']) {
      const src = execFileSync('unzip', ['-p', cache, `ingredients/${code}.usfm`], {
        maxBuffer: 32 * 1024 * 1024,
      }).toString('utf8');
      const seededBook = seedBookFromSource(src, { bookCode: code, bookName: code, projectName: 'x' });
      expect(seedMatchesSource(seededBook, src), `${code} verse set`).toBe(true);
    }
  });
});

describe('M3 — splice never glues a body onto a contentless \\v key', () => {
  const raw = PSALM_SHAPE;
  it('writing into the empty verse inserts a separator and stays addressable', () => {
    const once = spliceVerse(raw, 131, '2', 'Hola');
    expect(once).toMatch(/^\\v 2 Hola$/m);
    // the verse remains addressable for the next keystroke
    const twice = spliceVerse(once, 131, '2', 'Hola mundo');
    expect(verseBody(twice, 131, '2')).toContain('Hola mundo');
  });
  it('the identity splice of an empty body stays byte-exact', () => {
    const entry = indexBook(raw).find((e) => e.chapter === '131' && e.verseKey === '2');
    expect(entry).toBeTruthy();
    expect(spliceVerse(raw, 131, '2', raw.slice(entry!.start, entry!.end))).toBe(raw);
  });
});

describe('M4 — upsertDecision matches identity key AND quoteString together', () => {
  it('a quote change creates ONE new record; later upserts update it, never append (rig required)', async () => {
    const probe = await fetch('http://127.0.0.1:19998/api/version').catch(() => null);
    if (!probe?.ok) {
      console.warn('M4 leg skipped: rig not running');
      return;
    }
    // A SCRATCH project, never the shared seeded one: these raw-store writes
    // bypass the journal, so on a journaled project they are exactly the
    // derived-state divergence the open guard refuses (issue #123, F1).
    // The name is unique per run (#124 review): a fixed name could collide
    // with — and the cleanup delete — a real project or a concurrent run.
    const { HttpStore } = await import('../src/data/httpStore');
    const { isNotFoundError } = await import('../src/data/serverApi');
    const store = new HttpStore({ baseUrl: 'http://127.0.0.1:19998/api' });
    const { repoPath } = await store.createProject({
      content_name: 'M4 scratch',
      content_abbr: `m4scratch${Date.now().toString(36)}`,
      content_language_code: 'en',
      add_book: false,
      versification: 'eng',
    });
    await store.open(repoPath);
    const mk = (quote: string, comment: string) => ({
      contextId: {
        checkId: 'm4regress',
        occurrenceNote: '',
        reference: { bookId: 'tit', chapter: 9, verse: 9 },
        tool: 'translationWords',
        groupId: 'm4',
        quote,
        quoteString: quote,
        glQuote: '',
        occurrence: 1,
      },
      selections: false as const,
      comments: comment as string | false,
      reminders: false,
      nothingToSelect: false,
      verseEdits: false,
      invalidated: false,
    });
    try {
      await store.upsertDecision('translationWords', 'TIT', mk('old', 'v1'));
      await store.upsertDecision('translationWords', 'TIT', mk('new', 'v2'));
      await store.upsertDecision('translationWords', 'TIT', mk('new', 'v3'));
      await store.upsertDecision('translationWords', 'TIT', mk('new', 'v4'));
      const file = await store.readDecisions('translationWords', 'TIT');
      const mine = (file?.decisions ?? []).filter((d) => d.contextId.checkId === 'm4regress');
      // exactly two records: the orphaned old-quote one and ONE current-quote one
      expect(mine).toHaveLength(2);
      expect(mine.find((d) => d.contextId.quoteString === 'new')?.comments).toBe('v4');
      // Cleanup is part of the contract: a failed delete (other than a
      // confirmed not-found) leaves residue on the rig and must FAIL, never
      // be swallowed (#124 review). It runs here, after the assertions, so a
      // cleanup failure never masks a primary one.
      await store.api.deleteRepo(repoPath).catch((error) => {
        if (!isNotFoundError(error)) throw error;
      });
    } finally {
      // Best-effort sweep for the assertion-failure path only.
      await store.api.deleteRepo(repoPath).catch(() => {});
    }
  });
});

describe('B3/M1 — scheduler lifecycle guards', () => {
  const clock = { setTimeout: (fn: () => void) => ({ fn }), clearTimeout: () => {} };

  it('loadBook throws over unsaved work (stale-byte resurrection guard)', () => {
    const s = new SaveScheduler({
      writeBook: () => new Promise(() => {}),
      splice: spliceVerse,
      clock,
    });
    s.loadBook('TIT', ULT_TIT);
    s.markDirty('TIT', 1, '1', 'edited');
    expect(() => s.loadBook('TIT', ULT_TIT)).toThrow(/unsaved work/);
  });

  it('loadBook throws over a retained failed write (FR-32 buffer preservation)', async () => {
    const s = new SaveScheduler({
      writeBook: () => Promise.reject(new Error('disk full')),
      splice: spliceVerse,
      clock,
    });
    s.loadBook('TIT', ULT_TIT);
    s.markDirty('TIT', 1, '1', 'precious');
    await s.flushOnBlur();
    expect(s.getState()).toBe('error');
    expect(() => s.loadBook('TIT', ULT_TIT)).toThrow(/failed write/);
    expect(s.getFailure()?.usfm).toContain('precious');
  });

  it('drain flushes and reports clean; reports false while a failure persists', async () => {
    let fail = true;
    const disk: string[] = [];
    const s = new SaveScheduler({
      writeBook: (_b, text) =>
        fail ? Promise.reject(new Error('down')) : (disk.push(text), Promise.resolve()),
      splice: spliceVerse,
      clock,
    });
    s.loadBook('TIT', ULT_TIT);
    s.markDirty('TIT', 1, '1', 'kept text');
    expect(await s.drain()).toBe(false); // write failing → not clean, buffer kept
    fail = false;
    expect(await s.drain()).toBe(true); // drain retries the retained failure
    expect(disk.at(-1)).toContain('kept text');
  });
});
