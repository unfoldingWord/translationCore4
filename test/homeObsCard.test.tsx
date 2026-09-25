// @vitest-environment jsdom
// #328 — the OBS project card on Home: one tile per story, collapsed to the
// three most recently edited (newest first), expanded to all fifty in order.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const actions = { loadProgress: vi.fn(), openProjectAt: vi.fn(), openSettings: vi.fn() };
const stories = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, title: i === 0 ? 'La creación' : i === 11 ? 'El éxodo' : '', pct: i === 0 ? 40 : i === 11 ? 5 : i === 6 ? 100 : 0, frames: 10, drafted: 0 }));
const PROJECT = { id: '_local_/_local_/historias', name: 'Historias', languageTag: 'es', flavor: 'textStories', scriptDirection: 'ltr' };
const state = {
  progressByProject: { [PROJECT.id]: { OBS: 3, stories } } as Record<string, unknown>,
  obsRecentByProject: { [PROJECT.id]: [{ story: 12, at: Date.UTC(2026, 8, 17, 12) }, { story: 1, at: Date.UTC(2026, 8, 16, 12) }, { story: 7, at: Date.UTC(2026, 8, 15, 12) }] } as Record<string, Array<{ story: number; at: number }>>,
};
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import { ObsProjectCard, collapsedStories } from '../src/views/Home.jsx';

const tiles = () => within(screen.getByTestId('story-tiles')).getAllByRole('button').map((b) => b.getAttribute('data-testid'));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.progressByProject = { [PROJECT.id]: { OBS: 3, stories } };
  state.obsRecentByProject = { [PROJECT.id]: [{ story: 12, at: Date.UTC(2026, 8, 17, 12) }, { story: 1, at: Date.UTC(2026, 8, 16, 12) }, { story: 7, at: Date.UTC(2026, 8, 15, 12) }] };
});

describe('#328 — the OBS project card', () => {
  it('opens collapsed to the three most recently edited stories, newest first, with number, title, percent, bar and edit date', () => {
    render(<ObsProjectCard p={PROJECT} />);
    expect(tiles()).toEqual(['story-tile-12', 'story-tile-1', 'story-tile-7']);
    const twelve = screen.getByTestId('story-tile-12');
    expect(twelve.textContent).toContain('12 · El éxodo');
    expect(twelve.textContent).toContain('5%');
    // The edit date, from `at`, in the machine's locale as the card writes it
    // (`17 Sep` in English, `17 sept.` in Spanish — #404).
    const edited = new Date(Date.UTC(2026, 8, 17, 12)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    expect(twelve.textContent).toContain(edited);
    expect(screen.getByTestId('story-tile-7').textContent).toContain('Story 7'); // no title: the number alone
    expect(screen.queryByRole('button', { name: 'Add a book' })).toBeNull();
  });

  it('the header keeps language, story count, in-progress count and the project percent; unknown reads as an em-dash', () => {
    render(<ObsProjectCard p={PROJECT} />);
    expect(screen.getByTestId('obs-progress').textContent).toBe('es · 50 stories · 3 in progress · 3% drafted');
    cleanup();
    state.progressByProject = { [PROJECT.id]: { OBS: null, stories: stories.map((s, i) => (i === 0 ? { ...s, pct: null } : s)) } };
    render(<ObsProjectCard p={PROJECT} />);
    expect(screen.getByTestId('obs-progress').textContent).toContain('—');
    expect(screen.getByTestId('story-tile-1').textContent).toContain('—');
    expect(screen.getByTestId('story-tile-1').textContent).not.toContain('0%');
  });

  it('"Show all 50 stories" expands to every story in numeric order; "Show recent stories only" collapses again', () => {
    render(<ObsProjectCard p={PROJECT} />);
    const toggle = screen.getByTestId(`toggle-stories-${PROJECT.id}`);
    expect(toggle.textContent).toContain('Show all 50 stories');
    fireEvent.click(toggle);
    const all = tiles();
    expect(all).toHaveLength(50);
    expect(all.slice(0, 3)).toEqual(['story-tile-1', 'story-tile-2', 'story-tile-3']);
    expect(all[49]).toBe('story-tile-50');
    expect(toggle.textContent).toContain('Show recent stories only');
    fireEvent.click(toggle);
    expect(tiles()).toHaveLength(3);
  });

  it('collapsedStories ignores a recent entry whose story is not in the list, and keeps recency order', () => {
    expect(collapsedStories(stories, [{ story: 99, at: 9 }, { story: 4, at: 8 }, { story: 2, at: 7 }]).map((s: { number: number }) => s.number)).toEqual([4, 2]);
  });
});
