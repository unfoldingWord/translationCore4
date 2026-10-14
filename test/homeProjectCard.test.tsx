// @vitest-environment jsdom
// Epic #24 review (2026-10-13) of the Home book-project card (#104): the
// summary line must not state an in-progress count it does not know, and a
// failed progress read is tried again on a later Home visit.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const actions = { loadProgress: vi.fn(), openProjectAt: vi.fn(), openSettings: vi.fn(), openAddBook: vi.fn(), loadShared: vi.fn() };
const PROJECT = { id: '_local_/_local_/en_ult', name: 'English ULT', languageTag: 'en', scriptDirection: 'ltr', bookCodes: ['TIT', 'RUT'] };
const state = {
  progressByProject: {} as Record<string, unknown>,
  remoteByProject: {} as Record<string, unknown>,
  netEnabled: true,
  importedRepo: null,
};
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import { ProjectCard } from '../src/views/Home.jsx';

const summary = () => screen.getByTestId('project-summary').textContent;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.progressByProject = {};
});

describe('Home project card — the in-progress count is stated only when known', () => {
  it('before the progress read: the summary shows the unknown state, like the tiles', () => {
    render(<ProjectCard p={PROJECT} />);
    expect(summary()).toContain('— in progress');
    expect(summary()).not.toContain('0 in progress');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2); // the tiles
  });

  it('one book unknown (a failed book read): the count is not known', () => {
    state.progressByProject = { [PROJECT.id]: { TIT: 40, RUT: null } };
    render(<ProjectCard p={PROJECT} />);
    expect(summary()).toContain('— in progress');
  });

  it('every book known: the summary states the count, zero included', () => {
    state.progressByProject = { [PROJECT.id]: { TIT: 40, RUT: 0 } };
    render(<ProjectCard p={PROJECT} />);
    expect(summary()).toContain('1 in progress');
    cleanup();
    state.progressByProject = { [PROJECT.id]: { TIT: 0, RUT: 0 } };
    render(<ProjectCard p={PROJECT} />);
    expect(summary()).toContain('0 in progress');
  });
});

describe('Home project card — retry after a failed progress read', () => {
  it('a re-render does not read again; a later Home visit (a new mount) does', () => {
    // A failed ProjectReader.open caches nothing, so the entry stays absent.
    const { rerender, unmount } = render(<ProjectCard p={PROJECT} />);
    expect(actions.loadProgress).toHaveBeenCalledTimes(1);
    rerender(<ProjectCard p={{ ...PROJECT }} />);
    expect(actions.loadProgress).toHaveBeenCalledTimes(1);
    unmount();
    render(<ProjectCard p={PROJECT} />);
    expect(actions.loadProgress).toHaveBeenCalledTimes(2);
  });
});
