// D65 (round-22 checkpoint, owner ruling 2026-08-28): comprehension notes
// ride their own SaveScheduler. This file pins the note WRITER (frame
// mapping, the unmappable refusal, the persisted-text echo) and restates the
// round-21 and round-22 defect classes against the REAL scheduler — they must
// be structurally impossible, not patched.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const resolveProjectFrame = vi.fn();
const mapReference = vi.fn();
vi.mock('../src/data/projectFrame', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProjectFrame: (...args: unknown[]) => resolveProjectFrame(...args),
}));
vi.mock('../src/data/mapReference', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mapReference: (...args: unknown[]) => mapReference(...args),
}));

import { __makeNoteWriterForTests as makeNoteWriter, noteKeyFor } from '../src/state.jsx';
import { SaveScheduler } from '../src/data/saveScheduler';
import { t } from '../src/i18n';

type Target = {
  store: { addNote: (...a: unknown[]) => Promise<void> };
  repoPath: string;
  book: string;
  chapter: number | string;
  verse: string;
  projectFrame: boolean;
};

const REPO = '_local_/_quarantine_/equipo';
const writerWith = (targets: Map<string, Target>) => {
  const dispatched: Array<Record<string, unknown>> = [];
  const writer = makeNoteWriter({
    noteTargetsRef: { current: targets },
    dispatch: (a: Record<string, unknown>) => dispatched.push(a),
    apiClient: {},
  });
  return { writer, dispatched };
};
const targetFor = (
  addNote: (...a: unknown[]) => Promise<void>,
  over: Partial<Target> = {},
): Target => ({
  store: { addNote },
  repoPath: REPO,
  book: 'TIT',
  chapter: 1,
  verse: '3',
  projectFrame: false,
  ...over,
});

beforeEach(() => {
  resolveProjectFrame.mockReset();
  mapReference.mockReset();
});

describe('D65 — the note writer', () => {
  it('a PROJECT-frame target writes its verbatim reference and echoes noteSaved (I1/J2)', async () => {
    const written: unknown[][] = [];
    const targets = new Map([
      [noteKeyFor(REPO, 'TIT', 2, '2'), targetFor(async (...a) => void written.push(a), { chapter: 2, verse: '2', projectFrame: true })],
    ]);
    const { writer, dispatched } = writerWith(targets);
    await writer(noteKeyFor(REPO, 'TIT', 2, '2'), '  note on project 2:2  ');
    expect(resolveProjectFrame).not.toHaveBeenCalled(); // verbatim — never mapped
    expect(written).toEqual([['TIT', 2, '2', 'note on project 2:2']]);
    expect(dispatched).toEqual([
      expect.objectContaining({ type: 'noteSaved', repoPath: REPO, book: 'TIT', key: '2:2', text: 'note on project 2:2' }),
    ]);
  });

  it('a same-frame target on the eng frame writes unmapped', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'eng' });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const { writer } = writerWith(new Map([[key, targetFor(async (...a) => void written.push(a))]]));
    await writer(key, 'plain note');
    expect(mapReference).not.toHaveBeenCalled();
    expect(written).toEqual([['TIT', 1, '3', 'plain note']]);
  });

  it('a same-frame target on a NON-eng frame writes the MAPPED reference; the echo keys the original (A1)', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'rsc', schemes: {} });
    mapReference.mockResolvedValue({ ok: true, reference: { chapter: 2, verse: '1' } });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'JON', 1, '17');
    const { writer, dispatched } = writerWith(
      new Map([[key, targetFor(async (...a) => void written.push(a), { book: 'JON', chapter: 1, verse: '17' })]]),
    );
    await writer(key, 'cross-numbering note');
    expect(written).toEqual([['JON', 2, '1', 'cross-numbering note']]); // rsc JON 2:1 = eng JON 1:17
    expect(dispatched[0]).toEqual(expect.objectContaining({ key: '1:17' })); // display echo stays source-side
  });

  it('an UNMAPPABLE target throws with the stated reason — the journal never receives a guess (FR-32)', async () => {
    resolveProjectFrame.mockResolvedValue({ state: 'ready', name: 'rsc', schemes: {} });
    mapReference.mockResolvedValue({ ok: false });
    const written: unknown[][] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const { writer, dispatched } = writerWith(new Map([[key, targetFor(async (...a) => void written.push(a))]]));
    await expect(writer(key, 'never lands')).rejects.toThrow(t('understand.saveUnmappable'));
    expect(written).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('an unregistered key throws instead of guessing a target', async () => {
    const { writer } = writerWith(new Map());
    await expect(writer('nowhere|TIT|1:1', 'text')).rejects.toThrow(/target unknown/);
  });
});

describe('D65 — the defect classes, restated against the REAL scheduler', () => {
  const clock = () => {
    // Manual clock: nothing fires unless the test flushes explicitly.
    return { setTimeout: () => 0, clearTimeout: () => {} };
  };

  it('ROUND 21 restated: after a failed write of A, retry() replays the NEWEST text exactly once — a stale payload cannot exist', async () => {
    const written: string[] = [];
    let failOnce = true;
    const key = noteKeyFor(REPO, 'TIT', 1, '3');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('disk full');
        }
        written.push(text);
      },
      clock: clock(),
    });
    sched.seedIfAbsent(key, '');
    sched.markDirty(key, 1, '3', 'text A');
    await sched.flushOnBlur();
    expect(sched.getState()).toBe('error'); // A failed, retained
    // The user edits to B (the blur-before-Retry-click gesture): the buffer
    // now holds ONLY B — there is no ledger of failed text to replay.
    sched.markDirty(key, 1, '3', 'text B');
    await sched.retry();
    expect(written).toEqual(['text B']); // B once; A never resurfaces
    expect(sched.getState()).toBe('saved');
  });

  it('ROUND 22 restated: an emptied box reconciled to its stored text drains clean — no stranded dirty state, no write', async () => {
    const written: string[] = [];
    const key = noteKeyFor(REPO, 'TIT', 1, '1');
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async (_k, text) => void written.push(text),
      clock: clock(),
    });
    sched.seedIfAbsent(key, 'a saved note');
    sched.markDirty(key, 1, '1', ''); // the user cleared the box…
    sched.markDirty(key, 1, '1', 'a saved note'); // …and the box staged the stored text back (G1)
    expect(await sched.drain()).toBe(true);
    expect(written).toEqual([]); // the grow-only store never sees the clear
    expect(sched.getState()).toBe('saved');
  });

  it('seedIfAbsent never clobbers a staged draft — seeding one key while another is dirty is safe', () => {
    const sched = new SaveScheduler({
      splice: (_r, _c, _v, body) => body,
      writeBook: async () => {},
      clock: clock(),
    });
    const k1 = noteKeyFor(REPO, 'TIT', 1, '1');
    const k2 = noteKeyFor(REPO, 'TIT', 1, '2');
    sched.seedIfAbsent(k1, 'stored 1');
    sched.markDirty(k1, 1, '1', 'draft 1');
    sched.seedIfAbsent(k1, 'stored 1 again'); // re-seed is a no-op
    expect(sched.bookText(k1)).toBe('draft 1');
    // loadBook would THROW here (B3 guards unsaved work); seedIfAbsent must not.
    sched.seedIfAbsent(k2, 'stored 2');
    expect(sched.bookText(k2)).toBe('stored 2');
    expect(sched.getState()).toBe('dirty'); // k1's draft still owed
  });
});
