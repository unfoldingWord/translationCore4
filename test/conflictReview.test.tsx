// @vitest-environment jsdom
// #679 — the conflict review screens over the shared team-sync fixture (D98):
// the review (artboards a, b), the Translate marker (c) and the Home count (0).
// The conflicts come from FOLDING the fixture's journals with the one selector
// (verseConflicts), never from hand-built objects. The fixture holds one verse
// fork (TIT 1:4: A, then B); two more forks are added the way
// test/verseConflicts.test.ts adds them, so navigation has three conflicts.
// Assertions use test ids, roles and data attributes, not message text.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { fold } from '../src/data/journal/runtime';
import { verseConflicts, type VerseConflict } from '../src/data/journal/verseConflicts';
import type { JournalEvent } from '../src/data/journal/seal';

const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const nodeFs = process.getBuiltinModule('node:fs');
const nodePath = process.getBuiltinModule('node:path');
const { readUnion } = nodeRequire('./journal/files.mjs') as { readUnion(dir: string): JournalEvent[] };
const FIXTURE = nodePath.resolve(process.cwd(), 'conformance/fixtures/team-sync');
const CASES = (JSON.parse(nodeFs.readFileSync(nodePath.join(FIXTURE, 'cases.json'), 'utf8')) as {
  cases: Record<string, { key: string; newest: string }>;
}).cases;
const VERSE = CASES['verse-two-ways'];
const CHECK = CASES['check-two-ways'];
const ME = 'translator-a';

/** The fixture union plus two more verse forks: JON 1:1 (B, C) and TIT 1:2 (B, C). */
const teamEvents = (): JournalEvent[] => {
  const events = readUnion(nodePath.join(FIXTURE, 'journals'));
  const seeded = fold(events);
  const edit = (actor: string, ts: string, book: string, chapter: string, verse: string, text: string): JournalEvent => ({
    v: 1, op: 'text.verse.set', actor, ts, base: seeded.headsTs[`text|${book}|${chapter}:${verse}`], book, chapter, verse, text,
  });
  const bTit2 = events.find((e) => e.op === 'text.verse.set' && e.actor === 'translator-b' && e.verse === '2')!;
  return [
    ...events,
    { ...bTit2, actor: 'translator-c', ts: '2026-10-13T10:03:00.000Z|0000|translator-c', text: 'otro texto\n' },
    edit('translator-b', '2026-10-13T10:04:00.000Z|0000|translator-b', 'JON', '1', '1', 'Jonás uno\n'),
    edit('translator-c', '2026-10-13T10:05:00.000Z|0000|translator-c', 'JON', '1', '1', 'Jonás dos\n'),
  ];
};

const folded = (events: JournalEvent[]) => {
  const out = fold(events);
  return { out, conflicts: verseConflicts(out, events) };
};

const actions = {
  keepVersion: vi.fn(),
  showConflict: vi.fn(),
  closeConflictReview: vi.fn(),
  openConflictReview: vi.fn(),
  openProjectConflicts: vi.fn(),
  loadConflicts: vi.fn(),
  loadProgress: vi.fn(),
  loadShared: vi.fn(),
  openProjectAt: vi.fn(),
  openAddBook: vi.fn(),
  openSettings: vi.fn(),
  shareProject: vi.fn(),
};
const state: Record<string, unknown> = {};
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import ConflictReview from '../src/views/ConflictReview.jsx';
import { ConflictVerse, ConflictsButton } from '../src/views/conflictMarkers.jsx';
import { ProjectCard } from '../src/views/Home.jsx';

const conflictCounts = (conflicts: VerseConflict[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const c of conflicts) counts[c.book] = (counts[c.book] ?? 0) + 1;
  return counts;
};

/** Put the folded review state in place: the open project is the fixture, at `key`. */
const review = (events: JournalEvent[], key: string | null) => {
  const { out, conflicts } = folded(events);
  Object.assign(state, {
    project: { id: 'fixture', repoPath: 'fixture', name: 'Fixture', languageTag: 'es', scriptDirection: 'ltr' },
    book: 'TIT',
    chapter: 1,
    sources: {},
    verseConflicts: conflicts,
    team: { me: ME, names: out.names, actors: [...new Set(events.map((e) => e.actor))].sort() },
    conflictReview: key ? { key, error: null } : null,
  });
  return conflicts;
};

const versionCards = () => screen.getAllByTestId('conflict-version');
const position = () => {
  const el = screen.getByTestId('conflict-position');
  return [Number(el.dataset.n), Number(el.dataset.m)];
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const k of Object.keys(state)) delete state[k];
});

describe('#679 the conflict review', () => {
  it('[G7] lists only verse text: every version of the verse with its text, owner and date; never the check-result conflict', () => {
    const events = readUnion(nodePath.join(FIXTURE, 'journals'));
    // Positive control: the fold holds the check-result fork the review must leave out.
    expect(fold(events).forks.map((f) => f.key)).toContain(CHECK.key);
    const conflicts = review(events, VERSE.key);
    expect(conflicts.map((c) => c.key)).toEqual([VERSE.key]);
    render(<ConflictReview />);
    expect(position()).toEqual([1, 1]);
    const cards = versionCards();
    // Newest first: B's head (the provisional one), then A's.
    expect(cards.map((c) => c.dataset.ts)).toEqual([...conflicts[0].versions].reverse().map((v) => v.ts));
    for (const [card, v] of cards.map((c, i) => [c, [...conflicts[0].versions].reverse()[i]] as const)) {
      expect(within(card).getByTestId('conflict-text').textContent).toBe(v.text.trim());
      expect(within(card).getByTestId('conflict-owner').textContent).not.toBe('');
      // The date is the wall-clock part of the version's ts, in the machine's locale.
      const at = new Date(v.ts.slice(0, v.ts.indexOf('|')));
      expect(within(card).getByTestId('conflict-date').textContent).toContain(at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    }
    // A teammate with a recorded Door43 name shows that name (FoldOutput.names, #674).
    expect(within(cards[0]).getByTestId('conflict-owner').textContent).toBe('fixture-translator-b');
    expect(cards.map((c) => c.dataset.owner)).toEqual(['teammate', 'mine']);
  });

  it('colors follow the owner: "Mine" has one background on every conflict, every teammate the other', () => {
    const events = teamEvents();
    const conflicts = review(events, VERSE.key);
    const fills: Record<string, Set<string>> = { mine: new Set(), teammate: new Set() };
    const positions: Record<string, Set<number>> = { mine: new Set(), teammate: new Set() };
    // Mine (translator-a) is in only the TIT 1:4 conflict; add a conflict where
    // Mine is the newest head, so Mine is first there and last in TIT 1:4.
    const mineNewest: JournalEvent = {
      ...events.find((e) => e.ts === conflicts.find((c) => c.key === 'text|JON|1:1')!.versions[0].ts)!,
      actor: ME, ts: '2026-10-13T10:06:00.000Z|0000|translator-a', text: 'Jonás tres\n',
    };
    const all = [...events, mineNewest];
    for (const c of review(all, null)) {
      cleanup();
      state.conflictReview = { key: c.key, error: null };
      render(<ConflictReview />);
      versionCards().forEach((card, i) => {
        const owner = card.dataset.owner!;
        fills[owner].add(card.style.background || card.getAttribute('style')!.match(/background: ([^;]+)/)![1]);
        positions[owner].add(i);
      });
    }
    expect(fills.mine.size).toBe(1);
    expect(fills.teammate.size).toBe(1);
    expect([...fills.mine][0]).not.toBe([...fills.teammate][0]);
    expect([...fills.mine][0]).toContain('--uw-inspire-200');
    expect([...fills.teammate][0]).toContain('--uw-cream');
    // The colour does not follow the position: Mine is first in one conflict and last in another.
    expect(positions.mine.size).toBeGreaterThan(1);
  });

  it('a click selects one version and fades the others; Cancel clears it', () => {
    review(teamEvents(), VERSE.key);
    render(<ConflictReview />);
    expect(screen.getByTestId('conflict-keep')).toHaveProperty('disabled', true);
    const [first, second] = versionCards();
    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    // Faded by colour and size, not opacity (contrast): the background stays the owner's.
    const faded = within(first).getByTestId('conflict-text');
    expect(faded.getAttribute('style')).toContain('--uw-slate');
    expect(faded.getAttribute('style')).not.toContain('opacity');
    expect(within(second).getByTestId('conflict-text').getAttribute('style')).not.toContain('--uw-slate');
    expect(screen.getByTestId('conflict-keep')).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByTestId('conflict-cancel'));
    expect(versionCards().every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('navigation n of m: Previous and Next move between conflicts in canonical verse order', () => {
    const conflicts = review(teamEvents(), 'text|TIT|1:2');
    expect(conflicts.map((c) => c.key)).toEqual(['text|JON|1:1', 'text|TIT|1:2', VERSE.key]);
    render(<ConflictReview />);
    expect(position()).toEqual([2, 3]);
    fireEvent.click(screen.getByTestId('conflict-next'));
    expect(actions.showConflict).toHaveBeenLastCalledWith(VERSE.key);
    fireEvent.click(screen.getByTestId('conflict-previous'));
    expect(actions.showConflict).toHaveBeenLastCalledWith('text|JON|1:1');
    // At the ends the step that leaves the list is off.
    cleanup();
    state.conflictReview = { key: 'text|JON|1:1', error: null };
    render(<ConflictReview />);
    expect(position()).toEqual([1, 3]);
    expect(screen.getByTestId('conflict-previous')).toHaveProperty('disabled', true);
    cleanup();
    state.conflictReview = { key: VERSE.key, error: null };
    render(<ConflictReview />);
    expect(position()).toEqual([3, 3]);
    expect(screen.getByTestId('conflict-next')).toHaveProperty('disabled', true);
  });

  it('"Keep this version" calls keepVersion with the selected head; after it the conflict leaves the list', async () => {
    const events = teamEvents();
    const conflicts = review(events, VERSE.key);
    render(<ConflictReview />);
    const mine = versionCards().find((c) => c.dataset.owner === 'mine')!;
    fireEvent.click(mine);
    fireEvent.click(screen.getByTestId('conflict-keep'));
    const kept = conflicts.find((c) => c.key === VERSE.key)!.versions.find((v) => v.actor === ME)!;
    expect(actions.keepVersion).toHaveBeenCalledWith(VERSE.key, kept.ts);
    // The state after the keep is the fold with the one resolving edit (its shape is resolveVerse's).
    const before = fold(events);
    const resolving: JournalEvent = {
      v: 1, op: 'text.verse.set', actor: ME, ts: '2026-10-13T11:00:00.000Z|0000|translator-a',
      base: before.headsTs[VERSE.key], supersedes: conflicts.find((c) => c.key === VERSE.key)!.versions.map((v) => v.ts),
      book: 'TIT', chapter: '1', verse: '4', text: kept.text,
    };
    cleanup();
    const after = review([...events, resolving], VERSE.key);
    expect(after.map((c) => c.key)).toEqual(['text|JON|1:1', 'text|TIT|1:2']);
    render(<ConflictReview />);
    // The review stays open at the next open conflict: m went down by one.
    expect(position()).toEqual([1, 2]);
  });

  it('leaving keeps conflicts listed: Back closes the review and changes nothing', () => {
    const conflicts = review(teamEvents(), 'text|TIT|1:2');
    render(<ConflictReview />);
    fireEvent.click(versionCards()[0]); // a selection that is not kept
    fireEvent.click(screen.getByTestId('conflict-back'));
    expect(actions.closeConflictReview).toHaveBeenCalledTimes(1);
    expect(actions.keepVersion).not.toHaveBeenCalled();
    // The open conflicts are still listed: the Translate toolbar counts all of them.
    cleanup();
    state.conflictReview = null;
    render(<ConflictsButton conflicts={state.verseConflicts as VerseConflict[]} onClick={() => actions.openConflictReview()} />);
    expect(screen.getByTestId('conflicts-review').dataset.count).toBe(String(conflicts.length));
    fireEvent.click(screen.getByTestId('conflicts-review'));
    expect(actions.openConflictReview).toHaveBeenCalledWith();
  });

  it('shows the ULT verse above the versions when Translate has it for the open book; else nothing', () => {
    review(teamEvents(), VERSE.key);
    state.sources = { ult: { raw: '', chapters: { 1: { 4: { verseObjects: [{ type: 'text', text: 'ULT verse four' }] } } } } };
    render(<ConflictReview />);
    expect(screen.getByTestId('conflict-ult').textContent).toContain('ULT verse four');
    cleanup();
    state.conflictReview = { key: 'text|JON|1:1', error: null }; // another book: the ULT of Titus does not apply
    render(<ConflictReview />);
    expect(screen.queryByTestId('conflict-ult')).toBeNull();
  });
});

describe('#679 the Translate marker', () => {
  it('marker opens the review at its verse', () => {
    const conflicts = review(teamEvents(), null);
    const tit2 = conflicts.find((c) => c.key === 'text|TIT|1:2')!;
    render(<p><ConflictVerse conflict={tit2} number={<sup>2</sup>} onReview={actions.openConflictReview}>verse text</ConflictVerse></p>);
    const marker = screen.getByTestId('conflict-marker-1:2');
    expect(marker.getAttribute('aria-label')).toContain(String(tit2.versions.length));
    fireEvent.click(marker);
    expect(actions.openConflictReview).toHaveBeenCalledWith('text|TIT|1:2');
    // The review the action opens shows that verse.
    cleanup();
    state.conflictReview = { key: 'text|TIT|1:2', error: null };
    render(<ConflictReview />);
    expect(position()).toEqual([2, 3]);
  });
});

describe('#679 the Home card', () => {
  const PROJECT = { id: 'fixture', name: 'Fixture', languageTag: 'es', flavor: 'textTranslation', scriptDirection: 'ltr', bookCodes: ['JON', 'TIT'] };
  const homeState = (counts: Record<string, number> | null | undefined) => {
    Object.assign(state, { progressByProject: { fixture: { JON: 10, TIT: 40 } }, remoteByProject: {}, conflictsByProject: counts === undefined ? {} : { fixture: counts } });
  };

  it('home card shows the folded conflict count: the card total and each book tile, and the card opens the review', () => {
    const events = teamEvents();
    homeState(conflictCounts(folded(events).conflicts));
    render(<ProjectCard p={PROJECT} />);
    expect(actions.loadConflicts).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByTestId('conflicts-fixture').dataset.count).toBe('3');
    expect(screen.getByTestId('book-conflicts-TIT').dataset.count).toBe('2');
    expect(screen.getByTestId('book-conflicts-JON').dataset.count).toBe('1');
    fireEvent.click(screen.getByTestId('conflicts-fixture'));
    expect(actions.openProjectConflicts).toHaveBeenCalledWith('fixture');

    // The count goes down as conflicts are kept: fold again with one resolving edit.
    const before = fold(events);
    const heads = before.forks.find((f) => f.key === VERSE.key)!.heads;
    const kept = events.find((e) => e.ts === heads[0])!;
    const resolving: JournalEvent = { ...kept, actor: ME, ts: '2026-10-13T11:00:00.000Z|0000|translator-a', base: before.headsTs[VERSE.key], supersedes: heads };
    cleanup();
    homeState(conflictCounts(folded([...events, resolving]).conflicts));
    render(<ProjectCard p={PROJECT} />);
    expect(screen.getByTestId('conflicts-fixture').dataset.count).toBe('2');
    expect(screen.getByTestId('book-conflicts-TIT').dataset.count).toBe('1');
  });

  it('shows nothing when the project has no conflict, or the count is unknown (D30)', () => {
    homeState({});
    render(<ProjectCard p={PROJECT} />);
    expect(screen.queryByTestId('conflicts-fixture')).toBeNull();
    expect(screen.queryByTestId('book-conflicts-TIT')).toBeNull();
    cleanup();
    homeState(null);
    render(<ProjectCard p={PROJECT} />);
    expect(screen.queryByTestId('conflicts-fixture')).toBeNull();
  });
});
