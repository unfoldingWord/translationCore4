// The conflict review's data layer over the shared team-sync fixture — issue #679
// (epic #24, D98). The fold test proves that one resolving verse edit removes the
// conflict and keeps both old versions in history (R-8.3.5, R-8.3.6). The selector
// test proves the review lists verse text only (G7).
import { describe, expect, it } from 'vitest';
import { fold } from '../src/data/journal/runtime';
import { verseConflicts } from '../src/data/journal/verseConflicts';
import { sealAction, validateSegment, type JournalEvent } from '../src/data/journal/seal';

// journal/files.mjs is Node-bound (fs, node:crypto), so readUnion loads through a
// NATIVE require, outside the vite pipeline (CONTRIBUTING.md, "Write a test that reads files").
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const nodeFs = process.getBuiltinModule('node:fs');
const nodePath = process.getBuiltinModule('node:path');
const { readUnion } = nodeRequire('./journal/files.mjs') as { readUnion(dir: string): JournalEvent[] };

const FIXTURE = nodePath.resolve(process.cwd(), 'conformance/fixtures/team-sync');
interface FixtureCase { key: string; newest: string; segments: string[] }
const CASES = (JSON.parse(nodeFs.readFileSync(nodePath.join(FIXTURE, 'cases.json'), 'utf8')) as {
  cases: Record<string, FixtureCase>;
}).cases;
const VERSE = CASES['verse-two-ways'];
const CHECK = CASES['check-two-ways'];
const eventsOf = (segment: string): JournalEvent[] =>
  JSON.parse((JSON.parse(nodeFs.readFileSync(nodePath.join(FIXTURE, segment), 'utf8')) as { body: string }).body).events as JournalEvent[];

const union = (): JournalEvent[] => readUnion(nodePath.join(FIXTURE, 'journals'));
// The two TIT 1:4 edits of the case, as the fixture holds them.
const verseHeads = (): JournalEvent[] => VERSE.segments.flatMap(eventsOf);

describe('#679 the fold of a kept version', () => {
  it('confirm supersedes all heads: no conflict for the verse, both old versions retained as superseded', async () => {
    const events = union();
    const before = fold(events);
    // Positive control: the fixture holds the verse-text fork and B's text projects.
    const fork = before.forks.find((f) => f.key === VERSE.key);
    expect(fork?.provisional).toBe(VERSE.newest);
    const [headA, headB] = verseHeads();
    expect(fork?.heads).toEqual([headA.ts, headB.ts]);
    expect(before.books.TIT.verses['1:4']).toBe(headB.text);

    // A keeps its own version: ONE edit on the projected head that names both heads.
    const resolving: JournalEvent = {
      v: 1,
      op: 'text.verse.set',
      actor: 'translator-a',
      ts: '2026-10-13T11:00:00.000Z|0000|translator-a',
      base: before.headsTs[VERSE.key],
      supersedes: [headA.ts, headB.ts],
      book: 'TIT',
      chapter: '1',
      verse: '4',
      text: headA.text,
    };
    // The one sealer and validator accept the event shape (no code wrote `supersedes` before #679).
    expect((await validateSegment(await sealAction([resolving]))).ok).toBe(true);

    const after = fold([...events, resolving]);
    expect(after.forks.map((f) => f.key)).not.toContain(VERSE.key);
    expect(after.supersedeRefused).toEqual([]); // the ancestry rule erased both heads, refused none
    expect(after.retained.filter((r) => r.key === VERSE.key)).toEqual([
      { key: VERSE.key, ts: headA.ts, reason: 'superseded' },
      { key: VERSE.key, ts: headB.ts, reason: 'superseded' },
    ]);
    expect(after.books.TIT.verses['1:4']).toBe(headA.text);
    expect(after.headsTs[VERSE.key]).toBe(resolving.ts);
    // The check-result fork is not touched by a verse resolution.
    expect(after.forks.map((f) => f.key)).toContain(CHECK.key);
  });

  it('confirm supersedes all heads when the kept version is the provisional one (base and supersedes share a ts)', () => {
    const events = union();
    const before = fold(events);
    const [headA, headB] = verseHeads();
    expect(before.headsTs[VERSE.key]).toBe(headB.ts);
    const resolving: JournalEvent = {
      v: 1,
      op: 'text.verse.set',
      actor: 'translator-a',
      ts: '2026-10-13T11:00:00.000Z|0000|translator-a',
      base: headB.ts,
      supersedes: [headA.ts, headB.ts],
      book: 'TIT',
      chapter: '1',
      verse: '4',
      text: headB.text,
    };
    const after = fold([...events, resolving]);
    expect(after.forks.map((f) => f.key)).not.toContain(VERSE.key);
    expect(after.supersedeRefused).toEqual([]);
    expect(after.retained.filter((r) => r.key === VERSE.key)).toEqual([
      { key: VERSE.key, ts: headA.ts, reason: 'superseded' },
      { key: VERSE.key, ts: headB.ts, reason: 'superseded' },
    ]);
    expect(after.books.TIT.verses['1:4']).toBe(headB.text);
  });

  it('negative control: an edit that supersedes only one head leaves a conflict on the verse', () => {
    const events = union();
    const before = fold(events);
    const [headA, headB] = verseHeads();
    // C keeps B's text but names only B's head: A's head is still live, so the fork stays.
    const partial: JournalEvent = {
      v: 1,
      op: 'text.verse.set',
      actor: 'translator-c',
      ts: '2026-10-13T11:00:00.000Z|0000|translator-c',
      base: before.headsTs[VERSE.key],
      supersedes: [headB.ts],
      book: 'TIT',
      chapter: '1',
      verse: '4',
      text: headB.text,
    };
    const after = fold([...events, partial]);
    expect(after.forks.find((f) => f.key === VERSE.key)?.heads).toEqual([headA.ts, partial.ts]);
    expect(after.retained).toContainEqual({ key: VERSE.key, ts: headB.ts, reason: 'superseded' });
  });
});

describe('#679 the conflict review selector', () => {
  it('[G7] lists only verse text: the verse conflict with each head\'s actor and text, never the check-result conflict', () => {
    const events = union();
    const out = fold(events);
    // Positive control: the fold DOES hold the check-result fork the review must leave out.
    expect(out.forks.map((f) => f.key)).toContain(CHECK.key);
    const [headA, headB] = verseHeads();
    expect(verseConflicts(out, events)).toEqual([
      {
        key: VERSE.key,
        book: 'TIT',
        chapter: '1',
        verse: '4',
        versions: [
          { ts: headA.ts, actor: 'translator-a', text: headA.text, provisional: false },
          { ts: headB.ts, actor: 'translator-b', text: headB.text, provisional: true },
        ],
      },
    ]);
  });

  it('lists conflicts in canonical verse order, whatever order the fold lists its forks in', () => {
    const events = union();
    const seeded = fold(events);
    // Two more verse forks: TIT 1:2 (before TIT 1:4) and JON 1:1 (JON is before TIT in the canon).
    const edit = (actor: string, ts: string, book: string, chapter: string, verse: string, text: string): JournalEvent => ({
      v: 1, op: 'text.verse.set', actor, ts, base: seeded.headsTs[`text|${book}|${chapter}:${verse}`], book, chapter, verse, text,
    });
    const bTit2 = events.find((e) => e.op === 'text.verse.set' && e.actor === 'translator-b' && e.verse === '2');
    expect(bTit2).toBeDefined();
    const more = [
      { ...bTit2!, actor: 'translator-c', ts: '2026-10-13T10:03:00.000Z|0000|translator-c', text: 'otro texto\n' },
      edit('translator-b', '2026-10-13T10:04:00.000Z|0000|translator-b', 'JON', '1', '1', 'Jonás uno\n'),
      edit('translator-c', '2026-10-13T10:05:00.000Z|0000|translator-c', 'JON', '1', '1', 'Jonás dos\n'),
    ];
    const all = [...events, ...more];
    const out = fold(all);
    const expected = ['text|JON|1:1', 'text|TIT|1:2', VERSE.key];
    expect(verseConflicts(out, all).map((c) => c.key)).toEqual(expected);
    expect(verseConflicts({ ...out, forks: [...out.forks].reverse() }, all).map((c) => c.key)).toEqual(expected);
  });

  it('a fork head missing from the event set is a defect, not a silent skip', () => {
    const events = union();
    const out = fold(events);
    const [, headB] = verseHeads();
    expect(() => verseConflicts(out, events.filter((e) => e.ts !== headB.ts))).toThrow();
  });
});

// Bench finding P2 (PR #687): the fold also makes verse heads from a structural
// action (a renumber, split or merge post-image). A renumber and a concurrent
// verse edit give a valid `text|` fork; the selector must list it, with the
// structural head's text by the fold's own rule (verseHeadText), never throw.
describe('#679 a conflict between a renumber and a verse edit', () => {
  const RENUMBER_TS = '2026-10-13T11:00:00.000Z|0000|translator-a';
  const EDIT_TS = '2026-10-13T11:01:00.000Z|0000|translator-c';
  const KEY = 'text|JON|1:2';
  /** The fixture, then A renumbers Jonah 1 (every verse up one, the conformance
   * renumber fixture) while C edits Jonah 1:2 from the state before it. */
  const forked = async () => {
    const { shiftChapter } = await import('../conformance/fixtures/renumber.mjs');
    const events = union();
    const before = fold(events);
    const renumber = shiftChapter(before, 'JON', 1, { actor: 'translator-a', ts: RENUMBER_TS }) as JournalEvent;
    const edit: JournalEvent = {
      v: 1, op: 'text.verse.set', actor: 'translator-c', ts: EDIT_TS, base: before.headsTs[KEY],
      book: 'JON', chapter: '1', verse: '2', text: 'C edita Jonás 1:2\n',
    };
    // The one validator accepts the renumber as a sealed action (positive control on its shape).
    expect((await validateSegment(await sealAction([renumber]))).ok).toBe(true);
    const all = [...events, renumber, edit];
    return { all, before, renumber, edit, after: fold(all) };
  };

  it('the fold accepts the renumber and reports the verse fork; the selector lists it with both versions', async () => {
    const { all, before, renumber, edit, after } = await forked();
    expect(after.pendingStructural).toEqual([]);
    expect(after.forks.find((f) => f.key === KEY)?.heads).toEqual([RENUMBER_TS, EDIT_TS]);
    const conflict = verseConflicts(after, all).find((c) => c.key === KEY);
    expect(conflict?.versions).toEqual([
      // The renumber's post-image on 1:2 holds the old 1:1 text (its transition text).
      { ts: RENUMBER_TS, actor: 'translator-a', text: (renumber as unknown as { transitions: Record<string, { text: string }> }).transitions['1:2'].text, provisional: false },
      { ts: EDIT_TS, actor: 'translator-c', text: edit.text, provisional: true },
    ]);
    expect(conflict!.versions[0].text).toBe(before.books.JON.verses['1:1']);
  });

  for (const which of ['the renumbered text', 'the verse edit'] as const)
    it(`keeping ${which} removes the fork; both versions stay in history`, async () => {
      const { all, after } = await forked();
      const conflict = verseConflicts(after, all).find((c) => c.key === KEY)!;
      const kept = conflict.versions[which === 'the renumbered text' ? 0 : 1];
      // The resolving edit: the kept text, supersedes every head, and its base on the
      // renumber's head — the head whose structural ancestry holds the other one.
      const resolving: JournalEvent = {
        v: 1, op: 'text.verse.set', actor: 'translator-b', ts: '2026-10-13T11:05:00.000Z|0000|translator-b',
        base: RENUMBER_TS, supersedes: conflict.versions.map((v) => v.ts),
        book: 'JON', chapter: '1', verse: '2', text: kept.text,
      };
      const resolved = fold([...all, resolving]);
      expect(resolved.forks.map((f) => f.key)).not.toContain(KEY);
      expect(resolved.supersedeRefused).toEqual([]);
      expect(resolved.books.JON.verses['1:2']).toBe(kept.text);
      expect(resolved.retained.filter((r) => r.key === KEY)).toEqual(
        conflict.versions.map((v) => ({ key: KEY, ts: v.ts, reason: 'superseded' })),
      );
      expect(verseConflicts(resolved, [...all, resolving]).map((c) => c.key)).not.toContain(KEY);
    });

  it('negative control: a resolving edit based on the provisional edit cannot supersede the renumber head', async () => {
    // Why resolveVerse lets the fold choose the base: the edit was made before the
    // renumber, so the renumber's head is not on its structural chain (§8.3).
    const { all, after } = await forked();
    expect(after.headsTs[KEY]).toBe(EDIT_TS);
    const conflict = verseConflicts(after, all).find((c) => c.key === KEY)!;
    const resolving: JournalEvent = {
      v: 1, op: 'text.verse.set', actor: 'translator-b', ts: '2026-10-13T11:05:00.000Z|0000|translator-b',
      base: EDIT_TS, supersedes: conflict.versions.map((v) => v.ts),
      book: 'JON', chapter: '1', verse: '2', text: conflict.versions[1].text,
    };
    expect(fold([...all, resolving]).supersedeRefused).toEqual([{ key: KEY, ts: RENUMBER_TS, by: resolving.ts }]);
  });
});
