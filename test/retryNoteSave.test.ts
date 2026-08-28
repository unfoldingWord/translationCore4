// Round 21 (2026-08-28 adversarial review): clicking the global Retry blurs
// the edited comprehension box FIRST, and the blur queues the newer text.
// A retry that reads the failure ledger before that pending write settles
// re-queues the STALE failed text as the newest revision — the newer edit is
// superseded and the old text persists as the head note, silently. The fix:
// drain every pending lifecycle (each settles only after its ledger update),
// then retry only the failures that REMAIN.
import { describe, expect, it } from 'vitest';
import { __retryFailedNoteSavesForTests as retryFailedNoteSaves } from '../src/state.jsx';

const PROJECT = { repoPath: '_local_/_quarantine_/equipo', book: 'TIT' } as const;
const ERR_KEY = `${PROJECT.repoPath}|TIT|1:3`;
const entry = (text: string) => ({
  repoPath: PROJECT.repoPath,
  book: 'TIT',
  chapter: 1,
  verse: '3',
  text,
  projectFrame: false,
});

const refs = (errors: Record<string, unknown>) => ({
  pendingNotesRef: { current: new Set<Promise<unknown>>() },
  noteSaveErrorsRef: { current: errors },
  stateRef: { current: { project: { repoPath: PROJECT.repoPath }, book: 'TIT' } },
});

describe('round 21 — retryNoteSave drains pending writes before reading the ledger', () => {
  it('a pending newer write that SUCCEEDS clears the entry — the stale text is never retried', async () => {
    // Failed A stands in the ledger; the blur-queued save of B is pending.
    const r = refs({ [ERR_KEY]: entry('stale A') });
    const saved: string[] = [];
    // The lifecycle contract: when this settles, its ledger update has
    // LANDED — here B's success removes A's entry, as a real publish does.
    r.pendingNotesRef.current.add(
      Promise.resolve().then(() => {
        r.noteSaveErrorsRef.current = {};
      }),
    );
    await retryFailedNoteSaves({ ...r, save: async (_c: unknown, _v: unknown, text: string) => saved.push(text) });
    expect(saved).toEqual([]); // B already superseded A — nothing to retry
  });

  it('a pending newer write that FAILS refreshes the entry — the NEWER text is retried, once', async () => {
    const r = refs({ [ERR_KEY]: entry('stale A') });
    const saved: string[] = [];
    r.pendingNotesRef.current.add(
      Promise.resolve().then(() => {
        r.noteSaveErrorsRef.current = { [ERR_KEY]: entry('newer B') };
      }),
    );
    await retryFailedNoteSaves({ ...r, save: async (_c: unknown, _v: unknown, text: string) => saved.push(text) });
    expect(saved).toEqual(['newer B']);
  });

  it('with nothing pending, standing failures of the open project retry as before', async () => {
    const foreign = {
      ...entry('other project'),
      repoPath: '_local_/_quarantine_/otro',
    };
    const r = refs({ [ERR_KEY]: entry('failed A'), 'other|key': foreign });
    const saved: Array<[unknown, unknown, string, unknown]> = [];
    await retryFailedNoteSaves({
      ...r,
      save: async (chapter: unknown, verse: unknown, text: string, opts: unknown) => saved.push([chapter, verse, text, opts]),
    });
    // C1: only the open project's failure is replayed, with its identity.
    expect(saved).toEqual([[1, '3', 'failed A', { projectFrame: false }]]);
  });

  it('a rejected pending write never breaks the drain (allSettled, not all)', async () => {
    const r = refs({ [ERR_KEY]: entry('failed A') });
    const saved: string[] = [];
    r.pendingNotesRef.current.add(Promise.reject(new Error('write exploded')));
    await retryFailedNoteSaves({ ...r, save: async (_c: unknown, _v: unknown, text: string) => saved.push(text) });
    expect(saved).toEqual(['failed A']);
  });
});
