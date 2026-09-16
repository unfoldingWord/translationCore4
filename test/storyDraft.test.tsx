// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const actions = {
  stageStoryUnit: vi.fn(),
  blurStoryUnit: vi.fn(),
  openStory: vi.fn(),
  openSources: vi.fn(),
  toggleRail: vi.fn(),
};
const state = {
  rail: true,
  storyNumbers: [1, 2],
  storyNumber: 1,
  storyLoading: false,
  storyError: null,
  storySourceError: null as string | null,
  storySourceMissing: false,
  storyImageNote: null as string | null,
  story: { number: 1, title: 'La creación', ref: 'Génesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'Al principio.' }] },
  sourceStory: { number: 1, title: 'Creation', ref: 'Genesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'In the beginning.' }] },
  storyImages: { '1': { source: 'default', uri: 'local://obs-01.jpg' } } as Record<string, { source: string; uri: string }>,
  project: { flavor: 'textStories', scriptDirection: 'ltr' },
};

vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import StoryDraft from '../src/views/StoryDraft.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OBS story draft surface', () => {
  it('renders the gateway frame, image, and target editor', () => {
    render(<StoryDraft />);
    expect(screen.getByTestId('story-draft')).toBeTruthy();
    expect(screen.getByText('In the beginning.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Story frame 1' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Frame 1' }) as HTMLTextAreaElement).value).toBe('Al principio.');
  });

  it('stages edits and routes story selection through the catalogue', () => {
    render(<StoryDraft />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Frame 1' }), { target: { value: 'Una nueva frase.' } });
    expect(actions.stageStoryUnit).toHaveBeenCalledWith({ kind: 'frame', story: 1, frame: 1 }, 'Una nueva frase.');
    fireEvent.click(screen.getByTestId('story-2'));
    expect(actions.openStory).toHaveBeenCalledWith(2);
  });

  it('states once, not per frame, why a story has no pictures', () => {
    state.storyImageNote = 'No picture matched this story\'s 1 image line: x lists 0 image files (paths)';
    state.storyImages = {};
    render(<StoryDraft />);
    expect(screen.getByTestId('story-image-note').textContent).toContain('lists 0 image files');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('story-frame-1').textContent).not.toContain('image');
    state.storyImageNote = null;
    state.storyImages = { '1': { source: 'default', uri: 'local://obs-01.jpg' } };
  });

  it('offers the Sources modal when the pinned gateway story is not installed', () => {
    state.storySourceError = 'OBS source is not installed';
    state.storySourceMissing = true;
    render(<StoryDraft />);
    fireEvent.click(screen.getByTestId('story-source-install'));
    expect(actions.openSources).toHaveBeenCalledTimes(1);
    state.storySourceError = null;
    state.storySourceMissing = false;
  });
});
