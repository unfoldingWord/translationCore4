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
  storySource: null as null | { kind: 'no-pin' } | { kind: 'not-installed'; pin: { repoPath: string; sha: string } } | { kind: 'error'; message: string },
  storyImageNote: null as null | { wanted: number; packs: Array<Record<string, unknown>> },
  story: { number: 1, title: 'La creación', ref: 'Génesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'Al principio.' }, { image: '![x](obs-02.jpg)', text: '' }] },
  sourceStory: { number: 1, title: 'Creation', ref: 'Genesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'In the beginning.' }, { image: '![x](obs-02.jpg)', text: 'Then God said.' }] } as { number: number; title: string; ref: string; frames: Array<{ image: string; text: string }> } | null,
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
    state.storyImageNote = { wanted: 1, packs: [{ pin: { repoPath: 'git.door43.org/uW/obs_images_360', sha: '7146d5b504f6b63b9e11f7dc0b18c594d0ae179d' }, localPath: '_local_/_sideloaded_/uw--obs_images_360--7146d5b504f6', via: 'paths', files: 0, error: null }] };
    state.storyImages = {};
    render(<StoryDraft />);
    const note = screen.getByTestId('story-image-note').textContent;
    expect(note).toContain('matched the image line of this story');
    expect(note).not.toContain('1 image lines');
    expect(note).toContain('uw--obs_images_360--7146d5b504f6 lists 0 image files (paths)');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('story-frame-1').textContent).not.toContain('image');
    state.storyImageNote = null;
    state.storyImages = { '1': { source: 'default', uri: 'local://obs-01.jpg' } };
  });

  it('renders the units in file order: the title, every numbered frame, then the reference line, each beside its gateway text', () => {
    render(<StoryDraft />);
    const main = screen.getByTestId('story-draft');
    const order = [...main.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => /^story-(title|frame-\d+|ref)$/.test(id ?? ''));
    expect(order).toEqual(['story-title', 'story-frame-1', 'story-frame-2', 'story-ref']);
    const title = screen.getByTestId('story-title');
    expect(title.textContent).toContain('Creation');
    expect((title.querySelector('input') as HTMLInputElement).value).toBe('La creación');
    const ref = screen.getByTestId('story-ref');
    expect(ref.textContent).toContain('Genesis 1');
    expect((ref.querySelector('input') as HTMLInputElement).value).toBe('Génesis 1');
    expect(screen.getByTestId('story-frame-2').textContent).toContain('Then God said.');
    expect(title.querySelector('img')).toBeNull();
    expect(ref.querySelector('img')).toBeNull();
    expect(screen.getByTestId('story-frame-2').querySelector('img')).toBeNull();
  });

  it('states that gateway text is unavailable on every unit when there is no source story, and keeps the target text', () => {
    state.sourceStory = null;
    state.storySource = { kind: 'no-pin' };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-error').textContent).toContain('No gateway story is pinned');
    expect(screen.queryByTestId('story-source-install')).toBeNull();
    expect(screen.getAllByText('Gateway text is unavailable.')).toHaveLength(4);
    expect((screen.getByRole('textbox', { name: 'Frame 1' }) as HTMLTextAreaElement).value).toBe('Al principio.');
    expect((screen.getByRole('textbox', { name: 'Story title' }) as HTMLInputElement).value).toBe('La creación');
    state.sourceStory = { number: 1, title: 'Creation', ref: 'Genesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'In the beginning.' }, { image: '![x](obs-02.jpg)', text: 'Then God said.' }] };
    state.storySource = null;
  });

  it('marks a frame drafted exactly when its paragraph is non-empty', () => {
    render(<StoryDraft />);
    expect(screen.getByTestId('frame-marker-1').getAttribute('data-drafted')).toBe('true');
    expect(screen.getByTestId('frame-marker-1').getAttribute('title')).toBe('Frame 1, drafted');
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-drafted')).toBe('false');
    expect(screen.getByTestId('frame-marker-2').getAttribute('title')).toBe('Frame 2, not drafted');
    cleanup();
    state.story.frames[1].text = '   \n  ';
    render(<StoryDraft />);
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-drafted')).toBe('false');
    state.story.frames[1].text = '';
  });

  it('lists every story from the catalogue as a keyboard-operable button and names the current one', () => {
    render(<StoryDraft />);
    const rail = screen.getByTestId('story-rail');
    const buttons = [...rail.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Story 1', 'Story 2']);
    expect(buttons.every((b) => b.tabIndex >= 0)).toBe(true);
    expect(screen.getByTestId('story-1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('story-2').getAttribute('aria-current')).toBeNull();
    screen.getByTestId('story-2').focus();
    expect(document.activeElement).toBe(screen.getByTestId('story-2'));
  });

  it('gives every target field and every gateway line the project script direction', () => {
    state.project = { flavor: 'textStories', scriptDirection: 'rtl' };
    render(<StoryDraft />);
    for (const box of screen.getAllByRole('textbox')) expect(box.getAttribute('dir')).toBe('rtl');
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    for (const line of screen.getByTestId('story-draft').querySelectorAll('p')) expect(line.getAttribute('dir')).toBe('rtl');
    state.project = { flavor: 'textStories', scriptDirection: 'ltr' };
  });

  it('passes an emptied reference to the state as an empty string, so the field can be cleared and retyped', () => {
    render(<StoryDraft />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reference' }), { target: { value: '' } });
    expect(actions.stageStoryUnit).toHaveBeenCalledWith({ kind: 'ref', story: 1 }, '');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Reference' }));
    expect(actions.blurStoryUnit).toHaveBeenCalledWith({ kind: 'ref', story: 1 });
  });

  it('offers the Sources modal when the pinned gateway story is not installed', () => {
    state.storySource = { kind: 'not-installed', pin: { repoPath: 'git.door43.org/unfoldingWord/en_obs', sha: '0123456789abcdef0123456789abcdef01234567' } };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-error').textContent).toContain('en_obs@0123456789ab is not on this machine');
    fireEvent.click(screen.getByTestId('story-source-install'));
    expect(actions.openSources).toHaveBeenCalledTimes(1);
    cleanup();
    state.storySource = { kind: 'error', message: 'story 1 has 16 source frames; project has 15' };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-error').textContent).toContain('could not be read: story 1 has 16 source frames');
    expect(screen.queryByTestId('story-source-install')).toBeNull();
    state.storySource = null;
  });
});
